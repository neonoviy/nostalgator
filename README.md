# Nostalgator

Self-hosted photo and video archive viewer with automatic place recognition (EXIF/Nominatim) and face recognition (InsightFace).

# WARNING

It's vibecoded. I have not ever read this readme. I will fix it later.

## Features

- Year-grouped timeline with infinite scroll
- EXIF extraction (datetime, GPS) via `exiftool-vendored`
- Reverse geocoding via Nominatim; place clustering via `@turf/turf`, `geokdbush`, `kdbush`
- Interactive map (MapLibre/MapTiler)
- InsightFace face recognition in Python worker (`buffalo_l` models, ONNX Runtime)
- Persistent recognition mode with descriptor caching (`Float32Array`) for 50K+ scale
- Passerby heuristic (1-photo persons excluded from matching)
- Thumbnail generation: `sharp` for images, `fluent-ffmpeg` for videos
- Background scan queue with WebSocket progress
- Drag-and-drop import with background processing
- JWT authentication, role-based access (`admin`/`user`), group-based event access
- Tags, groups, event types, participants, date-range filters
- Dark mode
- Swagger API docs at `/api-docs`
- Self-hosted, no cloud dependencies

## Tech Stack

- **Backend:** Node.js, Express, Prisma (SQLite), `exiftool-vendored`, `fluent-ffmpeg`, `sharp`, `@turf/turf`, `geokdbush`, `kdbush`, `ws`, `swagger-jsdoc`
- **Frontend:** Vue 3, Vite, Pinia, Vue Router, Vue I18n, MapLibre
- **ML:** InsightFace (`buffalo_l`), ONNX Runtime (CPU/CUDA), Python worker
- **Infrastructure:** Docker multi-stage (CPU + CUDA), NVIDIA Container Toolkit

## Architecture

Node.js/Express backend + Vue 3 SPA. Face recognition runs in a separate Python child process (`face_worker.py`) communicating via stdin/stdout. REST API + WebSocket for real-time updates.

## Quick Start

```bash
# 1. Clone
git clone https://github.com/neonoviy/nostalgator.git
cd nostalgator

# 2. Install dependencies
npm install

# 3. Initialize environment and database
npm run setup

# 4. Start development servers
npm run dev-all
```

## Configuration

Copy `.env.example` to `.env` and adjust paths and keys:

| Variable                | Purpose                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `ORIGINALS_PATH`        | Path to original photos/videos                                |
| `THUMBNAILS_PATH`       | Path for generated thumbnails + SQLite database               |
| `IMPORT_PATH`           | Path for drag-and-drop imports                                |
| `SERVER_PORT`           | Backend port (default `3001`)                                 |
| `JWT_SECRET`            | Secret for JWT authentication                                 |
| `MAPTILER_KEY`          | MapTiler API key for map tiles                                |
| `NOMINATIM_EMAIL`       | Email for Nominatim reverse geocoding requests                |
| `AUTODETECT_PLACES`     | Auto-detect places from EXIF GPS (`true`/`false`)             |
| `AUTODETECT_FACES`      | Auto-run face recognition after scan (`true`/`false`)         |
| `FACE_PERSISTENT`       | Run recognition in persistent stream mode (`true`/`false`)    |
| `FACE_MATCH_THRESHOLD`  | Cosine similarity threshold for face matching (default `0.6`) |
| `FACE_CHUNK_SIZE`       | Images per Python worker batch (default `200`)                |
| `FACE_CHUNK_TIMEOUT`    | Timeout per chunk in seconds (default `600`)                  |
| `SCAN_INTERVAL_MINUTES` | Auto-scan interval in minutes                                 |

## Docker

### Two images: CPU and CUDA

The project provides two Docker images:

| Image                          | Purpose                    | Size    | GPU                     |
| ------------------------------ | -------------------------- | ------- | ----------------------- |
| `nostalgator:2.0.0-alpha`      | CPU-only, no CUDA deps     | ~2.9 GB | Not required            |
| `nostalgator-cuda:2.0.0-alpha` | CUDA runtime libs baked in | ~6-8 GB | Required (`--gpus all`) |

Both services in `docker-compose.yml` share port 3001 and the same volumes — only one can run at a time.

### Prerequisites

Before starting, you **must** prepare three host directories that the container will use. These are mandatory — the container will not run without them:

