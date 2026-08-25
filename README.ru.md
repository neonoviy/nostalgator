# Nostalgator

Программа для просмотра фотоархива с автоматическим распознаванием мест и лиц.

# ВИНМАНИЕ

Тут навайбкожено и я даже это ридми ещё не читал. Позже я приведу всё в порыдок.

## Возможности

- Лента событий с группировкой по годам
- Извлечение EXIF (дата/время, GPS) через `exiftool-vendored`
- Обратное геокодирование через Nominatim; кластеризация мест через `@turf/turf`, `geokdbush`, `kdbush`
- Интерактивная карта (MapLibre/MapTiler)
- Распознавание лиц через InsightFace в Python-воркере (модели `buffalo_l`, ONNX Runtime)
- Персистентный режим с кэшированием дескрипторов (`Float32Array`) для масштабов 50K+
- Эвристика «прохожие» (персоны с 1 фото исключаются из сопоставления)
- Генерация превью: `sharp` для изображений, `fluent-ffmpeg` для видео
- Фоновая очередь сканирования с прогрессом через WebSocket
- Импорт drag-and-drop с фоновой обработкой
- JWT-аутентификация, ролевой доступ (`admin`/`user`), доступ к событиям по группам
- Фильтры по тегам, группам, типам событий, участникам, местам, диапазону дат
- Тёмная тема
- Swagger-документация API на `/api-docs`
- Самодостаточное развёртывание, без облачных сервисов

## Технологический стек

- **Backend:** Node.js, Express, Prisma (SQLite), `exiftool-vendored`, `fluent-ffmpeg`, `sharp`, `@turf/turf`, `geokdbush`, `kdbush`, `ws`, `swagger-jsdoc`
- **Frontend:** Vue 3, Vite, Pinia, Vue Router, Vue I18n, MapLibre
- **ML:** InsightFace (`buffalo_l`), ONNX Runtime (CPU/CUDA), Python-воркер
- **Инфраструктура:** Docker многоэтапная сборка (CPU + CUDA), NVIDIA Container Toolkit

## Архитектура

Backend на Node.js/Express + SPA на Vue 3. Распознавание лиц выполняется в отдельном Python-процессе (`face_worker.py`) через stdin/stdout. Взаимодействие — REST API + WebSocket для событий в реальном времени.

## Быстрый старт

```bash
# 1. Клонировать репозиторий
git clone https://github.com/neonoviy/nostalgator.git
cd nostalgator

# 2. Установить зависимости
npm install

# 3. Инициализировать окружение и базу данных
npm run setup

# 4. Запустить серверы разработки
npm run dev-all
```

## Конфигурация

Скопируйте `.env.example` в `.env` и настройте пути и ключи:

| Переменная              | Назначение                                                            |
| ----------------------- | --------------------------------------------------------------------- |
| `ORIGINALS_PATH`        | Путь к исходным фото/видео                                            |
| `THUMBNAILS_PATH`       | Путь для превью + базы данных SQLite                                  |
| `IMPORT_PATH`           | Путь для импорта drag-and-drop                                        |
| `SERVER_PORT`           | Порт бэкенда (по умолчанию `3001`)                                    |
| `JWT_SECRET`            | Секрет для JWT-аутентификации                                         |
| `MAPTILER_KEY`          | API-ключ MapTiler для тайлов карты                                    |
| `NOMINATIM_EMAIL`       | Email для запросов обратного геокодирования Nominatim                 |
| `AUTODETECT_PLACES`     | Автоопределение мест по EXIF GPS (`true`/`false`)                     |
| `AUTODETECT_FACES`      | Автозапуск распознавания лиц после сканирования (`true`/`false`)      |
| `FACE_PERSISTENT`       | Персистентный потоковый режим распознавания (`true`/`false`)          |
| `FACE_MATCH_THRESHOLD`  | Порог косинусного сходства для сопоставления лиц (по умолчанию `0.6`) |
| `FACE_CHUNK_SIZE`       | Изображений в одном батче Python-воркера (по умолчанию `200`)         |
| `FACE_CHUNK_TIMEOUT`    | Таймаут на чанк в секундах (по умолчанию `600`)                       |
| `SCAN_INTERVAL_MINUTES` | Интервал автоматического сканирования в минутах                       |

## Docker

### Два образа: CPU и CUDA

Проект предоставляет два Docker-образа:

| Образ                          | Назначение                                                           | Размер  | GPU                      |
| ------------------------------ | -------------------------------------------------------------------- | ------- | ------------------------ |
| `nostalgator:2.0.0-alpha`      | Только CPU, без CUDA-зависимостей                                    | ~2.9 ГБ | Не требуется             |
| `nostalgator-cuda:2.0.0-alpha` | onnxruntime-gpu + cuDNN, CUDA runtime через NVIDIA Container Toolkit | ~4-5 ГБ | Требуется (`--gpus all`) |

Оба сервиса в `docker-compose.yml` используют порт 3001 и одни и те же тома — одновременно может работать только один из них.

### Предварительные требования

