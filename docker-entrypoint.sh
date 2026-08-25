#!/bin/sh
set -e

echo "=== Запуск Node.js приложения (CPU) ==="

if [ $# -eq 0 ]; then
  exec node -r dotenv/config src/server/index.js
else
  exec "$@"
fi
