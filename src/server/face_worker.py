import sys
import json
import os
import time
import io
import ctypes
import subprocess
import threading
import signal
import gc
from queue import Queue
import cv2
import numpy as np
import base64

# Keep onnxruntime diagnostics at warning level (2) so silent CUDA->CPU fallback
# and provider-selection problems are still surfaced, but the verbose per-session
# statistics (level 0) are suppressed. Must be set before importing onnxruntime.
# setdefault keeps an explicit env override as escape hatch (ORT_LOG_SEVERITY_LEVEL=0
# re-enables full verbose diagnostics for debugging).
os.environ.setdefault('ORT_LOG_SEVERITY_LEVEL', '2')

MODEL_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'models', 'insightface')
os.makedirs(MODEL_ROOT, exist_ok=True)

try:
    import insightface
except ImportError:
    print(json.dumps({"error": "insightface not installed. Run: pip install insightface onnxruntime-gpu opencv-python-headless"}))
    sys.exit(1)

try:
    import onnxruntime as ort
    AVAILABLE_PROVIDERS = ort.get_available_providers()
    HAS_CUDA = 'CUDAExecutionProvider' in AVAILABLE_PROVIDERS
except Exception:
    AVAILABLE_PROVIDERS = []
    HAS_CUDA = False


def _preload_cuda_dlls():
    """On Windows, add NVIDIA CUDA pip package bin directories to the DLL
    search path AND pre-load all CUDA runtime DLLs (cublasLt64_12.dll,
    cudnn64_9.dll, cufft64_11.dll, etc.) so that onnxruntime can find them
    during session creation.

    os.add_dll_directory() alone is not sufficient: onnxruntime's internal
    C++ LoadLibrary calls use a different search path than Python's ctypes.
    Pre-loading puts DLLs in the process's loaded module list, which both
    Python and C++ code resolve by name.

    On Linux/Docker, CUDA libraries are found via RPATH or LD_LIBRARY_PATH
    and this function is a no-op. On macOS, CUDA is not supported."""
    if sys.platform != 'win32':
        return
    import importlib.util
    nvidia_packages = [
        'nvidia.cublas', 'nvidia.cudnn', 'nvidia.cuda_runtime',
        'nvidia.cuda_cupti', 'nvidia.cuda_nvrtc', 'nvidia.cufft',
        'nvidia.nvjitlink',
    ]
    for pkg_name in nvidia_packages:
        try:
            spec = importlib.util.find_spec(pkg_name)
            if spec and spec.submodule_search_locations:
                pkg_dir = spec.submodule_search_locations[0]
                bin_dir = os.path.join(pkg_dir, 'bin')
                if os.path.isdir(bin_dir):
                    os.add_dll_directory(bin_dir)
                    for f in os.listdir(bin_dir):
                        if f.endswith('.dll'):
                            try:
                                ctypes.CDLL(os.path.join(bin_dir, f))
                            except (OSError, Exception):
                                pass
        except ImportError:
            pass


_preload_cuda_dlls()

def _cuda_runtime_works():
    """Verify CUDA provider DLL loads with all dependencies.
    onnxruntime may list CUDAExecutionProvider even when CUDA runtime DLLs
    (e.g., cublasLt64_12.dll) are missing. This pre-check prevents noisy
    fallback warnings during inference."""
    if not HAS_CUDA:
        return False
    try:
        ort_dir = os.path.dirname(ort.__file__)
        if sys.platform == 'win32':
            dll = os.path.join(ort_dir, 'capi', 'onnxruntime_providers_cuda.dll')
        elif sys.platform == 'darwin':
            dll = os.path.join(ort_dir, 'capi', 'libonnxruntime_providers_cuda.dylib')
        else:
            dll = os.path.join(ort_dir, 'capi', 'libonnxruntime_providers_cuda.so')

        if os.path.exists(dll):
            ctypes.CDLL(dll)
            return True
        return False
    except (OSError, Exception):
        return False

CUDA_WORKS = _cuda_runtime_works()


def _parse_model_reset_interval():
    """Parse FACE_MODEL_RESET_INTERVAL env var.

    Returns:
        (reset_interval, persistent_mode):
        - reset_interval: int > 0 if set to a numeric value (persistent mode),
        - None if set to 'event' or non-numeric string (non-persistent mode),
        - 1000 (default) if unset.
    """
    raw = os.environ.get('FACE_MODEL_RESET_INTERVAL', '')
    if not raw:
        return 1000, True
    try:
        val = int(raw)
        return max(val, 1), True
    except ValueError:
        return None, False


