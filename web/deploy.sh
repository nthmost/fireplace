#!/bin/bash
# Deploy fireplace.nthmost.com (static demo) to the VPS.
# Usage: ./deploy.sh [user@host] [remote_path]
set -e

USER_HOST="${1:-nthmost@nthmost.com}"
REMOTE_PATH="${2:-/var/www/fireplace.nthmost.com}"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "Deploying ${HERE} → ${USER_HOST}:${REMOTE_PATH} ..."
ssh "${USER_HOST}" "sudo -n mkdir -p '${REMOTE_PATH}' && sudo -n chown \$(whoami) '${REMOTE_PATH}'"
rsync -avz --delete \
  --exclude 'deploy.sh' \
  "${HERE}/" "${USER_HOST}:${REMOTE_PATH}/"

echo "Done. Visit https://fireplace.nthmost.com"
