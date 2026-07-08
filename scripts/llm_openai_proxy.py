#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

import requests


ROOT = Path(__file__).resolve().parents[1]


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8-sig", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_file(ROOT / "backend" / ".env")


def env_first(*names: str, default: str = "") -> str:
    for name in names:
        value = os.getenv(name, "").strip()
        if value:
            return value
    return default


API_KEY = env_first("LLM_PROXY_API_KEY", "OPENAI_API_KEY", "DASHSCOPE_API_KEY", "LLM_API_KEY")
BASE_URL = env_first("LLM_PROXY_BASE_URL", "OPENAI_BASE_URL", "DASHSCOPE_UPSTREAM_BASE_URL", default="https://api.openai.com/v1").rstrip("/")
MODEL = env_first("LLM_PROXY_MODEL", "OPENAI_MODEL", "DASHSCOPE_UPSTREAM_MODEL", default="gpt-4o")


class Handler(BaseHTTPRequestHandler):
    server_version = "UniversalAgentLLMProxy/1.0"

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "authorization,content-type")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt: str, *args: object) -> None:
        print("%s - - [%s] %s" % (self.client_address[0], self.log_date_time_string(), fmt % args), flush=True)

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == "/health":
            self.send_json(200, {"ok": bool(API_KEY), "base_url": BASE_URL, "model": MODEL})
            return
        if path == "/v1/models":
            self.forward("GET", "/models")
            return
        self.send_json(404, {"error": "not_found"})

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        if path != "/v1/chat/completions":
            self.send_json(404, {"error": "not_found"})
            return
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self.send_json(400, {"error": "invalid_json"})
            return
        payload.setdefault("model", MODEL)
        self.forward("POST", "/chat/completions", json_payload=payload)

    def forward(self, method: str, upstream_path: str, json_payload: dict | None = None) -> None:
        if not API_KEY:
            self.send_json(500, {"error": "missing_api_key"})
            return
        try:
            response = requests.request(
                method,
                BASE_URL + upstream_path,
                headers={"Authorization": "Bearer " + API_KEY, "Content-Type": "application/json"},
                json=json_payload,
                timeout=60,
            )
            body = response.content
            self.send_response(response.status_code)
            self.send_header("Content-Type", response.headers.get("content-type", "application/json; charset=utf-8"))
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as exc:
            self.send_json(502, {"error": type(exc).__name__, "message": str(exc)})


def main() -> None:
    host = os.getenv("LLM_PROXY_HOST", "0.0.0.0")
    port = int(os.getenv("LLM_PROXY_PORT", "8001"))
    print(f"LLM proxy listening on {host}:{port}, upstream={BASE_URL}, model={MODEL}", flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