def _gpu_device_available():
    """Check if a physical CUDA GPU is accessible at runtime.

    _cuda_runtime_works() only verifies DLL loading. In Docker with an
    nvidia/cuda base image, CUDA libraries may be present even without
    a physical GPU (no --gpus flag). This check prevents false positives
    by verifying actual GPU device availability.

    Detection order:
      1. nvidia-smi (injected by NVIDIA runtime with --gpus all; works on
         Docker Engine 29+ where /dev/nvidia* may not be mounted)
      2. /dev/nvidia0 device file (traditional Docker GPU passthrough)
    """
    if not HAS_CUDA:
        return False
    try:
        result = subprocess.run(
            ['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'],
            capture_output=True, timeout=5,
        )
        if result.returncode == 0 and bool(result.stdout.strip()):
            return True
    except Exception:
        pass
    return os.path.exists('/dev/nvidia0')


CUDA_WORKS = CUDA_WORKS and _gpu_device_available()
if HAS_CUDA and not CUDA_WORKS:
    if not _cuda_runtime_works():
        print(
            f"INFO: CUDAExecutionProvider listed but runtime DLLs missing "
            f"(e.g., cublasLt64_12.dll). Using CPU. "
            f"Install CUDA libs: pip install nvidia-cublas-cu12 nvidia-cudnn-cu12 "
            f"nvidia-cufft-cu12 nvidia-cuda-runtime-cu12",
            file=sys.stderr, flush=True
        )
    elif not _gpu_device_available():
        print(
            "INFO: CUDA runtime available but no GPU device detected. Using CPU.",
            file=sys.stderr, flush=True
        )


def _log_gpu_memory(tag=""):
    """Log GPU memory usage via nvidia-smi if available."""
    if not CUDA_WORKS:
        return
    try:
        result = subprocess.run(
            [
                'nvidia-smi',
                '--query-gpu=index,name,memory.used,memory.total,utilization.gpu',
                '--format=csv,noheader,nounits',
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            for line in result.stdout.strip().split('\n'):
                parts = [p.strip() for p in line.split(',')]
                if len(parts) >= 5:
                    print(
                        f"[GPU_MEM] {tag} GPU {parts[0]} {parts[1]}: "
                        f"{parts[2]}/{parts[3]} MB ({parts[4]}%)",
                        file=sys.stderr,
                        flush=True,
                    )
    except Exception:
        pass


class FdSuppressor:
    """Suppress stdout and optionally stderr at the OS file descriptor level.

    Catches C extension prints (e.g., insightface model loading messages) that
    Python's logging/sys.level suppression cannot capture."""
    def __init__(self, suppress_stderr=False):
        self._stdout_fd = sys.stdout.fileno()
        self._stderr_fd = sys.stderr.fileno()
        self._suppress_stderr = suppress_stderr
        self._saved_fds = []

    def __enter__(self):
        sys.stdout.flush()
        sys.stderr.flush()
        self._saved_fds = [os.dup(self._stdout_fd)]
        self._dev_null = os.open(os.devnull, os.O_WRONLY)
        os.dup2(self._dev_null, self._stdout_fd)
        if self._suppress_stderr:
            self._saved_fds.append(os.dup(self._stderr_fd))
            os.dup2(self._dev_null, self._stderr_fd)
        return self

    def __exit__(self, *args):
        sys.stdout.flush()
        sys.stderr.flush()
        for i, fd in enumerate(self._saved_fds):
            target_fd = self._stderr_fd if i > 0 else self._stdout_fd
            os.dup2(fd, target_fd)
        os.close(self._dev_null)
        for fd in self._saved_fds:
            os.close(fd)

def _get_exif_orientation(raw_bytes):
    """Extract EXIF orientation tag from JPEG bytes without external deps.
    Returns 1-8, or 1 (normal) if not found or not a JPEG."""
    if len(raw_bytes) < 10 or raw_bytes[0] != 0xFF or raw_bytes[1] != 0xD8:
        return 1

    idx = 2
    while idx < len(raw_bytes) - 9:
        if raw_bytes[idx] != 0xFF:
            idx += 1
            continue

        marker = raw_bytes[idx + 1] if idx + 1 < len(raw_bytes) else 0
        if marker == 0xD9 or marker == 0xDA:
            break
        if 0xD0 <= marker <= 0xD7 or marker == 0x01:
            idx += 2
            continue

        if idx + 4 > len(raw_bytes):
            break
        seg_len = (raw_bytes[idx + 2] << 8) | raw_bytes[idx + 3]
        if seg_len < 2 or idx + 2 + seg_len > len(raw_bytes):
            break

        if marker == 0xE1:
            exif_start = idx + 4
            if exif_start + 6 <= len(raw_bytes) and raw_bytes[exif_start:exif_start + 6] == b'Exif\x00\x00':
                tiff_start = exif_start + 6
                if tiff_start + 8 > len(raw_bytes):
                    idx += seg_len + 2
                    continue

                byte_order = raw_bytes[tiff_start:tiff_start + 2]
                if byte_order == b'II':
                    endian = '<'
                elif byte_order == b'MM':
                    endian = '>'
                else:
                    idx += seg_len + 2
                    continue

                ifd_offset = int.from_bytes(
                    raw_bytes[tiff_start + 4:tiff_start + 8], 'little' if endian == '<' else 'big'
                )
                ifd_pos = tiff_start + ifd_offset
                if ifd_pos + 2 > len(raw_bytes):
                    idx += seg_len + 2
                    continue

                num_entries = int.from_bytes(raw_bytes[ifd_pos:ifd_pos + 2], endian)
                for i in range(num_entries):
                    entry_pos = ifd_pos + 2 + i * 12
                    if entry_pos + 12 > len(raw_bytes):
                        break
                    tag = int.from_bytes(raw_bytes[entry_pos:entry_pos + 2], endian)
                    if tag == 274:
                        value_offset = entry_pos + 8
                        return int.from_bytes(raw_bytes[value_offset:value_offset + 2], endian)

        idx += seg_len + 2

    return 1

def _apply_exif_orientation(img, orientation):
    """Rotate/flip image based on EXIF orientation."""
    if orientation == 1:
        return img
    elif orientation == 2:
        return cv2.flip(img, 1)
    elif orientation == 3:
        return cv2.rotate(img, cv2.ROTATE_180)
    elif orientation == 4:
        return cv2.flip(cv2.rotate(img, cv2.ROTATE_180), 1)
    elif orientation == 5:
        return cv2.flip(cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE), 1)
    elif orientation == 6:
        return cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
    elif orientation == 7:
        return cv2.flip(cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE), 1)
    elif orientation == 8:
        return cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return img

