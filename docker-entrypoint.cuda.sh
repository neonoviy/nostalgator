#!/bin/sh
set -e

echo "=== Проверка аппаратного ускорения (CUDA) ==="

nvidia_smi_available=false
nvidia_devices=false

if command -v nvidia-smi >/dev/null 2>&1; then
    nvidia_smi_available=true
    echo "[GPU] nvidia-smi найден."
fi

if ls /dev/nvidia* >/dev/null 2>&1 || true; then
    nvidia_devices=true
    echo "[GPU] Устройства /dev/nvidia* обнаружены."
else
    echo "[GPU] Устройства /dev/nvidia* не обнаружены (Docker Engine 29+)."
fi

if $nvidia_smi_available || $nvidia_devices; then
    echo "[GPU] Обнаружена поддержка NVIDIA."

    _pip_libs=$(find /opt/python-deps/nvidia -type d -name lib 2>/dev/null | tr '\n' ':')
    _system_libs="/usr/local/nvidia/lib64:/usr/lib/x86_64-linux-gnu"
    export LD_LIBRARY_PATH="${_pip_libs}${_system_libs:+:$_system_libs}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

    echo "[GPU] LD_LIBRARY_PATH: ${LD_LIBRARY_PATH:-<unset>}"
    echo "[GPU] onnxruntime version: $(python3 -c 'import onnxruntime as ort; print(ort.__version__)' 2>/dev/null || echo unknown)"
    echo "[GPU] onnxruntime providers: $(python3 -c 'import onnxruntime as ort; print(ort.get_available_providers())' 2>/dev/null || echo unknown)"
    echo "[GPU] host GPU: $(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 || echo unknown)"
    echo "[GPU] host CUDA Version (driver): $(nvidia-smi 2>/dev/null | grep -oP 'CUDA Version:\s*\K[0-9.]+' || echo unknown)"
else
    echo "[CPU] GPU не обнаружен. Используется CPU."
    echo "[CPU] nvidia-smi: $nvidia_smi_available | /dev/nvidia*: $nvidia_devices"
fi

echo "=== Запуск Node.js приложения ==="

if [ $# -eq 0 ]; then
  exec node -r dotenv/config src/server/index.js
else
  exec "$@"
fi
