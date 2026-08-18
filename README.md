# DShield honeypot on AWS

Fully automated deploy of the [SANS Internet Storm Center DShield sensor](https://isc.sans.edu/honeypot.html) into its own public VPC. One command creates the network, instance, Elastic IP, and unattended installer; the host then reports SSH, Telnet, HTTP, and firewall hits to ISC.

## What you get

- Dedicated VPC (`10.40.0.0/16`) with a single public subnet — no NAT gateway, no peering
- Ubuntu 24.04 LTS (`t3.small`, 20 GB encrypted gp3)
- Security group open to all IPv4 inbound (required for DShield; the host firewall still protects the real SSH port)
- Elastic IP so the sensor address stays stable across instance replacement
- ISC email / userid / API key stored in Secrets Manager, never in git
- SSM Session Manager as the admin channel (no SSH key, no inbound admin port required)
- Bootstrap log on the instance at `/var/log/honeypot-bootstrap.log`

Attack data itself goes to [My Reports](https://isc.sans.edu/myreports.html), not to CloudWatch. That keeps ingest cost down.

## Prerequisites

1. **AWS account** with permission to deploy CDK (AdministratorAccess or equivalent for the first bootstrap)
2. **AWS CLI** with working credentials (SSO profile or env vars — see below)
3. **Session Manager plugin** for interactive SSM shells (`brew install --cask session-manager-plugin` on macOS)
4. **Node.js 20+**
5. A [DShield / ISC account](https://www.dshield.org). From [My Account](https://www.dshield.org/myaccount.html) copy **email**, **userid**, and **API key**
6. A dedicated instance is assumed. Do not point this stack at an existing workload VPC

## AWS authentication

CDK and SSM use the normal AWS credential chain. Pick one approach:

### SSO profile (typical for org accounts)

```bash
aws sso login --profile admin
export AWS_PROFILE=admin
export AWS_REGION=us-west-2   # your target region
```

Re-run `aws sso login` when the session expires (every few hours).

### Environment variables

For CI or one-off shells:

```bash
eval "$(aws configure export-credentials --profile admin --format env)"
export AWS_REGION=us-west-2
```

Or set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` directly.

`scripts/deploy.sh` calls `aws sts get-caller-identity` before deploy and prints SSO login hints if credentials are missing.

## Deploy

```bash
npm install

export DSHIELD_EMAIL='you@example.com'
export DSHIELD_USERID='123456'
export DSHIELD_APIKEY='your-api-key'

# with SSO (recommended)
export AWS_PROFILE=admin
export AWS_REGION=us-west-2

npm run deploy
```

`scripts/deploy.sh` bootstraps CDK in the current account/region if needed, then deploys `DshieldHoneypot`.

The CloudFormation stack becomes `CREATE_COMPLETE` when the instance is running. **DShield software keeps installing for 15–25 minutes after that**, then the host **reboots** (firewall rules and Cowrie take effect).

Optional environment:

| Variable | Effect |
| --- | --- |
| `ADMIN_CIDR` | Passed into `dshield.ini` as a trusted IP for SSH port 12222 (example `203.0.113.10/32`) |
| `INSTANCE_TYPE` | Override (default `t3.small`; `t3.micro` works but is tight on RAM) |
| `VPC_CIDR` | Override (default `10.40.0.0/16`) |
| `AWS_PROFILE` / `AWS_REGION` | Standard AWS SDK selection |

## After deploy

### 1. Connect over SSM

```bash
npm run ssm
# or: aws ssm start-session --target i-xxxxxxxxxxxxxxxxx --profile admin
```

SSM opens a shell as **`ssm-user`** in `/home/ssm-user`. That home directory is nearly empty — that is normal. DShield is installed under `/home/dshield/` and `/srv/`, not in your SSM home.

If you see `SessionManagerPlugin is not found`, install the plugin:

```bash
brew install --cask session-manager-plugin   # macOS
```

### 2. Watch bootstrap

```bash
sudo tail -f /var/log/honeypot-bootstrap.log
```

Wait until you see `INSTALL_COMPLETE` and `Rebooting so DShield firewall and SSH port 12222 take effect.`

### 3. Reconnect after reboot

Exit the session (`exit` or Ctrl+D) and start a **new** SSM session — the instance rebooted during install:

```bash
npm run ssm
```

### 4. Check sensor status

Run as **root** (not `sudo -u dshield`):

```bash
sudo /home/dshield/dshield/bin/status.sh
```

You cannot `cd /home/dshield` as `ssm-user` (directory permissions). Use the full path above.

Empty “Last … Log Received” lines are normal for the first hour. “Last Firewall Log Processed” updating means submit scripts are working.

### 5. Confirm at ISC

https://isc.sans.edu/myreports.html — allow **30–60 minutes** for the first batch.

If `status.sh` reports errors, see [STATUSERRORS.md](https://github.com/DShield-ISC/dshield/blob/main/STATUSERRORS.md).

## Tear down

```bash
export AWS_PROFILE=admin   # if using SSO
npx cdk destroy DshieldHoneypot
```

The Elastic IP and instance go away; public IPv4 charges stop. Delete the ISC API key in the DShield account if you will not redeploy.

## Notes

- This is a **low-interaction** honeypot (Cowrie + HTTP decoys), not a vulnerable machine
- Inbound `0.0.0.0/0` is intentional. Run it in this stack's VPC only
- Official upstream Terraform still targets older Ubuntu and SSH provisioners; this project follows current [Ubuntu 24.04 instructions](https://github.com/DShield-ISC/dshield/blob/main/docs/install-instructions/Ubuntu.md)
- `cdk-nag` AwsSolutionsChecks run on synth; documented suppressions cover the open security group, missing flow logs, and ISC key rotation
