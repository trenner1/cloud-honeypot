#!/bin/bash
# Unattended DShield sensor bootstrap. Runs once via cloud-init.
# Expected environment (injected by CDK user-data):
#   DSHIELD_SECRET_ARN, EXPECTED_PUBLIC_IP, LOG_GROUP_NAME,
#   VPC_CIDR, ADMIN_CIDR (optional), DSHIELD_GIT_URL, DSHIELD_GIT_REF
#
# Ubuntu cloud-init runs /var/lib/cloud/instance/scripts/part-001 with /bin/sh
# (dash), which rejects `set -o pipefail` and process substitution. Re-exec
# under bash before any bash-only syntax.
if [ -z "${BASH_VERSION:-}" ]; then
  exec /bin/bash "$0" "$@"
fi
set -Eeuo pipefail

BOOTSTRAP_LOG=/var/log/honeypot-bootstrap.log
mkdir -p /var/log
exec > >(tee -a "${BOOTSTRAP_LOG}") 2>&1

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

imds_token() {
  curl -fsS -X PUT "http://169.254.169.254/latest/api/token" \
    -H "X-aws-ec2-metadata-token-ttl-seconds: 21600"
}

imds() {
  local path="$1"
  curl -fsS -H "X-aws-ec2-metadata-token: ${IMDS_TOKEN}" \
    "http://169.254.169.254/latest/meta-data/${path}"
}

echo "=== DShield bootstrap starting $(date -u +%FT%TZ) ==="

IMDS_TOKEN="$(imds_token)"
AZ="$(imds placement/availability-zone)"
AWS_DEFAULT_REGION="${AZ%?}"
export AWS_DEFAULT_REGION
INSTANCE_ID="$(imds instance-id)"

: "${DSHIELD_SECRET_ARN:?DSHIELD_SECRET_ARN is required}"
: "${EXPECTED_PUBLIC_IP:?EXPECTED_PUBLIC_IP is required}"
: "${LOG_GROUP_NAME:?LOG_GROUP_NAME is required}"
: "${VPC_CIDR:?VPC_CIDR is required}"
DSHIELD_GIT_URL="${DSHIELD_GIT_URL:-https://github.com/DShield-ISC/dshield.git}"
DSHIELD_GIT_REF="${DSHIELD_GIT_REF:-main}"
ADMIN_CIDR="${ADMIN_CIDR:-}"

echo "region=${AWS_DEFAULT_REGION} instance=${INSTANCE_ID} expected_ip=${EXPECTED_PUBLIC_IP}"

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl git jq unzip python3 python3-venv python3-pip

if ! command -v aws >/dev/null 2>&1; then
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
  unzip -q /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install
  rm -rf /tmp/aws /tmp/awscliv2.zip
fi

echo "Waiting for Elastic IP ${EXPECTED_PUBLIC_IP} to attach..."
PUBLIC_IP=""
for _ in $(seq 1 60); do
  PUBLIC_IP="$(imds public-ipv4 || true)"
  if [ "${PUBLIC_IP}" = "${EXPECTED_PUBLIC_IP}" ]; then
    break
  fi
  sleep 5
  IMDS_TOKEN="$(imds_token)"
done
if [ "${PUBLIC_IP}" != "${EXPECTED_PUBLIC_IP}" ]; then
  echo "WARNING: public IP is '${PUBLIC_IP}', expected '${EXPECTED_PUBLIC_IP}'. Continuing."
fi

echo "Installing CloudWatch agent for bootstrap logs..."
curl -fsSL "https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb" \
  -o /tmp/amazon-cloudwatch-agent.deb
dpkg -i /tmp/amazon-cloudwatch-agent.deb || apt-get install -fy
rm -f /tmp/amazon-cloudwatch-agent.deb

cat >/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<EOF
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "${BOOTSTRAP_LOG}",
            "log_group_name": "${LOG_GROUP_NAME}",
            "log_stream_name": "{instance_id}/bootstrap",
            "retention_in_days": 14
          }
        ]
      }
    }
  }
}
EOF

/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json

echo "Fetching DShield ISC account material from Secrets Manager..."
SECRET_JSON="$(aws secretsmanager get-secret-value \
  --secret-id "${DSHIELD_SECRET_ARN}" \
  --query SecretString \
  --output text)"
DSHIELD_EMAIL="$(jq -r '.email' <<<"${SECRET_JSON}")"
DSHIELD_USERID="$(jq -r '.userid' <<<"${SECRET_JSON}")"
DSHIELD_APIKEY="$(jq -r '.apikey' <<<"${SECRET_JSON}")"
unset SECRET_JSON

if [ -z "${DSHIELD_EMAIL}" ] || [ "${DSHIELD_EMAIL}" = "null" ] \
  || [ -z "${DSHIELD_USERID}" ] || [ "${DSHIELD_USERID}" = "null" ] \
  || [ -z "${DSHIELD_APIKEY}" ] || [ "${DSHIELD_APIKEY}" = "null" ]; then
  echo "ERROR: secret must contain JSON keys email, userid, and apikey"
  exit 1
fi

if ! id dshield >/dev/null 2>&1; then
  adduser --disabled-password --gecos "DShield Honeypot" dshield
fi
usermod -aG sudo dshield
echo 'dshield ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/dshield
chmod 440 /etc/sudoers.d/dshield

install -d -o dshield -g dshield -m 0770 /srv/dshield/etc

LOCAL_IPS="${ADMIN_CIDR%/*}"
cat >/srv/dshield/etc/dshield.ini <<EOF
[DShield]
interface=
version=100
email=${DSHIELD_EMAIL}
userid=${DSHIELD_USERID}
apikey=${DSHIELD_APIKEY}
piid=
honeypotip=${EXPECTED_PUBLIC_IP}
replacehoneypotip=
anonymizeip=
anonymizemask=
fwlogfile=/var/log/dshield.log
nofwlogging=${VPC_CIDR}
localips=${LOCAL_IPS}
adminports=12222
nohoneyips=
nohoneyports=2222 2223 8000
manualupdates=0
telnet=true
EOF
chown dshield:dshield /srv/dshield/etc/dshield.ini
chmod 600 /srv/dshield/etc/dshield.ini
ln -sfn /srv/dshield/etc/dshield.ini /etc/dshield.ini

unset DSHIELD_EMAIL DSHIELD_USERID DSHIELD_APIKEY

if [ ! -d /home/dshield/dshield/.git ]; then
  sudo -u dshield -H git clone --depth 1 --branch "${DSHIELD_GIT_REF}" \
    "${DSHIELD_GIT_URL}" /home/dshield/dshield
fi

echo "Running DShield unattended installer (install.sh --update)..."
sudo -u dshield -H bash -lc 'cd /home/dshield/dshield && bin/install.sh --update'

echo "INSTALL_COMPLETE $(date -u +%FT%TZ)"
touch /var/lib/honeypot-bootstrap.done

echo "Rebooting so DShield firewall and SSH port 12222 take effect."
sleep 5
reboot
