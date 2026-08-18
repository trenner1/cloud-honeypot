# CDK instead of upstream DShield Terraform

SANS ships Terraform under `DShield-ISC/dshield/terraform/aws`, but it still targets Ubuntu 20.04, provisions over SSH with local keys, and takes the ISC API key as a plaintext Terraform variable. This repo uses AWS CDK so deploy is one command, credentials land in Secrets Manager from NoEcho parameters, admin access is SSM rather than inbound SSH, and the AMI is current Ubuntu 24.04 LTS.

**Considered Options**: wrap the upstream Terraform as-is; fork it and modernize. Forking still leaves SSH provisioners and key files as the install path. CDK matches the rest of our AWS tooling and can inline the unattended installer.
