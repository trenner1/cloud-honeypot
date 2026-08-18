#!/usr/bin/env bash
# Deploy the DShield sensor. Reads ISC account fields from the environment
# so they are never written to disk or to cdk.context.json.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

: "${DSHIELD_EMAIL:?Set DSHIELD_EMAIL to the email on your ISC / DShield account}"
: "${DSHIELD_USERID:?Set DSHIELD_USERID from https://www.dshield.org/myaccount.html}"
: "${DSHIELD_APIKEY:?Set DSHIELD_APIKEY from https://www.dshield.org/myaccount.html}"

if ! command -v npx >/dev/null 2>&1; then
  echo "Node.js 20+ and npm are required." >&2
  exit 1
fi

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
  "${CONTEXT_ARGS[@]}" \
  --parameters "DshieldEmail=${DSHIELD_EMAIL}" \
  --parameters "DshieldUserid=${DSHIELD_USERID}" \
  --parameters "DshieldApikey=${DSHIELD_APIKEY}"

echo
echo "Stack is up. The sensor keeps installing for 15-25 minutes after the instance starts."
echo "Watch /var/log/honeypot-bootstrap.log over SSM, then confirm submissions at https://isc.sans.edu/myreports.html"