def _ensure_model_loaded():
    """Initialize insightface app with correct ctx_id for available hardware.
    Returns (app, det_thresh, ctx_id)."""
    ctx_id_env = os.environ.get('FACE_CTX_ID')
    if ctx_id_env is not None:
        ctx_id = int(ctx_id_env)
    elif CUDA_WORKS:
        ctx_id = 0
    else:
        ctx_id = -1

    ort_threads = int(os.environ.get('FACE_ORT_THREADS', '4'))

    providers = ['CUDAExecutionProvider', 'CPUExecutionProvider'] if CUDA_WORKS else ['CPUExecutionProvider']

    sess_options = ort.SessionOptions()
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess_options.intra_op_num_threads = ort_threads
    sess_options.inter_op_num_threads = 1
    sess_options.enable_mem_pattern = True
    sess_options.enable_cpu_mem_arena = True
    # Session-level diagnostic verbosity mirrors ORT_LOG_SEVERITY_LEVEL: warning (2)
    # keeps fallback/provider warnings visible while suppressing verbose ONNX statistics.
    sess_options.log_verbosity_level = 2
    if CUDA_WORKS:
        sess_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL

    # Suppress insightface's noisy C stdout (keep the JSON stream clean) but let
    # onnxruntime's stderr flow straight through unfiltered — every ONNX diagnostic
    # line reaches the host verbatim (no capture/keyword filtering).
    with FdSuppressor():
        app = insightface.app.FaceAnalysis(root=MODEL_ROOT, providers=providers, sess_options=sess_options)
        DET_THRESH = float(os.environ.get('FACE_DETECT_THRESH', '0.6'))
        app.prepare(ctx_id=ctx_id, det_size=(640, 640), det_thresh=DET_THRESH)

    return app, DET_THRESH, ctx_id


def _get_active_providers(app):
    """Query each ONNX session in the InsightFace app for the provider it
    actually applied. ORT may silently drop CUDAExecutionProvider at session
    creation time (e.g. missing cublasLt64_12.dll) even when it appears in the
    requested providers list, so session.get_providers() is the source of
    truth for whether CUDA is genuinely active."""
    active = set()
    try:
        models = getattr(app, 'models', {})
        for _name, model in models.items():
            sess = getattr(model, 'session', None)
            if sess is None:
                continue
            providers = sess.get_providers()
            if isinstance(providers, list):
                active.update(providers)
    except Exception as e:
        print(f"[GPU_CHECK] _get_active_providers failed: {e}", file=sys.stderr, flush=True)
    return active

