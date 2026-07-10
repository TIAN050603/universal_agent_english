# Modal T4 Diart Deployment

The deployment uses a scale-to-zero T4, a persistent model-cache volume, and a
named Hugging Face secret. WebSocket support is provided by Modal's ASGI web
function.

```bash
python -m pip install modal
modal setup
modal workspace proxy-tokens create
modal secret create his-agent-huggingface HF_TOKEN=YOUR_TOKEN
modal secret create his-agent-diart-auth DIART_PROXY_TOKEN=YOUR_RANDOM_SHARED_TOKEN
modal run deploy/modal/diart_app.py::populate_model_cache
modal deploy deploy/modal/diart_app.py
```

Copy the deployed `diart_web` HTTPS URL into the Aliyun backend environment:

```env
DIARIZATION_INTERNAL_URL=https://YOUR-MODAL-URL.modal.run
DIARIZATION_PROXY_TOKEN=YOUR_RANDOM_SHARED_TOKEN
MODAL_PROXY_TOKEN_ID=wk-REPLACE_ME
MODAL_PROXY_TOKEN_SECRET=ws-REPLACE_ME
DIARIZATION_HEALTH_TIMEOUT_SECONDS=45
DIARIZATION_WS_OPEN_TIMEOUT_SECONDS=60
```

Then restart `his-agent-backend`. Modal Proxy Auth rejects unauthenticated HTTP
and WebSocket requests before they enter GPU autoscaling; the app-level shared
token provides a second check inside the service. Keep
`min_containers=0` for low cost. Before a scheduled live review, temporarily
set `min_containers=1` if eliminating the GPU cold start is worth the additional
T4 runtime cost.
