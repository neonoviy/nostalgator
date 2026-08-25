[English](README.md) | [Русский](README.ru.md)

# Nostalgator

A program for viewing a photo archive with automatic place and face recognition. Use it on your homelab or NAS. Or don't — it's aplha.

# WARNING

This project is heavily vibecoded. Proceed accordingly.

## Features

- Nostalgator displays a photo folder in the following format: `/YYYY/MM.DD Event Name`
  — A timeline of event folders is shown. Each event can be assigned tags: Participants, Location, Event Type, Tag
- Filtering by tags and years is available
- You can draw a polygon on the map, and all events containing photos with GPS tags inside that polygon will receive the corresponding location tag.
- You can assign a name to a face in a photo, and all events with that person will receive a participant label.
- Access control is implemented.
- Drag-and-drop file upload to the import folder is supported.
- Everything placed in the import folder is moved to Originals into `/YYYY/MM.DD/` (if this feature is enabled in settings)

## Technical Details

- EXIF extraction (date/time, GPS) via `exiftool-vendored`
- Reverse geocoding via Nominatim; place clustering via `@turf/turf`, `geokdbush`, `kdbush`
- Interactive map (MapLibre/MapTiler)
- Face recognition via InsightFace in a Python worker (`buffalo_l` models, ONNX Runtime)
- Persistent mode with descriptor caching (`Float32Array`) for 50K+ scales
- Thumbnail generation: `sharp` for images, `fluent-ffmpeg` for videos
- Background scan queue with progress via WebSocket
- Drag-and-drop import with background processing
- JWT authentication, role-based access (`admin`/`user`), event access by groups
- Filters by tags, groups, event types, participants, locations, date range
- Dark theme
- Swagger API documentation at `/api-docs`
- Self-hosted deployment, no cloud services required

## Tech Stack

- **Backend:** Node.js, Express, Prisma (SQLite), `exiftool-vendored`, `fluent-ffmpeg`, `sharp`, `@turf/turf`, `geokdbush`, `kdbush`, `ws`, `swagger-jsdoc`
- **Frontend:** Vue 3, Vite, Pinia, Vue Router, Vue I18n, MapLibre
- **ML:** InsightFace (`buffalo_l`), ONNX Runtime (CPU/CUDA), Python worker
- **Infrastructure:** Docker multi-stage build (CPU + CUDA), NVIDIA Container Toolkit

## Architecture

Node.js/Express backend + Vue 3 SPA. Face recognition runs in a separate Python process (`face_worker.py`) via stdin/stdout. Communication is via REST API + WebSocket for real-time events.

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/neonoviy/nostalgator.git
cd nostalgator

# 2. Install dependencies
npm install

# 3. Start development servers
npm run dev-all
```

## Configuration

Copy `.env.example` to `.env` and configure paths and keys:

| Variable               | Purpose                                                       |
| ---------------------- | ------------------------------------------------------------- |
| `ORIGINALS_PATH`       | Path to original photos/videos                                |
| `THUMBNAILS_PATH`      | Path for thumbnails + SQLite database                         |
| `IMPORT_PATH`          | Path for drag-and-drop import folder                          |
| `SERVER_PORT`          | Backend port (default `3001`)                                 |
| `AUTODETECT_PLACES`    | Auto-detect places from EXIF GPS (`true`/`false`)             |
| `AUTODETECT_FACES`     | Auto-start face recognition after scan (`true`/`false`)       |
| `FACE_MATCH_THRESHOLD` | Cosine similarity threshold for face matching (default `0.6`) |

## Docker

### Two images: CPU and CUDA

The project provides two Docker images:

| Image                          | Purpose                                                            | Size  | GPU                     |
| ------------------------------ | ------------------------------------------------------------------ | ----- | ----------------------- |
| `nostalgator:2.0.0-alpha`      | CPU-only, no CUDA dependencies                                     | ~3 GB | Not required            |
| `nostalgator-cuda:2.0.0-alpha` | onnxruntime-gpu + cuDNN, CUDA runtime via NVIDIA Container Toolkit | 8 GB  | Required (`--gpus all`) |

### Prerequisites

You need 3 folders:

| Container mount    | Purpose                           |
| ------------------ | --------------------------------- |
| `/data/Originals`  | Original photos and videos        |
| `/data/Thumbnails` | Thumbnails + SQLite database      |
| `/data/Import`     | Staging for drag-and-drop imports |

Create them before running the container:

> **Important:** The `/data/Thumbnails` directory stores the SQLite database (`nostalgator.db`). Backing up this directory preserves your database.

### Step-by-step build and run

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

**CUDA (requires NVIDIA GPU + NVIDIA Container Toolkit):**

```bash
docker compose build nostalgator-cuda
```

#### 3. Run the container

Replace `/path/to/Originals`, `/path/to/Thumbnails`, `/path/to/Import` with actual paths on your host.

**CPU:**

```bash
docker run -d --name nostalgator -p 3001:3001 \
  -v /path/to/Originals:/data/Originals \
  -v /path/to/Thumbnails:/data/Thumbnails \
  -v /path/to/Import:/data/Import \
  nostalgator:2.0.0-alpha
```

**CUDA:**

```bash
docker run -d --name nostalgator-cuda --gpus all -p 3001:3001 \
  -v /path/to/Originals:/data/Originals \
  -v /path/to/Thumbnails:/data/Thumbnails \
  -v /path/to/Import:/data/Import \
  nostalgator-cuda:2.0.0-alpha
```

#### 4. Verify

Open http://localhost:3001 in your browser.

#### 5. Stop

```bash
docker compose down
```

Or:

```bash
docker stop nostalgator && docker rm nostalgator
```

### CUDA image details

The image includes `onnxruntime-gpu` and `nvidia-cudnn-cu12`. CUDA runtime libraries (libcudart, cublas, cufft, curand, etc.) are not built into the image — they are provided by the host via **NVIDIA Container Toolkit** when running with the `--gpus all` flag. cuDNN is not provided by the Toolkit and is installed via pip. This reduces image size compared to building all cu12 libraries.

> **Windows:** Ensure Docker Desktop is configured for the WSL 2 backend and the [NVIDIA driver for WSL](https://www.nvidia.com/drivers/data-center/winusb-driver-for-wsl) is installed. The RTX 3080 Ti requires driver version 535 or newer.

## npm Scripts

| Script                   | Purpose                           |
| ------------------------ | --------------------------------- |
| `npm run dev-all`        | Start both servers simultaneously |
| `npm run reset-password` | Reset admin password              |
| `npm run docs`           | Generate JSDoc API documentation  |
| `npm run test`           | Run Node.js tests                 |
| `npm run lint`           | Run ESLint                        |

## License

The project is distributed under the **AGPL-3.0** license — see the [LICENSE](LICENSE) file for details.
