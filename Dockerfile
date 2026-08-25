# ==========================================
# CPU-only image (no GPU/CUDA dependencies)
# ==========================================

# ==========================================
# STAGE 1: Python Builder (CPU deps, smaller footprint)
# ==========================================
# Базовый образ для сборки Python-зависимостей (CPU-вариант) на Debian Bookworm
FROM python:3.10-slim-bookworm AS python-builder

# Устанавливаем минимально необходимые системные пакеты: pip, сертификаты, curl и xz-utils
# для распаковки static ffmpeg. --no-install-recommends/-suggests уменьшает размер.
# После установки очищаем кэш apt, чтобы не тащить его в слой.
RUN apt-get update && apt-get install -y --no-install-recommends --no-install-suggests \
    python3-pip ca-certificates curl xz-utils \
  && rm -rf /var/lib/apt/lists/* \
  && apt-get clean

# Копируем манифест CPU-зависимостей в builder-стадию
COPY requirements.txt ./

# Устанавливаем зависимости в отдельную папку /opt/python-deps (без pip-кэша),
# затем вычищаем pip-кэш и мусорные артефакты Python (__pycache__, *.pyc, *.pyo,
# папки tests, README *.md), чтобы уменьшить размер слоя.
RUN pip3 install --no-cache-dir --target /opt/python-deps -r requirements.txt \
  && rm -rf /root/.cache/pip \
  && find /opt/python-deps -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true \
  && find /opt/python-deps -type f -name "*.pyc" -delete 2>/dev/null || true \
  && find /opt/python-deps -type f -name "*.pyo" -delete 2>/dev/null || true \
  && find /opt/python-deps -type f -name "*.md" -delete 2>/dev/null || true

# Скачиваем и распаковываем статические бинарники ffmpeg/ffprobe (~25 МБ, без системных зависимостей)
# из релизов johnvansickle.com прямо в /usr/local/bin и делаем исполняемыми.
RUN curl -fsSL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
    | tar -xJf - --wildcards -C /tmp --strip-components=1 'ffmpeg-*-static/ffmpeg' 'ffmpeg-*-static/ffprobe' \
    && mv /tmp/ffmpeg /tmp/ffprobe /usr/local/bin/ \
    && chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe

# ==========================================
# STAGE 2: Node.js / Prisma & Models Builder
# ==========================================
# Базовый образ Node.js 22 для сборки фронтенда/бэкенда и генерации Prisma-клиента
FROM node:22.12.0-slim AS node-builder
# Рабочая директория сборки
WORKDIR /app

# Обновляем apt и ставим только ca-certificates (нужны для https-загрузок npm), чистим списки пакетов
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Копируем манифесты npm и устанавливаем production-зависимости + prisma@5
# для генерации клиента. npm cache чистится принудительно.
COPY package.json package-lock.json ./
RUN npm ci --production \
  && npm install prisma@5 \
  && npm cache clean --force

# Копируем весь исходный контекст проекта в builder
COPY . .

# Создаём папку под модели InsightFace (buffalo_l), чтобы сборка/контекст были консистентны
RUN mkdir -p /app/src/models/insightface/models/buffalo_l

# Собираем проект (npm run build) и генерируем Prisma-клиент (npx prisma generate)
RUN npm run build \
  && npx prisma generate

# Очистка node_modules: удаляем лишние движки Prisma под другие ОС, кэш,
# README (*.md), TypeScript-исходники (кроме *.node), папки test/docs — ради размера образа.
RUN find node_modules/.prisma/client/ -type f -name "libquery_engine-*" ! -name "libquery_engine-debian-openssl-*.so.node" -delete 2>/dev/null || true \
  && rm -rf node_modules/.cache \
  && find node_modules/ -type f -name "*.md" -delete 2>/dev/null || true \
  && find node_modules/ -type f -name "*.ts" ! -name "*.node" -delete 2>/dev/null || true \
  && find node_modules/ -type d -name "test" -exec rm -rf {} + 2>/dev/null || true \
  && find node_modules/ -type d -name "docs" -exec rm -rf {} + 2>/dev/null || true

# ==========================================
# STAGE 3: Final Minimal Runtime (Debian-based)
# ==========================================
# Финальный минимальный рантайм-образ на Python 3.10 (Debian Bookworm)
FROM python:3.10-slim-bookworm

# Аргумент сборки — версия приложения (по умолчанию 2.0.0)
ARG APP_VERSION=2.0.0
# Метка образа с версией
LABEL version=$APP_VERSION

# Ставим рантайм-зависимости: curl, сертификаты, libgl1 и libglib2.0-0
# (нужны для OpenCV / InsightFace), чистим apt-кэш.
RUN apt-get update && apt-get install -y --no-install-recommends --no-install-suggests \
    curl \
    ca-certificates \
    libgl1 \
    libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/* \
  && apt-get clean

# Распаковываем Node.js 22 (linux-x64 tarball) прямо в /usr/local — чтобы в рантайме
# был нужный раннер для запуска сервера.
RUN curl -fsSL https://nodejs.org/dist/v22.12.0/node-v22.12.0-linux-x64.tar.gz \
    | tar -xzf - -C /usr/local --strip-components=1

# Копируем entrypoint-скрипт и делаем его исполняемым
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# App
# Рабочая директория приложения
WORKDIR /app

# Переносим собранные Python-зависимости из python-builder
COPY --from=python-builder /opt/python-deps /opt/python-deps

# Static ffmpeg binaries (~25 MB, no system deps)
# Переносим статические бинарники ffmpeg/ffprobe из python-builder
COPY --from=python-builder /usr/local/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=python-builder /usr/local/bin/ffprobe /usr/local/bin/ffprobe

# Переносим собранные артефакты Node.js: node_modules, dist, prisma, серверный код,
# скрипты, пример .env и манифесты.
COPY --from=node-builder /app/node_modules ./node_modules
COPY --from=node-builder /app/dist ./dist
COPY --from=node-builder /app/prisma ./prisma
COPY --from=node-builder /app/src/server ./src/server
COPY --from=node-builder /app/scripts ./scripts
COPY --from=node-builder /app/.env.example ./.env.example
COPY --from=node-builder /app/package.json ./
COPY --from=node-builder /app/package-lock.json ./

# Монтируем папку моделей из node-builder: если в контексте есть модели buffalo_l —
# копируем их в образ, иначе создаём пустую папку-заглушку.
RUN --mount=from=node-builder,source=/app/src/models/insightface,target=/tmp/models \
    if [ -n "$(ls -A /tmp/models/models/buffalo_l 2>/dev/null)" ]; then \
      mkdir -p /app/src/models && cp -r /tmp/models /app/src/models/insightface; \
      echo "Models baked into image successfully."; \
    else \
      mkdir -p /app/src/models/insightface/models/buffalo_l && \
      echo "No models found in build context — folder initialized as empty."; \
    fi

# Создаём точки монтирования для данных пользователя (оригиналы, превью, импорт)
RUN mkdir -p /data/Originals /data/Thumbnails /data/Import

# Финальная очистка: вырезаем __pycache__/*.pyc/*.pyo из python-deps и
# strip-аем неиспользуемые символы из исполняемых файлов, *.node и *.so — уменьшение веса.
RUN find /opt/python-deps -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true \
  && find /opt/python-deps -type f -name "*.pyc" -delete 2>/dev/null || true \
  && find /opt/python-deps -type f -name "*.pyo" -delete 2>/dev/null || true \
  && find /usr -type f -executable -exec strip --strip-unneeded {} + 2>/dev/null || true \
  && find /app/node_modules -name "*.node" -exec strip --strip-unneeded {} + 2>/dev/null || true \
  && find /opt/python-deps -name "*.so" -exec strip --strip-unneeded {} + 2>/dev/null || true

# Переменные окружения рантайма: пути к данным, URL БД (SQLite в /data/Thumbnails),
# режим production, путь к Python и PYTHONPATH, а также заглушка NVIDIA-возможностей.
ENV ORIGINALS_PATH=/data/Originals \
    THUMBNAILS_PATH=/data/Thumbnails \
    IMPORT_PATH=/data/Import \
    DATABASE_URL=file:/data/Thumbnails/nostalgator.db \
    NODE_ENV=production \
    PYTHON_PATH=python3 \
    PYTHONPATH=/opt/python-deps \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility

# Открываем порт приложения
EXPOSE 3001

# Точка входа — entrypoint-скрипт (настройка окружения перед запуском)
ENTRYPOINT ["docker-entrypoint.sh"]
# Команда по умолчанию — запуск Node.js сервера с загрузкой .env через dotenv
CMD ["node", "-r", "dotenv/config", "src/server/index.js"]