Перед запуском вы **обязаны** подготовить три директории на хосте, которые будет использовать контейнер:

| Монтирование контейнера | Назначение                          | Путь на хосте           |
| ----------------------- | ----------------------------------- | ----------------------- |
| `/data/Originals`       | Исходные фото и видео               | например `./Originals`  |
| `/data/Thumbnails`      | Превью + база данных SQLite         | например `./Thumbnails` |
| `/data/Import`          | Стейджинг для импорта drag-and-drop | например `./Import`     |

Создайте их перед запуском контейнера:

```bash
mkdir -p ./Originals ./Thumbnails ./Import
```

> **Важно:** В директории `/data/Thumbnails` хранится база данных SQLite (`nostalgator.db`). Резервное копирование этой директории сохраняет вашу базу.

### Пошаговая сборка и запуск

#### 1. Клонировать репозиторий

```bash
git clone https://github.com/neonoviy/nostalgator.git
cd nostalgator
```

#### 2. Собрать образ

Выберите вариант, соответствующий вашему железу:

**CPU (GPU не требуется):**

```bash
docker compose build nostalgator
```

Или вручную:

```bash
docker build -t nostalgator:2.0.0-alpha .
```

**CUDA (требуется NVIDIA GPU + NVIDIA Container Toolkit):**

```bash
docker compose build nostalgator-cuda
```

Или вручную:

```bash
docker build -f Dockerfile.cuda -t nostalgator-cuda:2.0.0-alpha .
```

#### 3. Запустить контейнер

Замените `/path/to/Originals`, `/path/to/Thumbnails`, `/path/to/Import` на реальные пути на вашем хосте.

**CPU через Compose:**

```bash
docker compose up nostalgator
```

**CPU вручную:**

```bash
docker run -d --name nostalgator -p 3001:3001 \
  -v /path/to/Originals:/data/Originals \
  -v /path/to/Thumbnails:/data/Thumbnails \
  -v /path/to/Import:/data/Import \
  nostalgator:2.0.0-alpha
```

**CUDA через Compose:**

```bash
docker compose up nostalgator-cuda
```

**CUDA вручную:**

```bash
docker run -d --name nostalgator-cuda --gpus all -p 3001:3001 \
  -v /path/to/Originals:/data/Originals \
  -v /path/to/Thumbnails:/data/Thumbnails \
  -v /path/to/Import:/data/Import \
  nostalgator-cuda:2.0.0-alpha
```

#### 4. Проверить работу

Откройте http://localhost:3001 в браузере. Проверьте логи на предмет статуса запуска:

```bash
docker logs -f nostalgator
```

- CPU-образ: `=== Запуск Node.js приложения (CPU) ===`
- CUDA-образ: `[GPU] CUDA активен (NVIDIA Container Toolkit)`

#### 5. Остановить

```bash
docker compose down
```

Или:

```bash
docker stop nostalgator && docker rm nostalgator
```

### Детали CUDA-образа

В образ включён `onnxruntime-gpu` и `nvidia-cudnn-cu12`. CUDA runtime-библиотеки (libcudart, cublas, cufft, curand и др.) не собираются внутрь образа — они предоставляются хостом через **NVIDIA Container Toolkit** при запуске с флагом `--gpus all`. cuDNN не предоставляется Toolkit'ом и устанавливается через pip. Это уменьшает размер образа по сравнению с полной сборкой всех библиотек cu12.

> **Windows:** Убедитесь, что Docker Desktop настроен на бэкенд WSL 2 и установлен [драйвер NVIDIA для WSL](https://www.nvidia.com/drivers/data-center/winusb-driver-for-wsl). Для RTX 3080 Ti требуется драйвер версии 535 или новее.

## npm-скрипты

| Скрипт                   | Назначение                               |
| ------------------------ | ---------------------------------------- |
| `npm run dev`            | Запустить Vite-сервер разработки         |
| `npm run server`         | Запустить Express API-сервер             |
| `npm run dev-all`        | Запустить оба сервера одновременно       |
| `npm run setup`          | Инициализировать `.env` и базу данных    |
| `npm run build`          | Собрать продакшен-бандл                  |
| `npm run preview`        | Просмотреть продакшен-сборку             |
| `npm run init-env`       | Создать `.env` из `.env.example`         |
| `npm run db:reset`       | Сбросить базу данных                     |
| `npm run db:seed`        | Заполнить базу данных начальными данными |
| `npm run import`         | Импортировать медиа из папки Import      |
| `npm run reset-password` | Сбросить пароль администратора           |
| `npm run docs`           | Сгенерировать JSDoc-документацию API     |
| `npm run test`           | Запустить тесты Node.js                  |
| `npm run lint`           | Запустить ESLint                         |
| `npm run lint:fix`       | Исправить ошибки ESLint                  |
| `npm run format`         | Форматировать код через Prettier         |
| `npm run format:check`   | Проверить форматирование кода            |

## Лицензия

Проект распространяется под лицензией **AGPL-3.0** — см. файл [LICENSE](LICENSE) для подробностей.
