#!/usr/bin/env bash
# Деплой LEXA на прод: ./deploy.sh
# Заливает код, ставит зависимости, применяет миграции, собирает и перезапускает сервис.
set -euo pipefail

SERVER="lexa@192.166.218.251"
APP_DIR="/home/lexa/app"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Заливаю код на $SERVER"
rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude 'client/dist' \
  --exclude 'server/dist' \
  --exclude '.env' \
  --exclude 'server/.env' \
  --exclude 'docker-compose.yml' \
  "$LOCAL_DIR/" "$SERVER:$APP_DIR/"

echo "==> Собираю и перезапускаю на сервере"
ssh "$SERVER" bash -s <<EOF
set -euo pipefail
cd "$APP_DIR"

npm ci --no-audit --no-fund 2>&1 | tail -1

(cd server && npx prisma migrate deploy)

npm run build --workspace server
npm run build --workspace client

sudo rsync -a --delete client/dist/ /var/www/lexa/
sudo chown -R www-data:www-data /var/www/lexa

sudo systemctl restart lexa
sleep 5
sudo systemctl is-active --quiet lexa || { echo "lexa.service не поднялся:"; sudo journalctl -u lexa --no-pager -n 20 -o cat; exit 1; }
EOF

echo "==> Проверяю health"
HEALTH=$(curl -sf --max-time 10 http://192.166.218.251/api/health)
echo "health: $HEALTH"
echo "$HEALTH" | grep -q '"status":"ok"' && echo "==> Деплой успешен: http://192.166.218.251" || { echo "==> Health-check не прошёл"; exit 1; }
