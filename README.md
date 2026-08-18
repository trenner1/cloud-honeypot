# DShield honeypot on AWS

Fully automated deploy of the [SANS Internet Storm Center DShield sensor](https://isc.sans.edu/honeypot.html) into its own public VPC. One command creates the network, instance, Elastic IP, and unattended installer; the host then reports SSH, Telnet, HTTP, and firewall hits to ISC.

## What you get

- Dedicated VPC (`10.40.0.0/16`) with a single public subnet — no NAT gateway, no peering
- Ubuntu 24.04 LTS (`t3.small`, 20 GB encrypted gp3)
- Security group open to all IPv4 inbound (required for DShield; the host firewall still protects the real SSH port)
- Elastic IP so the sensor address stays stable across instance replacement
- ISC email / userid / API key stored in Secrets Manager, never in git
- SSM Session Manager as the admin channel (no SSH key, no inbound admin port required)
- Bootstrap log in CloudWatch (`/var/log/honeypot-bootstrap.log`)

Attack data itself goes to [My Reports](https://isc.sans.edu/myreports.html), not to CloudWatch. That keeps ingest cost down.

## Prerequisites

1. An AWS account and credentials the CDK CLI can use (`aws login` or an existing profile)
2. Node.js 20+
3. A [DShield / ISC account](https://www.dshield.org). From [My Account](https://www.dshield.org/myaccount.html) copy **email**, **userid**, and **API key**
4. A dedicated instance is assumed. Do not point this stack at an existing workload VPC

## Deploy

```bash
npm install

export DSHIELD_EMAIL='you@example.com'
export DSHIELD_USERID='123456'
export DSHIELD_APIKEY='your-api-key'

npm run deploy
```

`scripts/deploy.sh` bootstraps CDK in the current account/region if needed, then deploys `DshieldHoneypot`. The CloudFormation stack becomes `CREATE_COMPLETE` when the instance is running; **DShield software keeps installing for 15–25 minutes after that**, then the host reboots.

Optional environment:

| Variable | Effect |
| --- | --- |
| `ADMIN_CIDR` | Passed into `dshield.ini` as a trusted IP for SSH port 12222 (example `203.0.113.10/32`) |
| `INSTANCE_TYPE` | Override (default `t3.small`; `t3.micro` works but is tight on RAM) |
| `VPC_CIDR` | Override (default `10.40.0.0/16`) |
| `AWS_PROFILE` / `AWS_REGION` | Standard AWS SDK selection |

## After deploy

```bash
# from stack outputs
aws ssm start-session --target i-xxxxxxxxxxxxxxxxx
```

On the host:

```bash
sudo tail -f /var/log/honeypot-bootstrap.log
# after reboot / INSTALL_COMPLETE:
sudo -u dshield /home/dshield/dshield/bin/status.sh
```

Confirm submissions at https://isc.sans.edu/myreports.html (allow up to 30–60 minutes for the first batch).

## Tear down

```bash
npx cdk destroy DshieldHoneypot
```

The Elastic IP and instance go away; public IPv4 charges stop. Delete the ISC API key in the DShield account if you will not redeploy.

## Notes

- This is a **low-interaction** honeypot (Cowrie + HTTP decoys), not a vulnerable machine
- Inbound `0.0.0.0/0` is intentional. Run it in this stack's VPC only
- Official upstream Terraform still targets older Ubuntu and SSH provisioners; this project follows current [Ubuntu 24.04 instructions](https://github.com/DShield-ISC/dshield/blob/main/docs/install-instructions/Ubuntu.md)
- `cdk-nag` AwsSolutionsChecks run on synth; documented suppressions cover the open security group, missing flow logs, and ISC key rotation
