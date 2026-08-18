#!/usr/bin/env bash
# Deploy the DShield sensor. Reads ISC account fields from the environment
# so they are never written to disk or to cdk.context.json.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

# shellcheck source=aws-preflight.sh
source "${ROOT}/scripts/aws-preflight.sh"

: "${DSHIELD_EMAIL:?Set DSHIELD_EMAIL to the email on your ISC / DShield account}"
: "${DSHIELD_USERID:?Set DSHIELD_USERID from https://www.dshield.org/myaccount.html}"
: "${DSHIELD_APIKEY:?Set DSHIELD_APIKEY from https://www.dshield.org/myaccount.html}"

if ! command -v npx >/dev/null 2>&1; then
  echo "Node.js 20+ and npm are required." >&2
  exit 1
fi

preflight_aws

CONTEXT_ARGS=()
if [[ -n "${ADMIN_CIDR:-}" ]]; then
  CONTEXT_ARGS+=(--context "adminCidr=${ADMIN_CIDR}")
fi
if [[ -n "${INSTANCE_TYPE:-}" ]]; then
  CONTEXT_ARGS+=(--context "instanceType=${INSTANCE_TYPE}")
fi
if [[ -n "${VPC_CIDR:-}" ]]; then
  CONTEXT_ARGS+=(--context "vpcCidr=${VPC_CIDR}")
fi

echo "Bootstrapping CDK in this account/region (safe to re-run)..."
npx cdk bootstrap

echo "Deploying DshieldHoneypot..."
npx cdk deploy DshieldHoneypot \
  --strict \
  --require-approval never \
  ${CONTEXT_ARGS+"${CONTEXT_ARGS[@]}"} \
  --parameters "DshieldEmail=${DSHIELD_EMAIL}" \
  --parameters "DshieldUserid=${DSHIELD_USERID}" \
  --parameters "DshieldApikey=${DSHIELD_APIKEY}"

INSTANCE_ID="$(stack_output InstanceId)"
PUBLIC_IP="$(stack_output PublicIp)"

echo
echo "Stack is up. DShield keeps installing for 15-25 minutes, then the instance reboots."
if [[ -n "${INSTANCE_ID}" && "${INSTANCE_ID}" != "None" ]]; then
  echo
  echo "Instance:  ${INSTANCE_ID}"
  [[ -n "${PUBLIC_IP}" && "${PUBLIC_IP}" != "None" ]] && echo "Public IP: ${PUBLIC_IP}"
  echo
  echo "1. Wait for bootstrap (or watch the log):"
  echo "     npm run ssm"
  echo "     sudo tail -f /var/log/honeypot-bootstrap.log"
  echo
  echo "2. When you see INSTALL_COMPLETE, exit SSM and reconnect (the host reboots):"
  echo "     npm run ssm"
  echo
  echo "3. Check sensor status (must run as root, not as the dshield user):"
  echo "     sudo /home/dshield/dshield/bin/status.sh"
  echo
  echo "4. Confirm submissions at https://isc.sans.edu/myreports.html (30-60 min for the first batch)."
else
  echo "Watch bootstrap over SSM, then confirm submissions at https://isc.sans.edu/myreports.html"
fi