CUDA_ACTIVE = False
try:
    app, DET_THRESH, CTX_ID = _ensure_model_loaded()
    # Warm-up inference on a dummy frame to confirm the model actually runs and
    # to surface any silent CPU fallback that logs would otherwise hide.
    _warm_ms = 'ERR'
    _warm_faces = 'ERR'
    try:
        _dummy = np.zeros((640, 640, 3), dtype=np.uint8)
        _t0 = time.time()
        _warm = app.get(_dummy)
        _warm_ms = round((time.time() - _t0) * 1000, 1)
        _warm_faces = len(_warm) if _warm is not None else 'ERR'
    except Exception as _we:
        _warm_ms = 'ERR'
        _warm_faces = f'ERR:{_we}'
        print(f"[GPU_CHECK] warm-up inference failed: {_we}", file=sys.stderr, flush=True)

    # Primary GPU detection: query the ONNX sessions for the provider they
    # actually applied. ORT may silently drop CUDAExecutionProvider at session
    # creation (e.g. missing cublasLt64_12.dll) even when it appears in the
    # requested providers list, so session.get_providers() is the source of
    # truth — not the pre-load checks above.
    _active_providers = _get_active_providers(app)
    _actual_cuda_active = 'CUDAExecutionProvider' in _active_providers
    # Honest fallback flag from the authoritative provider list: CUDA was available
    # but ORT applied CPU instead (e.g. missing cublasLt64_12.dll).
    FELL_BACK = CUDA_WORKS and not _actual_cuda_active
    print(
        f"[GPU_CHECK] active_providers={sorted(_active_providers)} "
        f"FELL_BACK={FELL_BACK} warm_ms={_warm_ms} HAS_CUDA={HAS_CUDA}",
        file=sys.stderr, flush=True,
    )

    # Single, truthful status line. Only reports [GPU] when the CUDA EP actually
    # initialized AND the warm-up ran (no silent CPU fallback).
    CUDA_ACTIVE = _actual_cuda_active and _warm_ms != 'ERR'
    if CUDA_ACTIVE:
        print(f"[GPU] CUDA active — onnxruntime {ort.__version__}, ctx_id={CTX_ID}, warmup {_warm_ms}ms", file=sys.stderr, flush=True)
    else:
        if not _active_providers:
            _reason = 'no ONNX sessions available'
        elif 'CUDAExecutionProvider' not in _active_providers:
            _reason = 'onnxruntime fell back to CPU (CUDAExecutionProvider not active)'
        elif FELL_BACK:
            _reason = 'onnxruntime reported fallback'
        elif not CUDA_WORKS:
            _reason = 'runtime libs missing'
        elif _warm_ms == 'ERR':
            _reason = 'warm-up inference failed'
        else:
            _reason = 'unknown'
        print(f"[CPU] CUDA unavailable — onnxruntime {ort.__version__}, reason: {_reason}, FT={DET_THRESH}", file=sys.stderr, flush=True)
except Exception as e:
    print(json.dumps({"error": f"Failed to initialize insightface: {e}"}))
    sys.exit(1)

