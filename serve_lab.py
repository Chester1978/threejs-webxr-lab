from __future__ import annotations

import argparse
import socket
import subprocess
import sys
from pathlib import Path

from flask import Flask, send_from_directory


PROJECT_DIR = Path(__file__).resolve().parent
DIST_DIR = PROJECT_DIR / "dist"

app = Flask(__name__, static_folder=str(DIST_DIR), static_url_path="")


@app.route("/")
def index():
    return send_from_directory(DIST_DIR, "index.html")


@app.route("/<path:path>")
def static_proxy(path: str):
    target = DIST_DIR / path
    if target.exists():
        return send_from_directory(DIST_DIR, path)
    return send_from_directory(DIST_DIR, "index.html")


def get_local_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def build_if_needed(skip_build: bool) -> None:
    if skip_build and DIST_DIR.exists():
        return

    if skip_build and not DIST_DIR.exists():
        raise SystemExit("dist/ nao existe. Rode sem --no-build para gerar o build.")

    print("Gerando build com Vite...")
    subprocess.run(["npm", "run", "build"], cwd=PROJECT_DIR, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Gera o build e serve o projeto na rede local."
    )
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-build", action="store_true")
    args = parser.parse_args()

    build_if_needed(args.no_build)

    local_ip = get_local_ip()
    print()
    print(f"Servidor pronto em http://127.0.0.1:{args.port}")
    print(f"Rede local:       http://{local_ip}:{args.port}")
    print("Use o endereco da rede local no outro dispositivo.")
    print()

    app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        print(f"Falha ao gerar build: {exc}", file=sys.stderr)
        raise SystemExit(exc.returncode)
