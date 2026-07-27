#!/usr/bin/env bash
# Push code + a freshly-built frontend to the Oracle VM and restart the service.
# One-time setup lives in DEPLOY-ORACLE.md; this is for day-to-day updates.
#
#   ./deploy.sh                      # uses the default host below
#   ./deploy.sh ubuntu@1.2.3.4       # override host
#
# Secrets (backend/.env) and data/ are NOT touched — they live on the box.
set -euo pipefail

HOST="${1:-ubuntu@140.238.76.193}"
REMOTE="/opt/ais/ais-tracker"
cd "$(dirname "$0")"

echo "▸ building frontend…"
( cd frontend && npm run build >/dev/null )

echo "▸ syncing backend (code only)…"
rsync -az --delete \
  --exclude '.venv' --exclude '__pycache__' --exclude '*.pyc' \
  --exclude 'data' --exclude '.env' \
  backend/ "$HOST:$REMOTE/backend/"

echo "▸ syncing frontend build…"
rsync -az --delete frontend/dist/ "$HOST:$REMOTE/frontend/dist/"

echo "▸ updating deps + restarting…"
ssh "$HOST" "
  $REMOTE/.venv/bin/pip install -q -r $REMOTE/backend/requirements.txt
  sudo systemctl restart ais
  sleep 5
  curl -s -m 5 http://localhost:8000/healthz | python3 -c 'import sys,json; d=json.load(sys.stdin); print(\"  ✓ live · vessels:\", d[\"vessels\"], \"· sources up:\", sum(1 for s in d[\"sources\"] if s[\"connected\"]), \"/3\")'
"
echo "▸ done → https://arguseyes.xyz (or http://${HOST#*@})"
