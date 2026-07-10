from __future__ import annotations

import hmac
import os
import sys
from pathlib import Path

import modal


MODULE_PATH = Path(__file__).resolve()
ROOT = MODULE_PATH.parents[2] if len(MODULE_PATH.parents) > 2 else Path("/root")
CACHE_PATH = "/cache"

app = modal.App("his-agent-diart")
model_cache = modal.Volume.from_name("his-agent-diart-cache", create_if_missing=True)
huggingface_secret = modal.Secret.from_name(
    "his-agent-huggingface",
    required_keys=["HF_TOKEN"],
)
diart_auth_secret = modal.Secret.from_name(
    "his-agent-diart-auth",
    required_keys=["DIART_PROXY_TOKEN"],
)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libsndfile1")
    .run_commands(
        "python -m pip install --index-url https://download.pytorch.org/whl/cu124 "
        "torch==2.4.1 torchaudio==2.4.1"
    )
    .pip_install(
        "fastapi>=0.110,<1",
        "uvicorn[standard]>=0.29,<1",
        "numpy==1.26.4",
        "matplotlib==3.9.4",
        "pydantic>=2,<3",
        "websockets>=12,<16",
        "diart==0.9.2",
        "pyannote.audio==3.3.2",
        "huggingface_hub<0.26",
    )
    .add_local_dir(str(ROOT / "diarization_service"), remote_path="/root/diarization_service")
)


def configure_runtime() -> None:
    os.environ.setdefault("HUGGINGFACE_TOKEN", os.environ["HF_TOKEN"])
    os.environ.setdefault("HF_HOME", f"{CACHE_PATH}/huggingface")
    os.environ.setdefault("TORCH_HOME", f"{CACHE_PATH}/torch")
    os.environ.setdefault("DIARIZATION_PROVIDER", "diart_local")
    os.environ.setdefault("DIARIZATION_DEVICE", "cuda")
    os.environ.setdefault("DIARIZATION_PRELOAD_MODEL", "1")
    os.environ.setdefault("DIARIZATION_NUM_SPEAKERS", "2")
    os.environ.setdefault("DIARIZATION_CORS_ALLOW_ORIGIN_REGEX", r"^https?://.*$")
    if "/root" not in sys.path:
        sys.path.insert(0, "/root")


class DiartProxyAuth:
    def __init__(self, asgi_app) -> None:
        self.asgi_app = asgi_app

    async def __call__(self, scope, receive, send) -> None:
        if scope.get("type") in {"http", "websocket"}:
            headers = dict(scope.get("headers") or [])
            supplied = headers.get(b"x-his-diart-token", b"")
            expected = os.environ.get("DIART_PROXY_TOKEN", "").encode("utf-8")
            if not expected or not hmac.compare_digest(supplied, expected):
                if scope.get("type") == "websocket":
                    await send({"type": "websocket.close", "code": 4401})
                else:
                    body = b'{"detail":"Unauthorized"}'
                    await send(
                        {
                            "type": "http.response.start",
                            "status": 401,
                            "headers": [
                                (b"content-type", b"application/json"),
                                (b"content-length", str(len(body)).encode("ascii")),
                            ],
                        }
                    )
                    await send({"type": "http.response.body", "body": body})
                return
        await self.asgi_app(scope, receive, send)


@app.function(
    image=image,
    gpu="T4",
    secrets=[huggingface_secret, diart_auth_secret],
    volumes={CACHE_PATH: model_cache},
    timeout=1800,
)
def populate_model_cache() -> dict[str, object]:
    configure_runtime()
    from diarization_service.app.providers.diart_provider import DiartProvider

    provider = DiartProvider()
    health = provider.health()
    model_cache.commit()
    if not health.ok:
        raise RuntimeError(health.message)
    return health.model_dump()


@app.function(
    image=image,
    gpu="T4",
    secrets=[huggingface_secret, diart_auth_secret],
    volumes={CACHE_PATH: model_cache},
    timeout=3600,
    scaledown_window=600,
    min_containers=0,
    max_containers=1,
)
@modal.concurrent(max_inputs=8)
@modal.asgi_app(requires_proxy_auth=True)
def diart_web():
    configure_runtime()
    from diarization_service.app.main import app as fastapi_app

    model_cache.commit()
    return DiartProxyAuth(fastapi_app)
