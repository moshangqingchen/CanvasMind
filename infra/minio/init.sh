#!/bin/sh
set -eu

: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
: "${MINIO_APP_USER:?MINIO_APP_USER is required}"
: "${MINIO_APP_PASSWORD:?MINIO_APP_PASSWORD is required}"
: "${MINIO_BUCKET:?MINIO_BUCKET is required}"

if [ "${#MINIO_ROOT_PASSWORD}" -lt 8 ] || [ "${#MINIO_APP_PASSWORD}" -lt 8 ]; then
  echo "MinIO passwords must contain at least 8 characters" >&2
  exit 1
fi
if [ "$MINIO_ROOT_USER" = "$MINIO_APP_USER" ]; then
  echo "MINIO_ROOT_USER and MINIO_APP_USER must be different" >&2
  exit 1
fi

case "$MINIO_BUCKET" in
  ""|*[!A-Za-z0-9._-]*)
    echo "MINIO_BUCKET contains unsupported characters" >&2
    exit 1
    ;;
esac

until mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"; do
  sleep 1
done

mc mb --ignore-existing "local/$MINIO_BUCKET"
mc cors set "local/$MINIO_BUCKET" /config/cors.xml

policy_name="supercanvas-app-$MINIO_BUCKET"
policy_file="/tmp/$policy_name.json"
cat > "$policy_file" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetBucketLocation", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::$MINIO_BUCKET"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::$MINIO_BUCKET/*"]
    }
  ]
}
EOF

if ! mc admin policy info local "$policy_name" >/dev/null 2>&1; then
  mc admin policy create local "$policy_name" "$policy_file"
fi

if ! mc admin user info local "$MINIO_APP_USER" >/dev/null 2>&1; then
  mc admin user add local "$MINIO_APP_USER" "$MINIO_APP_PASSWORD"
fi
mc admin policy attach local "$policy_name" --user "$MINIO_APP_USER"
