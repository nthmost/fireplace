#!/bin/bash
# Deploy the fireplace live monitor onto the box that runs Transmission.
# Run it there, or remotely:   ssh loki.local 'bash -s' < server/deploy-loki.sh
#
# It clones/updates the public repo, writes a local .env (RPC creds pulled from
# Transmission's own postprocess.conf — never from git), and installs a systemd
# service. Requires passwordless sudo on the target.
set -euo pipefail

DIR="$HOME/fireplace-monitor"
REPO="https://github.com/nthmost/fireplace.git"
PORT="${FIREPLACE_PORT:-8673}"
TORRENT="${TR_TORRENT:-Pimsleur}"
CONF="/var/lib/transmission-daemon/info/postprocess.conf"
PY="$(command -v python3)"

echo "==> code: $DIR"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone "$REPO" "$DIR"; fi

echo "==> env: $DIR/.env (creds from $CONF)"
eval "$(sudo -n grep -E '^RPC_(USER|PASS)=' "$CONF")"
umask 077
cat > "$DIR/.env" <<ENV
FIREPLACE_PORT=$PORT
TR_HOST=127.0.0.1
TR_PORT=9091
TR_RPC_USER=$RPC_USER
TR_RPC_PASS=$RPC_PASS
TR_TORRENT=$TORRENT
ENV

echo "==> systemd service: fireplace-monitor"
sudo -n tee /etc/systemd/system/fireplace-monitor.service >/dev/null <<UNIT
[Unit]
Description=Fireplace live torrent monitor (web)
After=network-online.target transmission-daemon.service
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$DIR
EnvironmentFile=$DIR/.env
ExecStart=$PY server/server.py
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

sudo -n systemctl daemon-reload
sudo -n systemctl enable fireplace-monitor
sudo -n systemctl restart fireplace-monitor   # restart picks up pulled code (enable --now won't)
sleep 1
echo "==> status: $(systemctl is-active fireplace-monitor)"
curl -s -o /dev/null -w "==> local /api/progress → HTTP %{http_code}\n" "http://127.0.0.1:$PORT/api/progress"
echo "==> browse: http://$(hostname).local:$PORT/"
