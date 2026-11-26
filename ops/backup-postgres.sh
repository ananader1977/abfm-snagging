#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${PGHOST:?Set the database hostname}"
: "${PGDATABASE:?Set the database name}"
: "${PGUSER:?Set the backup database user}"
: "${BACKUP_BUCKET:?Set the private backup bucket name}"
: "${BACKUP_EXPECTED_OWNER:?Set the AWS account ID that owns the bucket}"

work="$(mktemp -d)"
trap 'rm -f -- "$work/database.dump"; rmdir -- "$work"' EXIT
pg_dump --format=custom --no-owner --no-acl --file="$work/database.dump"
pg_restore --list "$work/database.dump" >/dev/null
key="abfm-snagging/postgres/$(date -u +%Y-%m-%dT%H%M%SZ).dump"
aws s3api put-object --bucket "$BACKUP_BUCKET" --expected-bucket-owner "$BACKUP_EXPECTED_OWNER" \
  --key "$key" --body "$work/database.dump" --server-side-encryption AES256 >/dev/null
aws s3api head-object --bucket "$BACKUP_BUCKET" --expected-bucket-owner "$BACKUP_EXPECTED_OWNER" --key "$key" >/dev/null
printf '%s\n' "Database backup verified: $key"
