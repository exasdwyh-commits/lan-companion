#!/usr/bin/env python3
"""A small local web studio that runs the native h3.c CLI."""

from __future__ import annotations

import base64
import json
import mimetypes
import os
import queue
import signal
import sqlite3
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
MAX_BODY = 70 * 1024 * 1024
MAX_IMAGE = 20 * 1024 * 1024
MAX_TOTAL_IMAGES = 50 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
PRESETS = {
    "balanced": {"steps": 20, "layers": 45, "reuse": 2, "core_reuse": 1},
    "quality": {"steps": 50, "layers": 50, "reuse": 1, "core_reuse": 1},
    "draft": {"steps": 6, "layers": 50, "reuse": 1, "core_reuse": 1},
}


def load_config() -> dict:
    config_path = Path(os.environ.get("H3_STUDIO_CONFIG", ROOT / "config.local.json"))
    config = json.loads(config_path.read_text()) if config_path.exists() else {}
    config.setdefault("h3_bin", os.environ.get("H3_BIN", ""))
    config.setdefault("model_dir", os.environ.get("H3_MODEL_DIR", ""))
    config.setdefault("data_dir", "data")
    config.setdefault("host", "127.0.0.1")
    config.setdefault("port", 8190)
    config["h3_bin"] = os.environ.get("H3_BIN", config["h3_bin"])
    config["model_dir"] = os.environ.get("H3_MODEL_DIR", config["model_dir"])
    if config["host"] not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("H3 Video Studio only binds to loopback for local use.")
    data_dir = Path(config["data_dir"])
    config["data_path"] = (ROOT / data_dir).resolve() if not data_dir.is_absolute() else data_dir.resolve()
    return config


CONFIG = load_config()
DATA = CONFIG["data_path"]
JOBS_DIR = DATA / "jobs"
DB_PATH = DATA / "studio.sqlite3"
JOBS_DIR.mkdir(parents=True, exist_ok=True)
WORK: queue.Queue[str] = queue.Queue()
PROCESS_LOCK = threading.Lock()
RUNNING: dict[str, subprocess.Popen] = {}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    return db


