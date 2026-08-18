#!/usr/bin/env bash
# Shared AWS CLI checks for deploy.sh and ssm.sh.
preflight_aws() {
  if ! command -v aws >/dev/null 2>&1; then
    echo "AWS CLI is required. See https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html" >&2
    exit 1
  fi

  if ! aws sts get-caller-identity >/dev/null 2>&1; then
    echo "AWS credentials are missing or expired." >&2
    if [[ -n "${AWS_PROFILE:-}" ]]; then
      echo "Try: aws sso login --profile ${AWS_PROFILE}" >&2
    elif aws configure list-profiles 2>/dev/null | grep -q .; then
      echo "Try: aws sso login --profile admin   (or your profile name)" >&2
      echo "Then: export AWS_PROFILE=admin" >&2
    else
      echo "Configure a profile or export AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY." >&2
    fi
    exit 1
  fi

  if [[ "${REQUIRE_SESSION_MANAGER_PLUGIN:-0}" == "1" ]] && ! command -v session-manager-plugin >/dev/null 2>&1; then
    echo "Session Manager plugin is required for interactive SSM shells." >&2
    echo "Install (macOS): brew install --cask session-manager-plugin" >&2
    echo "Docs: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html" >&2
    exit 1
  fi

  if [[ "${REQUIRE_SESSION_MANAGER_PLUGIN:-0}" != "1" ]] && ! command -v session-manager-plugin >/dev/null 2>&1; then
    echo "Note: session-manager-plugin is not installed. You will need it to run 'npm run ssm'." >&2
    echo "  brew install --cask session-manager-plugin" >&2
  fi
}

stack_output() {
  local key="$1"
  aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME:-DshieldHoneypot}" \
    --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue | [0]" \
    --output text 2>/dev/null
}