def process_batch(image_paths):
    total_images = len(image_paths)
    results = [None] * total_images
    MAX_INFLIGHT = 3

    def _preload_image(idx, img_path):
        img_name = os.path.basename(img_path)
        img_start = time.time()

        if not os.path.exists(img_path):
            return idx, {"file": img_name, "faces": []}

        try:
            with open(img_path, 'rb') as f:
                raw_bytes = f.read()
            data = np.frombuffer(raw_bytes, dtype=np.uint8)
            img = cv2.imdecode(data, cv2.IMREAD_REDUCED_COLOR_4)
            jpeg_decode_factor = 4 if img is not None and max(img.shape[0], img.shape[1]) >= 640 else 1
            if jpeg_decode_factor == 1:
                img = cv2.imdecode(data, cv2.IMREAD_COLOR)
        except Exception as e:
            print(f"[{idx+1}/{total_images}] ERROR decoding {img_name}: {e}", file=sys.stderr, flush=True)
            return idx, {"file": img_name, "faces": []}

        if img is None:
            print(f"[{idx+1}/{total_images}] WARNING: {img_name} \u2014 cv2.imdecode returned None", file=sys.stderr, flush=True)
            return idx, {"file": img_name, "faces": []}

        try:
            orientation = _get_exif_orientation(raw_bytes)
        except Exception:
            orientation = 1

        if orientation != 1:
            img = _apply_exif_orientation(img, orientation)

        h, w = img.shape[:2]
        MAX_DIM = 8000
        if w * jpeg_decode_factor > MAX_DIM or h * jpeg_decode_factor > MAX_DIM:
            print(f"[{idx+1}/{total_images}] SKIPPED {img_name}: image too large ({w * jpeg_decode_factor}x{h * jpeg_decode_factor})", file=sys.stderr, flush=True)
            return idx, {"file": img_name, "faces": [], "error": "image too large"}

        MAX_DETECT_DIM = int(os.environ.get('FACE_MAX_DETECT_DIM', '1920'))
        scale = 1.0
        if max(w, h) > MAX_DETECT_DIM:
            scale = MAX_DETECT_DIM / max(w, h)
            new_w, new_h = int(w * scale), int(h * scale)
            img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)

        scale_effective = scale / jpeg_decode_factor

        elapsed = time.time() - img_start
        print(f"[{idx+1}/{total_images}] {img_name}: preloaded ({elapsed:.2f}s, {img.shape[1]}x{img.shape[0]}, jpeg_x={jpeg_decode_factor})", file=sys.stderr, flush=True)

        return idx, (img_name, img, scale_effective)

    preload_queue = Queue(maxsize=MAX_INFLIGHT)
    results = [None] * total_images

    def _preload_loop():
        for idx, img_path in enumerate(image_paths):
            item = _preload_image(idx, img_path)
            preload_queue.put(item)
        preload_queue.put(None)

    producer = threading.Thread(target=_preload_loop, daemon=True)
    producer.start()

    while True:
        item = preload_queue.get()
        if item is None:
            break
        idx, data = item

        if isinstance(data, dict):
            results[idx] = data
            continue

        img_name, img, scale = data
        img_start = time.time()

        try:
            faces = app.get(img)
            raw_face_count = len(faces)
            if raw_face_count == 0:
                for rot_code in [cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_180, cv2.ROTATE_90_COUNTERCLOCKWISE]:
                    rotated = cv2.rotate(img, rot_code)
                    alt_faces = app.get(rotated)
                    del rotated
                    if len(alt_faces) > 0:
                        print(f"[{idx+1}/{total_images}] INFO: found {len(alt_faces)} faces after rotation on {img_name}", file=sys.stderr, flush=True)
                        faces = alt_faces
                        break

            embedding_dtype = None
            valid_face_data = []
            if len(faces) == 0:
                print(f"[{idx+1}/{total_images}] {img_name}: 0 faces (no detection)", file=sys.stderr, flush=True)
            for f in faces:
                try:
                    embedding = f.normed_embedding
                    if embedding is None:
                        continue

                    if embedding_dtype is None:
                        embedding_dtype = str(embedding.dtype)

                    embedding = np.asarray(embedding, dtype=np.float32)
                    if embedding.shape[0] != 512:
                        print(f"[{idx+1}/{total_images}] WARNING: unexpected embedding size {embedding.shape[0]} for {img_name}", file=sys.stderr, flush=True)
                        continue

                    descriptor_bytes = embedding.tobytes()
                    if len(descriptor_bytes) != 2048:
                        print(f"[{idx+1}/{total_images}] WARNING: descriptor bytes={len(descriptor_bytes)} (expected 2048) for {img_name}", file=sys.stderr, flush=True)
                        continue

                    descriptor = base64.b64encode(descriptor_bytes).decode()
                    del embedding
                    del descriptor_bytes

                    valid_face_data.append({
                        "x": int(f.bbox[0] / scale),
                        "y": int(f.bbox[1] / scale),
                        "w": int((f.bbox[2] - f.bbox[0]) / scale),
                        "h": int((f.bbox[3] - f.bbox[1]) / scale),
                        "descriptor": descriptor
                    })
                except Exception:
                    continue

            del faces
            gc.collect()

            results[idx] = {
                "file": img_name,
                "faces": valid_face_data
            }
            elapsed = time.time() - img_start
            if raw_face_count != len(valid_face_data):
                print(f"[{idx+1}/{total_images}] {img_name}: {len(valid_face_data)}/{raw_face_count} faces kept ({elapsed:.2f}s, dtype={embedding_dtype})", file=sys.stderr, flush=True)
            else:
                print(f"[{idx+1}/{total_images}] {img_name}: {len(valid_face_data)} faces ({elapsed:.2f}s, dtype={embedding_dtype})", file=sys.stderr, flush=True)
        except Exception as e:
            elapsed = time.time() - img_start
            print(f"[{idx+1}/{total_images}] ERROR processing {img_name} after {elapsed:.2f}s: {e}", file=sys.stderr, flush=True)
            results[idx] = {"file": img_name, "faces": [], "error": str(e)}
        finally:
            del img
            del data

    producer.join()

    results = [r for r in results if r is not None]

    total_faces = sum(len(r.get('faces', [])) for r in results)
    print(f"SUMMARY: {len(results)}/{total_images} files processed, {total_faces} faces found", file=sys.stderr, flush=True)
    _log_gpu_memory(f"batch {total_images}imgs")

    return results