def init_db() -> None:
    with connect() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            status TEXT NOT NULL, prompt TEXT NOT NULL, settings TEXT NOT NULL,
            error TEXT NOT NULL DEFAULT '', log TEXT NOT NULL DEFAULT '',
            output TEXT NOT NULL DEFAULT '', inputs TEXT NOT NULL DEFAULT '[]'
        )""")
        db.execute("UPDATE jobs SET status='queued', updated_at=? WHERE status='running'", (now(),))
        rows = db.execute("SELECT id FROM jobs WHERE status='queued' ORDER BY created_at").fetchall()
    for row in rows:
        WORK.put(row["id"])


def update_job(job_id: str, **fields) -> None:
    if not fields:
        return
    fields["updated_at"] = now()
    keys = list(fields)
    with connect() as db:
        db.execute("UPDATE jobs SET " + ", ".join(f"{key}=?" for key in keys) + " WHERE id=?",
                   [fields[k] for k in keys] + [job_id])


def job_dict(row: sqlite3.Row) -> dict:
    result = dict(row)
    result["settings"] = json.loads(result["settings"])
    result["inputs"] = json.loads(result["inputs"])
    result["video_url"] = f"/media/{result['id']}/output.mp4" if result["status"] == "completed" else ""
    return result


def get_jobs() -> list[dict]:
    with connect() as db:
        rows = db.execute("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100").fetchall()
    return [job_dict(row) for row in rows]


def model_status() -> dict:
    binary = Path(CONFIG["h3_bin"]).expanduser() if CONFIG["h3_bin"] else None
    model = Path(CONFIG["model_dir"]).expanduser() if CONFIG["model_dir"] else None
    return {
        "engine_ready": bool(binary and binary.is_file() and os.access(binary, os.X_OK)),
        "model_ready": bool(model and model.is_dir()),
        "model_dir_set": bool(model),
        "h3_bin_set": bool(binary),
    }


def make_command(job: dict, workdir: Path) -> list[str]:
    settings = job["settings"]
    command = [str(Path(CONFIG["h3_bin"]).expanduser()), "-d", str(Path(CONFIG["model_dir"]).expanduser()),
               "-p", job["prompt"], "-o", str(workdir / "output.mp4"),
               "--width", str(settings["width"]), "--height", str(settings["height"]),
               "--seconds", str(settings["seconds"]), "--steps", str(settings["steps"]),
               "--layers", str(settings["layers"]), "--reuse", str(settings["reuse"]),
               "--core-reuse", str(settings["core_reuse"]), "--seed", str(settings["seed"]), "--profile"]
    if settings.get("int8_row_fc2"):
        command.append("--use-int8-row-fc2")
    mode = settings["mode"]
    if mode == "first_last":
        if job["inputs"]:
            command += ["--first-frame", str(workdir / "inputs" / job["inputs"][0]["stored"])]
        if len(job["inputs"]) > 1:
            command += ["--last-frame", str(workdir / "inputs" / job["inputs"][1]["stored"])]
    elif mode == "references":
        for item in job["inputs"]:
            command += ["--ref-image", str(workdir / "inputs" / item["stored"])]
    return command


def worker() -> None:
    while True:
        job_id = WORK.get()
        try:
            with connect() as db:
                row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row or row["status"] != "queued":
                continue
            job = job_dict(row)
            status = model_status()
            if not status["engine_ready"] or not status["model_ready"]:
                update_job(job_id, status="failed", error="Configure an executable h3.c binary and model directory in config.local.json.")
                continue
            workdir = JOBS_DIR / job_id
            workdir.mkdir(parents=True, exist_ok=True)
            update_job(job_id, status="running", error="", log="Starting h3.c…")
            command = make_command(job, workdir)
            process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                       text=True, bufsize=1, start_new_session=True)
            with PROCESS_LOCK:
                RUNNING[job_id] = process
            log_lines: list[str] = []
            for line in process.stdout:
                log_lines.append(line.rstrip())
                update_job(job_id, log="\n".join(log_lines[-120:]))
            code = process.wait()
            with PROCESS_LOCK:
                with connect() as db:
                    current = db.execute("SELECT status FROM jobs WHERE id=?", (job_id,)).fetchone()
                RUNNING.pop(job_id, None)
            if current and current["status"] == "cancelled":
                continue
            output = workdir / "output.mp4"
            if code == 0 and output.is_file() and output.stat().st_size:
                update_job(job_id, status="completed", output=str(output), log="\n".join(log_lines[-120:]))
                sidecar = {"id": job_id, "prompt": job["prompt"], "settings": job["settings"],
                           "inputs": job["inputs"], "created_at": job["created_at"], "engine": "h3.c"}
                (workdir / "metadata.json").write_text(json.dumps(sidecar, ensure_ascii=False, indent=2))
            else:
                update_job(job_id, status="failed", error=f"h3.c exited with code {code}", log="\n".join(log_lines[-120:]))
        except Exception as error:
            with PROCESS_LOCK:
                RUNNING.pop(job_id, None)
            update_job(job_id, status="failed", error=str(error))
        finally:
            WORK.task_done()


def create_job(payload: dict) -> str:
    prompt = str(payload.get("prompt", "")).strip()
    if not prompt or len(prompt) > 12000:
        raise ValueError("Prompt must contain 1–12,000 characters.")
    settings_in = payload.get("settings", {})
    preset_name = settings_in.get("preset", "balanced")
    if preset_name not in PRESETS:
        raise ValueError("Unknown generation preset.")
    settings = {**PRESETS[preset_name], **settings_in}
    settings["preset"] = preset_name
    settings["mode"] = settings_in.get("mode", "text")
    settings["width"] = int(settings_in.get("width", 576))
    settings["height"] = int(settings_in.get("height", 1024))
    settings["seconds"] = int(settings_in.get("seconds", 5))
    settings["seed"] = int(settings_in.get("seed", int(time.time()) % 2_147_483_647))
    settings["int8_row_fc2"] = bool(settings_in.get("int8_row_fc2", False))
    if not (256 <= settings["width"] <= 2048 and 256 <= settings["height"] <= 2048):
        raise ValueError("Output dimensions must be between 256 and 2048 pixels.")
    if not (2 <= settings["seconds"] <= 15):
        raise ValueError("Duration must be between 2 and 15 seconds.")
    for key, low, high in (("steps", 2, 50), ("layers", 40, 50), ("reuse", 1, 3), ("core_reuse", 1, 6)):
        settings[key] = int(settings[key])
        if not low <= settings[key] <= high:
            raise ValueError(f"{key} must be between {low} and {high}.")
    if not 0 <= settings["seed"] <= 18_446_744_073_709_551_615:
        raise ValueError("Seed must be a non-negative 64-bit integer.")
    if settings["mode"] not in {"text", "first_last", "references"}:
        raise ValueError("Unknown conditioning mode.")
    inputs = payload.get("inputs", [])
    limit = 2 if settings["mode"] == "first_last" else 9
    if len(inputs) > limit or (settings["mode"] == "first_last" and not 1 <= len(inputs) <= 2):
        raise ValueError(f"This mode accepts up to {limit} image(s).")
    job_id = uuid.uuid4().hex[:12]
    workdir = JOBS_DIR / job_id
    input_dir = workdir / "inputs"
    input_dir.mkdir(parents=True)
    stored_inputs = []
    total_image_bytes = 0
    for index, item in enumerate(inputs):
        mime = item.get("mime")
        if mime not in ALLOWED_IMAGE_TYPES:
            raise ValueError("Reference images must be PNG, JPEG, or WebP.")
        try:
            data = base64.b64decode(item.get("data", ""), validate=True)
        except Exception as error:
            raise ValueError("Invalid image upload.") from error
        if not data or len(data) > MAX_IMAGE:
            raise ValueError("Each image must be smaller than 20 MB.")
        total_image_bytes += len(data)
        if total_image_bytes > MAX_TOTAL_IMAGES:
            raise ValueError("Reference images must total less than 50 MB.")
        name = f"ref-{index + 1}{ALLOWED_IMAGE_TYPES[mime]}"
        (input_dir / name).write_bytes(data)
        stored_inputs.append({"name": str(item.get("name", name))[:180], "stored": name, "mime": mime})
    created = now()
    with connect() as db:
        db.execute("INSERT INTO jobs (id,created_at,updated_at,status,prompt,settings,inputs) VALUES (?,?,?,?,?,?,?)",
                   (job_id, created, created, "queued", prompt, json.dumps(settings), json.dumps(stored_inputs)))
    WORK.put(job_id)
    return job_id


class Handler(BaseHTTPRequestHandler):
    server_version = "H3VideoStudio/0.1"

    def log_message(self, *_args):
        pass

    def send_json(self, value: dict | list, status: int = 200) -> None:
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/jobs":
            return self.send_json(get_jobs())
        if parsed.path == "/api/status":
            return self.send_json({**model_status(), "queue_size": WORK.qsize(), "version": "0.1"})
        if parsed.path.startswith("/media/"):
            bits = parsed.path.strip("/").split("/")
            if len(bits) == 3 and bits[2] == "output.mp4":
                path = (JOBS_DIR / bits[1] / "output.mp4").resolve()
                if path.parent.parent == JOBS_DIR.resolve() and path.is_file():
                    return self.send_file(path)
            return self.send_error(404)
        if parsed.path == "/" or parsed.path == "/index.html":
            return self.send_file(ROOT / "web" / "index.html")
        rel = unquote(parsed.path.lstrip("/"))
        path = (ROOT / "web" / rel).resolve()
        if path.parent == (ROOT / "web").resolve() and path.is_file():
            return self.send_file(path)
        return self.send_error(404)

    def send_file(self, path: Path):
        content = path.read_bytes()
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY:
            raise ValueError("Request is empty or exceeds the 70 MB upload limit.")
        return json.loads(self.rfile.read(length))

    def do_POST(self):
        parsed = urlparse(self.path)
        origin = self.headers.get("Origin")
        allowed_origins = {f"http://127.0.0.1:{CONFIG['port']}", f"http://localhost:{CONFIG['port']}"}
        if origin and origin not in allowed_origins:
            return self.send_json({"error": "Cross-origin requests are not allowed."}, 403)
        try:
            if parsed.path == "/api/jobs":
                job_id = create_job(self.read_json())
                return self.send_json({"id": job_id}, 201)
            if parsed.path.startswith("/api/jobs/") and parsed.path.endswith("/cancel"):
                job_id = parsed.path.split("/")[3]
                with connect() as db:
                    row = db.execute("SELECT status FROM jobs WHERE id=?", (job_id,)).fetchone()
                if not row:
                    return self.send_json({"error": "Job not found."}, 404)
                if row["status"] == "queued":
                    update_job(job_id, status="cancelled")
                elif row["status"] == "running":
                    update_job(job_id, status="cancelled")
                    with PROCESS_LOCK:
                        process = RUNNING.get(job_id)
                    if process and process.poll() is None:
                        try:
                            os.killpg(process.pid, signal.SIGTERM)
                        except ProcessLookupError:
                            pass
                return self.send_json({"ok": True})
            if parsed.path.startswith("/api/jobs/") and parsed.path.endswith("/retry"):
                job_id = parsed.path.split("/")[3]
                with connect() as db:
                    row = db.execute("SELECT status FROM jobs WHERE id=?", (job_id,)).fetchone()
                if not row:
                    return self.send_json({"error": "Job not found."}, 404)
                if row["status"] not in {"failed", "cancelled"}:
                    return self.send_json({"error": "Only failed or cancelled jobs can be retried."}, 409)
                with PROCESS_LOCK:
                    if job_id in RUNNING:
                        return self.send_json({"error": "The cancelled process is still stopping. Try again shortly."}, 409)
                update_job(job_id, status="queued", error="", log="")
                WORK.put(job_id)
                return self.send_json({"ok": True})
        except (ValueError, json.JSONDecodeError) as error:
            return self.send_json({"error": str(error)}, 400)
        return self.send_error(404)


if __name__ == "__main__":
    init_db()
    threading.Thread(target=worker, daemon=True).start()
    httpd = ThreadingHTTPServer((CONFIG["host"], int(CONFIG["port"])), Handler)
    print(f"H3 Video Studio running at http://{CONFIG['host']}:{CONFIG['port']}")
    print("Configure H3_BIN and H3_MODEL_DIR, or create config.local.json.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