| Container mount    | Purpose                                | Your host path      |
| ------------------ | -------------------------------------- | ------------------- |
| `/data/Originals`  | Original photos and videos             | e.g. `./Originals`  |
| `/data/Thumbnails` | Generated thumbnails + SQLite database | e.g. `./Thumbnails` |
| `/data/Import`     | Drag-and-drop import staging           | e.g. `./Import`     |

Create them before running the container:

```bash
mkdir -p ./Originals ./Thumbnails ./Import
```

> **Important:** The `/data/Thumbnails` directory stores the SQLite database (`nostalgator.db`). Back up this directory to preserve your database.

### Step-by-step: build and run

#### 1. Clone the repository

```bash
git clone https://github.com/neonoviy/nostalgator.git
cd nostalgator
```

#### 2. Build the image

Choose the variant that matches your hardware:

**CPU (no GPU required):**

```bash
docker compose build nostalgator
```

Or manually:

```bash
docker build -t nostalgator:2.0.0-alpha .
```

**CUDA (requires NVIDIA GPU + NVIDIA Container Toolkit):**

```bash
docker compose build nostalgator-cuda
```

Or manually:

```bash
docker build -f Dockerfile.cuda -t nostalgator-cuda:2.0.0-alpha .
```

#### 3. Run the container

Replace `/path/to/Originals`, `/path/to/Thumbnails`, `/path/to/Import` with your actual host paths.

**CPU via Compose:**

```bash
docker compose up nostalgator
```

**CPU manually:**

```bash
docker run -d --name nostalgator -p 3001:3001 \
  -v /path/to/Originals:/data/Originals \
  -v /path/to/Thumbnails:/data/Thumbnails \
  -v /path/to/Import:/data/Import \
  nostalgator:2.0.0-alpha
```

**CUDA via Compose:**

```bash
docker compose up nostalgator-cuda
```

**CUDA manually:**

```bash
docker run -d --name nostalgator-cuda --gpus all -p 3001:3001 \
  -v /path/to/Originals:/data/Originals \
  -v /path/to/Thumbnails:/data/Thumbnails \
  -v /path/to/Import:/data/Import \
  nostalgator-cuda:2.0.0-alpha
```

#### 4. Verify

Open http://localhost:3001 in your browser. Check the logs for startup status:

```bash
docker logs -f nostalgator
```

- CPU variant logs: `=== Запуск Node.js приложения (CPU) ===`
- CUDA variant logs: `[GPU] NVIDIA libs загружены в LD_LIBRARY_PATH`

#### 5. Stop

```bash
docker compose down
```

Or:

```bash
docker stop nostalgator && docker rm nostalgator
```

### CUDA image details

Includes `onnxruntime-gpu` and NVIDIA cu12 runtime libraries (cublas, cudnn, cufft, curand, nvjitlink) baked in at build time. Requires an NVIDIA GPU and the NVIDIA Container Toolkit.

> **Windows:** Ensure Docker Desktop is configured with the WSL 2 backend and that the [NVIDIA driver for WSL](https://www.nvidia.com/drivers/data-center/winusb-driver-for-wsl) is installed. The RTX 3080 Ti requires driver version 535 or newer.

## npm Scripts

| Script                   | Description                           |
| ------------------------ | ------------------------------------- |
| `npm run dev`            | Start Vite dev server                 |
| `npm run server`         | Start Express API server              |
| `npm run dev-all`        | Start both servers concurrently       |
| `npm run setup`          | Initialize `.env` and database        |
| `npm run build`          | Build production bundle               |
| `npm run preview`        | Preview production build              |
| `npm run init-env`       | Initialize `.env` from `.env.example` |
| `npm run db:reset`       | Reset database                        |
| `npm run db:seed`        | Seed database                         |
| `npm run import`         | Import media from Import folder       |
| `npm run reset-password` | Reset admin password                  |
| `npm run docs`           | Generate JSDoc API docs               |
| `npm run test`           | Run Node.js tests                     |
| `npm run lint`           | Run ESLint                            |
| `npm run lint:fix`       | Fix ESLint errors                     |
| `npm run format`         | Format code with Prettier             |
| `npm run format:check`   | Check code formatting                 |

## License

This project is licensed under the **AGPL-3.0** — see the [LICENSE](LICENSE) file for details.
