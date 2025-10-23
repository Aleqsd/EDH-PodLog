#!/usr/bin/env bash
set -euo pipefail

LOG_ROOT=${1:-/root/EDH-PodLog}
EDH_SERVICE=${EDH_SERVICE:-edh-podlog.service}
MONGO_SERVICE=${MONGO_SERVICE:-mongod.service}
NGINX_CONFIG=${NGINX_CONFIG:-/etc/nginx/sites-available/edh-podlog}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command '$1' not found" >&2
    exit 1
  }
}

require_root() {
  if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    echo "error: this script must run as root (use sudo)" >&2
    exit 1
  }
}

create_override() {
  local service=$1
  local logfile=$2

  local override_dir="/etc/systemd/system/${service}.d"
  local override_file="${override_dir}/logging.conf"

  install -d -m 755 "$override_dir"
  cat >"$override_file" <<EOF
[Service]
StandardOutput=append:${logfile}
StandardError=append:${logfile}
EOF
  echo "Configured ${service} to append logs to ${logfile}"
}

configure_nginx() {
  local access_log="$1/front.log"
  local error_log="$1/front-error.log"

  if [ ! -f "$NGINX_CONFIG" ]; then
    echo "warning: nginx config '$NGINX_CONFIG' not found; skipping" >&2
    return
  fi

  if ! grep -q "$access_log" "$NGINX_CONFIG"; then
    cat <<EOF
---
Update $NGINX_CONFIG to include:
    access_log $access_log;
    error_log $error_log;
Then run: nginx -t && systemctl reload nginx
---
EOF
  else
    echo "Nginx config already references $access_log"
  fi
}

main() {
  require_root
  require_command install

  install -d -m 755 "$LOG_ROOT"
  touch "${LOG_ROOT}/back.log" "${LOG_ROOT}/db.log" "${LOG_ROOT}/front.log" "${LOG_ROOT}/front-error.log"
  chmod 644 "${LOG_ROOT}/"*.log

  create_override "$EDH_SERVICE" "${LOG_ROOT}/back.log"
  create_override "$MONGO_SERVICE" "${LOG_ROOT}/db.log"

  systemctl daemon-reload
  systemctl restart "$EDH_SERVICE"
  systemctl restart "$MONGO_SERVICE"

  configure_nginx "$LOG_ROOT"

  cat <<'EOF'
Done. Review instructions above to finish configuring Nginx if needed.
EOF
}

main "$@"
