#!/bin/bash

set -euo pipefail

LOG_ROOT=${LOG_ROOT:-/root/EDH-PodLog}
EDH_SERVICE=${EDH_SERVICE:-edh-podlog.service}
MONGO_SERVICE=${MONGO_SERVICE:-mongod.service}
NGINX_CONFIG=${NGINX_CONFIG:-/etc/nginx/sites-available/edh-podlog}
NGINX_RELOAD=${NGINX_RELOAD:-"systemctl reload nginx"}

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "error: this script must run as root (sudo ./scripts/configure-vps-logs.sh)"
  exit 1
fi

if ! command -v install >/dev/null 2>&1; then
  echo "error: required command 'install' not found"
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "error: required command 'systemctl' not found"
  exit 1
fi

mkdir -p "$LOG_ROOT"
touch "${LOG_ROOT}/back.log" "${LOG_ROOT}/db.log" "${LOG_ROOT}/front.log"
chmod 644 "${LOG_ROOT}/"*.log

back_override_dir="/etc/systemd/system/${EDH_SERVICE}.d"
db_override_dir="/etc/systemd/system/${MONGO_SERVICE}.d"

mkdir -p "$back_override_dir" "$db_override_dir"

cat >"${back_override_dir}/logging.conf" <<EOF
[Service]
StandardOutput=append:${LOG_ROOT}/back.log
StandardError=append:${LOG_ROOT}/back.log
EOF

cat >"${db_override_dir}/logging.conf" <<EOF
[Service]
StandardOutput=append:${LOG_ROOT}/db.log
StandardError=append:${LOG_ROOT}/db.log
EOF

systemctl daemon-reload
systemctl restart "$EDH_SERVICE"
systemctl restart "$MONGO_SERVICE"

ACCESS_LOG="${LOG_ROOT}/front.log"
ERROR_LOG="${LOG_ROOT}/front.log"

if [ -f "$NGINX_CONFIG" ]; then
  if ! grep -q "$ACCESS_LOG" "$NGINX_CONFIG"; then
    cat <<EOF
---
Update $NGINX_CONFIG and set:
    access_log $ACCESS_LOG;
    error_log $ERROR_LOG;
Then run:
    nginx -t && $NGINX_RELOAD
---
EOF
  else
    echo "Nginx config already references $ACCESS_LOG"
  fi
else
  cat <<EOF
warning: nginx config '$NGINX_CONFIG' not found; to mirror logs, include:
    access_log $ACCESS_LOG;
    error_log $ERROR_LOG;
Then reload nginx with:
    nginx -t && $NGINX_RELOAD
EOF
fi

cat <<EOF

Systemd overrides installed. Tail logs with:
  tail -F ${LOG_ROOT}/back.log
  tail -F ${LOG_ROOT}/db.log
  tail -F ${LOG_ROOT}/front.log
EOF
