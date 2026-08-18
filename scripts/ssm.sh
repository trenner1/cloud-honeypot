#!/usr/bin/env bash
# Open an SSM shell on the deployed sensor instance.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=aws-preflight.sh
source "${ROOT}/scripts/aws-preflight.sh"

REQUIRE_SESSION_MANAGER_PLUGIN=1
preflight_aws

INSTANCE_ID="${1:-$(stack_output InstanceId)}"
if [[ -z "${INSTANCE_ID}" || "${INSTANCE_ID}" == "None" ]]; then
  echo "Could not find InstanceId output on stack DshieldHoneypot. Deploy first: npm run deploy" >&2
  exit 1
fi

PROFILE_ARGS=()
if [[ -n "${AWS_PROFILE:-}" ]]; then
  PROFILE_ARGS=(--profile "${AWS_PROFILE}")
fi

echo "Connecting to ${INSTANCE_ID} (SSM lands you as ssm-user in /home/ssm-user — that empty home is normal)."
echo "After bootstrap: sudo tail -f /var/log/honeypot-bootstrap.log"
echo "After INSTALL_COMPLETE + reboot: sudo /home/dshield/dshield/bin/status.sh"
echo

exec aws ssm start-session --target "${INSTANCE_ID}" "${PROFILE_ARGS[@]}"
