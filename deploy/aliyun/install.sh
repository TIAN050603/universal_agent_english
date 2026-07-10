#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

APP_DIR=${APP_DIR:-/opt/his-agent}
APP_USER=${APP_USER:-hisagent}

if [[ ! -f "$APP_DIR/backend/pyproject.toml" ]]; then
  echo "Expected a HIS-Agent checkout at $APP_DIR." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates certbot git nginx python3 python3-certbot-nginx python3-pip python3-venv

if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

python3 -m venv "$APP_DIR/backend/.venv"
"$APP_DIR/backend/.venv/bin/pip" install --upgrade pip wheel
"$APP_DIR/backend/.venv/bin/pip" install fastapi 'uvicorn[standard]' python-dotenv requests

python3 -m venv "$APP_DIR/asr_service/.venv"
"$APP_DIR/asr_service/.venv/bin/pip" install --upgrade pip wheel
"$APP_DIR/asr_service/.venv/bin/pip" install -r "$APP_DIR/asr_service/requirements.txt"

install -m 0644 "$APP_DIR/deploy/aliyun/his-agent-backend.service" /etc/systemd/system/his-agent-backend.service
install -m 0644 "$APP_DIR/deploy/aliyun/his-agent-asr.service" /etc/systemd/system/his-agent-asr.service
install -m 0644 "$APP_DIR/deploy/aliyun/his-agent-llm-proxy.service" /etc/systemd/system/his-agent-llm-proxy.service
install -m 0644 "$APP_DIR/deploy/aliyun/nginx-his-agent.conf" /etc/nginx/sites-available/his-agent
ln -sfn /etc/nginx/sites-available/his-agent /etc/nginx/sites-enabled/his-agent
rm -f /etc/nginx/sites-enabled/default

chown -R root:"$APP_USER" "$APP_DIR"
find "$APP_DIR" -type d -exec chmod 0755 {} +
systemctl daemon-reload
nginx -t

cat <<'EOF'
Base services are installed. Add these secret files before starting services:
  /opt/his-agent/backend/.env
  /opt/his-agent/asr_service/.env
Then run:
  systemctl enable --now his-agent-llm-proxy his-agent-backend his-agent-asr nginx
EOF