def _print_gpu_status():
    status = "GPU" if CUDA_ACTIVE else "CPU"
    print(f"[{status}]", file=sys.stderr, flush=True)


_SHUTDOWN_REQUESTED = False


def _cleanup_gpu_memory(tag="signal"):
    """Release GPU memory by unloading the insightface app (ONNX sessions)."""
    global _SHUTDOWN_REQUESTED
    _SHUTDOWN_REQUESTED = True
    try:
        app = globals().get('app')
        if app is not None:
            try:
                if hasattr(app, 'models'):
                    for m in getattr(app, 'models', {}).values():
                        try:
                            sess = getattr(m, 'session', None)
                            if sess is not None:
                                if hasattr(sess, 'end_session'):
                                    sess.end_session()
                        except Exception:
                            pass
                    app.models.clear()
            except Exception:
                pass
            del globals()['app']
            gc.collect()
    except Exception:
        pass
    try:
        _log_gpu_memory(tag)
    except Exception:
        pass


def _signal_handler(signum, frame):
    print(f"[SIGNAL] received {signum}, cleaning up GPU memory", file=sys.stderr, flush=True)
    _cleanup_gpu_memory("signal")
    sys.exit(0)


if _parse_model_reset_interval()[1]:
    _print_gpu_status()
    signal.signal(signal.SIGTERM, _signal_handler)
    signal.signal(signal.SIGINT, _signal_handler)
    try:
        _log_gpu_memory("startup")
    except Exception as e:
        print(f"[GPU_MEM] startup error: {e}", file=sys.stderr, flush=True)
    print(json.dumps({"status": "ready", "gpu": CUDA_ACTIVE}), flush=True)
    while True:
        if _SHUTDOWN_REQUESTED:
            break
        line_bytes = sys.stdin.buffer.readline()
        if not line_bytes:
            break
        line = line_bytes.decode('utf-8').strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
            if cmd.get('command') == 'shutdown':
                try:
                    _log_gpu_memory("shutdown")
                except Exception as e:
                    print(f"[GPU_MEM] shutdown error: {e}", file=sys.stderr, flush=True)
                _cleanup_gpu_memory("shutdown-command")
                break
            if _SHUTDOWN_REQUESTED:
                break
            image_paths = cmd.get('images', [])
            if not isinstance(image_paths, list):
                print(json.dumps({"id": cmd.get("id"), "error": "images must be a list"}), flush=True)
                continue
            results = process_batch(image_paths)
            print(json.dumps({"id": cmd.get("id"), "results": results}), flush=True)
        except Exception as e:
            print(json.dumps({"id": cmd.get("id"), "error": str(e)}), flush=True)
    try:
        _log_gpu_memory("exit")
    except Exception as e:
        print(f"[GPU_MEM] exit error: {e}", file=sys.stderr, flush=True)
    _cleanup_gpu_memory("final")
    sys.exit(0)


try:
    raw_stdin = sys.stdin.buffer.read()
    image_paths = json.loads(raw_stdin.decode('utf-8'))
except (json.JSONDecodeError, UnicodeDecodeError) as e:
    print(json.dumps({"error": f"Invalid JSON input: {e}"}))
    sys.exit(1)

if not isinstance(image_paths, list):
    print(json.dumps({"error": "Input must be a JSON array of file paths"}))
    sys.exit(1)

_print_gpu_status()

try:
    results = process_batch(image_paths)
    print(json.dumps(results))
except Exception as e:
    print(json.dumps({"error": f"Failed to process batch: {e}"}))
    sys.exit(1)
