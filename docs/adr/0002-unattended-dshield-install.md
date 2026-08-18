# Unattended install via pre-seeded dshield.ini

`install.sh` has no flags for email, userid, or API key. Interactive mode uses `dialog`. Non-interactive mode (`--update` / `--upgrade`) requires `/srv/dshield/etc/dshield.ini` already present with those fields. Bootstrap writes that file from Secrets Manager, then runs `install.sh --update` as the `dshield` user, matching the Ubuntu instructions published in August 2025.
