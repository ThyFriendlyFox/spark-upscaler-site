#!/usr/bin/env python3
"""Spark Upscaler worker.

Runs inside a Spark lab session. It asks the web app for queued clips, runs
SeedVR2 (numz/ComfyUI-SeedVR2_VideoUpscaler CLI) on them in resumable chunks,
keeps the result on the Spark, and reports timing for every chunk so the app
can estimate future jobs.

Everything lives under /workspace/upscaler, which survives between sessions:
code, models, pip installs, half-finished jobs and finished videos
(outputs/<job>/), which the app downloads straight from the Spark. If a session ends mid-job,
start the worker again next session and it continues from the last finished
chunk.

Start (first time):  SU_APP=https://your-app SU_SECRET=... python3 worker.py
Start (later):       python3 worker.py      (settings are saved in config.json)
Dry run:             SU_DRY_RUN=1 python3 worker.py
                     Tests the whole pipeline (download, chunking, join, upload)
                     with a plain ffmpeg resize instead of SeedVR2. No GPU needed,
                     and its timings are not added to the stats.
"""

import json
import os
import platform
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tarfile
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

VERSION = "0.2.0"
BASE = Path(os.environ.get("SU_BASE", "/workspace/upscaler"))
CONFIG = BASE / "config.json"
LOCK = BASE / "worker.pid"
SEEDVR2_DIR = BASE / "seedvr2"
SEEDVR2_REPO = "https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler.git"
SEEDVR2_COMMIT = "4490bd1f482e026674543386bb2a4d176da245b9"
MODELS_DIR = BASE / "models"
BIN = BASE / "bin"
JOBS = BASE / "jobs"
# Finished videos stay on the Spark. The app downloads them through the Spark's file API, whose paths are
# relative to /workspace.
OUTPUTS = BASE / "outputs"
WORKSPACE = Path(os.environ.get("SU_WORKSPACE", "/workspace"))
POLL_SECONDS = 20
PROGRESS_SECONDS = 15
FFMPEG_ARM64 = "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz"
FFMPEG_AMD64 = "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"

DRY_RUN = os.environ.get("SU_DRY_RUN") == "1" or "--dry-run" in sys.argv

def _worker_id():
    # Stable per /workspace, so a restarted worker can pick its own unfinished job straight back up.
    p = BASE / "worker_id"
    try:
        BASE.mkdir(parents=True, exist_ok=True)
        if not p.exists():
            p.write_text(uuid.uuid4().hex[:12])
        return p.read_text().strip()
    except Exception:
        return uuid.uuid4().hex[:12]


WORKER_ID = _worker_id()
APP = ""
SECRET = ""
STATE = {"state": "starting", "message": "", "job": None, "env": {}}
LOG_BUFFER = []
LOG_LOCK = threading.Lock()


class Canceled(Exception):
    pass


# ---------------------------------------------------------------- logging

def log(msg):
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    with LOG_LOCK:
        LOG_BUFFER.append(line[:500])
        del LOG_BUFFER[:-400]


def take_log():
    with LOG_LOCK:
        lines = LOG_BUFFER[:]
        LOG_BUFFER.clear()
    return lines


def set_state(state, message=""):
    STATE["state"] = state
    STATE["message"] = message
    log(f"[{state}] {message}" if message else f"[{state}]")


# ---------------------------------------------------------------- app API

def api(method, path, body=None, timeout=60, retries=4):
    url = APP.rstrip("/") + path
    data = None if body is None else json.dumps(body).encode()
    headers = {
        "Authorization": f"Bearer {SECRET}",
        "Content-Type": "application/json",
        "User-Agent": f"spark-upscaler-worker/{VERSION}",
    }
    last = None
    for attempt in range(retries):
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            text = e.read().decode(errors="replace")[:500]
            if e.code in (400, 401, 403, 404, 409):
                raise RuntimeError(f"{method} {path} → HTTP {e.code}: {text}")
            last = RuntimeError(f"{method} {path} → HTTP {e.code}: {text}")
        except Exception as e:  # network hiccup
            last = e
        time.sleep(2 * (attempt + 1))
    raise last


def heartbeat_loop():
    while True:
        try:
            r = api("POST", "/api/worker/heartbeat", {
                "workerId": WORKER_ID,
                "version": VERSION + (" (dry run)" if DRY_RUN else ""),
                "state": STATE["state"],
                "message": STATE["message"],
                "jobId": STATE["job"],
                "env": STATE["env"],
                "log": take_log(),
                "trashed": STATE.get("trashed", []),
            }, timeout=30, retries=2)
            STATE["trashed"] = []
            if r.get("cancel"):
                STATE["cancel"] = True
            for rel in r.get("trash") or []:
                STATE.setdefault("trashed", []).append(rel)
                delete_output(rel)
        except Exception as e:
            print(f"heartbeat failed: {e}", flush=True)
        time.sleep(30)


# ---------------------------------------------------------------- helpers

def delete_output(rel):
    """Deletes a finished video the app no longer lists. Only ever touches files under outputs/."""
    try:
        target = (WORKSPACE / rel).resolve()
        root = OUTPUTS.resolve()
        if root not in target.parents:
            log(f"refusing to delete outside outputs/: {rel}")
            return
        if target.exists():
            target.unlink()
            log(f"deleted {rel}")
        if target.parent != root and target.parent.exists() and not any(target.parent.iterdir()):
            target.parent.rmdir()
    except Exception as e:
        log(f"could not delete {rel}: {e}")


def run(cmd, cwd=None, check=True, env=None, timeout=None):
    log("$ " + " ".join(shlex.quote(str(c)) for c in cmd))
    p = subprocess.run([str(c) for c in cmd], cwd=cwd, env=env, timeout=timeout,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    out = p.stdout or ""
    if check and p.returncode != 0:
        raise RuntimeError(f"command failed ({p.returncode}): {' '.join(map(str, cmd))}\n{out[-3000:]}")
    return out


def download(url, dest, label="download", expected=None):
    tmp = Path(str(dest) + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": f"spark-upscaler-worker/{VERSION}"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0) or expected or 0
        done = 0
        last = 0.0
        while True:
            chunk = r.read(4 * 1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            if time.time() - last > 10:
                last = time.time()
                pct = f" {done * 100 // total}%" if total else ""
                log(f"{label}: {done / 1e6:.0f} MB{pct}")
    tmp.rename(dest)
    log(f"{label}: done, {done / 1e6:.1f} MB in {time.time() - t0:.0f}s")
    return done


def which(name):
    p = BIN / name
    if p.exists():
        return str(p)
    return shutil.which(name)


# ---------------------------------------------------------------- setup

def ensure_python_with_torch():
    try:
        import torch  # noqa: F401
        return
    except ImportError:
        pass
    cands = []
    try:
        out = subprocess.run(["jupyter", "kernelspec", "list", "--json"], capture_output=True, text=True, timeout=30)
        for spec in json.loads(out.stdout).get("kernelspecs", {}).values():
            argv = spec.get("spec", {}).get("argv", [])
            if argv:
                cands.append(argv[0])
    except Exception:
        pass
    cands += [shutil.which("python3"), shutil.which("python"), "/opt/conda/bin/python", "/usr/local/bin/python3"]
    for c in cands:
        if c and os.path.exists(c) and os.path.realpath(c) != os.path.realpath(sys.executable):
            if subprocess.run([c, "-c", "import torch"], capture_output=True).returncode == 0:
                print(f"re-running with {c} (has torch)", flush=True)
                os.execv(c, [c] + sys.argv)
    raise RuntimeError("No Python with PyTorch found (tried the notebook kernel and python3)")


def ensure_ffmpeg():
    BIN.mkdir(parents=True, exist_ok=True)
    os.environ["PATH"] = f"{BIN}:{os.environ.get('PATH', '')}"
    if which("ffmpeg") and which("ffprobe"):
        return
    arch = platform.machine().lower()
    url = FFMPEG_ARM64 if arch in ("aarch64", "arm64") else FFMPEG_AMD64
    try:
        set_state("setup", "downloading a static ffmpeg build")
        tar = BASE / "ffmpeg.tar.xz"
        download(url, tar, "ffmpeg")
        with tarfile.open(tar) as t:
            for m in t.getmembers():
                name = Path(m.name).name
                if name in ("ffmpeg", "ffprobe") and m.isfile():
                    m.name = name
                    t.extract(m, BIN)
        tar.unlink(missing_ok=True)
        for n in ("ffmpeg", "ffprobe"):
            (BIN / n).chmod(0o755)
    except Exception as e:
        log(f"static ffmpeg download failed ({e}); trying imageio-ffmpeg")
        run([sys.executable, "-m", "pip", "install", "-q", "imageio-ffmpeg"])
        import imageio_ffmpeg  # type: ignore
        src = imageio_ffmpeg.get_ffmpeg_exe()
        dst = BIN / "ffmpeg"
        if dst.exists() or dst.is_symlink():
            dst.unlink()
        dst.symlink_to(src)
    if not which("ffmpeg"):
        raise RuntimeError("ffmpeg is not available")


def ensure_seedvr2():
    if (SEEDVR2_DIR / ".git").exists():
        head = run(["git", "-C", SEEDVR2_DIR, "rev-parse", "HEAD"], check=False).strip()
        if head == SEEDVR2_COMMIT:
            return
    set_state("setup", "fetching the SeedVR2 code")
    if SEEDVR2_DIR.exists():
        shutil.rmtree(SEEDVR2_DIR)
    SEEDVR2_DIR.mkdir(parents=True)
    run(["git", "init", "-q"], cwd=SEEDVR2_DIR)
    run(["git", "remote", "add", "origin", SEEDVR2_REPO], cwd=SEEDVR2_DIR)
    run(["git", "fetch", "-q", "--depth", "1", "origin", SEEDVR2_COMMIT], cwd=SEEDVR2_DIR)
    run(["git", "checkout", "-q", "FETCH_HEAD"], cwd=SEEDVR2_DIR)


PIP_DEPS = {
    # import name: pip requirement (torch/torchvision are handled separately)
    "safetensors": "safetensors",
    "numpy": "numpy",
    "tqdm": "tqdm",
    "psutil": "psutil",
    "einops": "einops",
    "omegaconf": "omegaconf>=2.3.0",
    "diffusers": "diffusers>=0.33.1",
    "peft": "peft>=0.17.0",
    "rotary_embedding_torch": "rotary_embedding_torch>=0.5.3",
    "cv2": "opencv-python-headless",
    "gguf": "gguf",
    "matplotlib": "matplotlib",
}


def ensure_python_deps():
    import importlib.util
    import torch
    missing = [req for mod, req in PIP_DEPS.items() if importlib.util.find_spec(mod) is None]
    # Pin what's already installed so pip can't swap out the session's CUDA PyTorch.
    pins = [f"torch=={torch.__version__.split('+')[0]}"]
    try:
        import numpy
        pins.append(f"numpy=={numpy.__version__}")
    except ImportError:
        pass
    cons = BASE / "constraints.txt"
    cons.write_text("\n".join(pins) + "\n")
    if missing:
        set_state("setup", "pip install " + " ".join(missing))
        run([sys.executable, "-m", "pip", "install", "-q", "-c", cons] + missing)
    if importlib.util.find_spec("torchvision") is None:
        ensure_torchvision(torch)
    chk = subprocess.run([sys.executable, "-c", "import torch, torchvision, torchvision.ops, cv2, diffusers"],
                         capture_output=True, text=True)
    if chk.returncode != 0:
        raise RuntimeError("SeedVR2 dependencies don't import cleanly:\n" + (chk.stderr or chk.stdout)[-2000:])


def ensure_torchvision(torch):
    m = re.match(r"(\d+)\.(\d+)", torch.__version__)
    tv = f"0.{int(m.group(2)) + 15}.*" if m and m.group(1) == "2" else None
    cuda = (torch.version.cuda or "").replace(".", "")
    attempts = []
    if tv and cuda:
        attempts.append(["--index-url", f"https://download.pytorch.org/whl/cu{cuda}", f"torchvision=={tv}"])
    if tv:
        attempts.append([f"torchvision=={tv}"])
    for extra in attempts:
        set_state("setup", "installing torchvision " + " ".join(extra))
        try:
            run([sys.executable, "-m", "pip", "install", "-q", "--no-deps"] + extra)
            chk = subprocess.run([sys.executable, "-c", "import torchvision, torchvision.ops; print('ok')"],
                                 capture_output=True, text=True)
            if chk.returncode == 0:
                return
            log("torchvision installed but failed to import: " + (chk.stderr or "")[-800:])
            run([sys.executable, "-m", "pip", "uninstall", "-y", "-q", "torchvision"], check=False)
        except Exception as e:
            log(f"torchvision install attempt failed: {e}")
    raise RuntimeError(
        f"Could not install a torchvision that matches torch {torch.__version__}. "
        "Install one by hand in a notebook (pip install --no-deps torchvision==<matching>) and restart the worker."
    )


def collect_env():
    import torch
    env = {
        "python": sys.version.split()[0],
        "executable": sys.executable,
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
        "cudaAvailable": torch.cuda.is_available(),
        "arch": platform.machine(),
        "seedvr2Commit": SEEDVR2_COMMIT[:10],
    }
    try:
        import torchvision
        env["torchvision"] = torchvision.__version__
    except Exception as e:
        env["torchvision"] = f"missing ({e})"
    if torch.cuda.is_available():
        p = torch.cuda.get_device_properties(0)
        env["gpu"] = p.name
        env["capability"] = f"{p.major}.{p.minor}"
        env["gpuMemoryGB"] = round(p.total_memory / 1e9, 1)
    try:
        env["ffmpeg"] = run([which("ffmpeg"), "-version"], check=False).split("\n")[0][:80]
    except Exception:
        env["ffmpeg"] = "missing"
    try:
        du = shutil.disk_usage(BASE)
        env["workspaceFreeGB"] = round(du.free / 1e9, 1)
    except Exception:
        pass
    for mod in ("flash_attn", "sageattention", "triton"):
        try:
            __import__(mod)
            env[mod] = True
        except Exception:
            env[mod] = False
    return env


def setup():
    set_state("setup", "checking tools")
    ensure_ffmpeg()
    if DRY_RUN:
        JOBS.mkdir(parents=True, exist_ok=True)
        STATE["env"] = {"dryRun": True, "python": sys.version.split()[0], "arch": platform.machine(),
                        "ffmpeg": run([which("ffmpeg"), "-version"], check=False).split("\n")[0][:80]}
        log("dry run: skipping PyTorch/SeedVR2 setup")
        return
    ensure_seedvr2()
    ensure_python_deps()
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    JOBS.mkdir(parents=True, exist_ok=True)
    STATE["env"] = collect_env()
    if not STATE["env"].get("cudaAvailable"):
        raise RuntimeError("PyTorch can't see the GPU (torch.cuda.is_available() is False)")
    log("environment: " + json.dumps(STATE["env"]))


# ---------------------------------------------------------------- video helpers

def probe(path):
    ffprobe = which("ffprobe")
    info = {"frames": 0, "fps": 0.0, "width": 0, "height": 0, "duration": 0.0, "audio": False}
    if ffprobe:
        out = run([ffprobe, "-v", "error", "-count_packets", "-show_entries",
                   "stream=codec_type,width,height,r_frame_rate,avg_frame_rate,nb_read_packets,duration",
                   "-show_entries", "format=duration", "-of", "json", path], check=False)
        try:
            d = json.loads(out[out.index("{"):])
            for s in d.get("streams", []):
                if s.get("codec_type") == "video" and not info["width"]:
                    info["width"] = int(s.get("width") or 0)
                    info["height"] = int(s.get("height") or 0)
                    info["frames"] = int(s.get("nb_read_packets") or 0)
                    for key in ("avg_frame_rate", "r_frame_rate"):
                        num, _, den = (s.get(key) or "0/1").partition("/")
                        if float(den or 1) and float(num or 0):
                            info["fps"] = float(num) / float(den or 1)
                            break
                    info["duration"] = float(s.get("duration") or 0)
                if s.get("codec_type") == "audio":
                    info["audio"] = True
            if not info["duration"]:
                info["duration"] = float(d.get("format", {}).get("duration") or 0)
        except Exception as e:
            log(f"ffprobe parse failed: {e}")
    if not info["frames"] or not info["width"]:
        import cv2
        cap = cv2.VideoCapture(str(path))
        info["width"] = info["width"] or int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        info["height"] = info["height"] or int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        info["fps"] = info["fps"] or float(cap.get(cv2.CAP_PROP_FPS) or 0)
        info["frames"] = info["frames"] or int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.release()
        if not info["audio"] and which("ffmpeg"):
            out = run([which("ffmpeg"), "-hide_banner", "-i", path], check=False)
            info["audio"] = "Audio:" in out
    if not info["duration"] and info["fps"]:
        info["duration"] = info["frames"] / info["fps"]
    return info


def normalize(src, dst):
    """Re-encodes the video stream as lossless all-keyframe H.264.

    SeedVR2 jumps to each chunk's first frame with OpenCV seeking, which is
    only exact when every frame is a keyframe. This also turns odd inputs
    (VP9, ProRes, 10-bit) into something the CLI reads reliably.
    """
    ffmpeg = which("ffmpeg")
    tmp = Path(str(dst) + ".tmp.mp4")
    base = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-map", "0:v:0", "-an",
            "-c:v", "libx264", "-preset", "ultrafast", "-qp", "0", "-g", "1", "-pix_fmt", "yuv420p"]
    try:
        run(base + ["-fps_mode", "passthrough", tmp])
    except RuntimeError:
        run(base + ["-vsync", "0", tmp])
    tmp.rename(dst)


def ensure_models(model):
    """Downloads (and hash-checks) the model before any chunk is timed."""
    code = (
        "import sys; sys.path.insert(0, '.');"
        "from src.utils.downloads import download_weight;"
        "from src.utils.model_registry import DEFAULT_VAE;"
        "sys.exit(0 if download_weight(dit_model=sys.argv[1], vae_model=DEFAULT_VAE, model_dir=sys.argv[2]) else 1)"
    )
    set_state("working", f"checking/downloading model {model}")
    run([sys.executable, "-c", code, model, MODELS_DIR], cwd=SEEDVR2_DIR, timeout=4 * 3600)


def video_dims(path):
    ffprobe = which("ffprobe")
    if ffprobe:
        out = run([ffprobe, "-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries",
                   "stream=width,height,nb_read_packets", "-of", "json", path], check=False)
        try:
            s = json.loads(out[out.index("{"):])["streams"][0]
            return int(s["width"]), int(s["height"]), int(s.get("nb_read_packets") or 0)
        except Exception:
            pass
    import cv2
    cap = cv2.VideoCapture(str(path))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()
    return w, h, n


# ---------------------------------------------------------------- self-test

def selftest():
    """Checks the app and its storage answer, since inputs come from there."""
    r = api("POST", "/api/worker/selftest", {"action": "server"})
    log(f"selftest: {r}")
    return bool(r.get("ok"))


# ---------------------------------------------------------------- jobs

def report(jid, path, body):
    body = {"workerId": WORKER_ID, **body}
    r = api("POST", f"/api/worker/jobs/{jid}/{path}", body)
    if r.get("cancel") or STATE.get("cancel"):
        raise Canceled()
    return r


def tail(path, n=40):
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - 64 * 1024))
            text = f.read().decode(errors="replace")
        lines = [l for l in re.split(r"[\r\n]+", text) if l.strip()]
        return lines[-n:]
    except Exception:
        return []


def build_cli(job, inp, out, start, count):
    s = job["settings"]
    if DRY_RUN:
        r = int(s["resolution"])
        vf = (f"trim=start_frame={start}:end_frame={start + count},setpts=PTS-STARTPTS,"
              f"scale=w='if(lt(iw\\,ih)\\,{r}\\,-2)':h='if(lt(iw\\,ih)\\,-2\\,{r})'")
        return [which("ffmpeg"), "-y", "-hide_banner", "-loglevel", "error", "-i", str(inp), "-vf", vf,
                "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", str(out)]
    cmd = [sys.executable, str(SEEDVR2_DIR / "inference_cli.py"), str(inp),
           "--output", str(out),
           "--output_format", "mp4",
           "--model_dir", str(MODELS_DIR),
           "--dit_model", s["model"],
           "--resolution", str(s["resolution"]),
           "--batch_size", str(s["batchSize"]),
           "--seed", str(s["seed"]),
           "--skip_first_frames", str(start),
           "--load_cap", str(count),
           "--color_correction", s["colorCorrection"],
           "--attention_mode", s["attention"]]
    if s.get("maxResolution"):
        cmd += ["--max_resolution", str(s["maxResolution"])]
    if which("ffmpeg"):
        cmd += ["--video_backend", "ffmpeg"]
    if s.get("compile"):
        cmd += ["--compile_dit", "--compile_vae"]
    if s.get("vaeTiling"):
        cmd += ["--vae_encode_tiled", "--vae_decode_tiled"]
    if s.get("prependFrames"):
        cmd += ["--prepend_frames", str(s["prependFrames"])]
    if s.get("extraArgs"):
        cmd += shlex.split(s["extraArgs"])
    return cmd


def run_chunk(job, d, inp, i, n_chunks, start, count):
    out = d / f"chunk_{i:04d}.mp4"
    tmp = d / f"chunk_{i:04d}.tmp.mp4"
    logf = d / f"chunk_{i:04d}.log"
    tmp.unlink(missing_ok=True)
    cmd = build_cli(job, inp, tmp, start, count)
    log(f"chunk {i + 1}/{n_chunks}: frames {start}–{start + count - 1}")
    env = dict(os.environ, PYTHONUNBUFFERED="1", PATH=f"{BIN}:{os.environ.get('PATH', '')}")
    t0 = time.time()
    with open(logf, "w") as lf:
        lf.write("$ " + " ".join(shlex.quote(c) for c in cmd) + "\n")
        lf.flush()
        proc = subprocess.Popen(cmd, cwd=SEEDVR2_DIR, stdout=lf, stderr=subprocess.STDOUT, env=env,
                                start_new_session=True)
        last = 0.0
        try:
            while proc.poll() is None:
                time.sleep(2)
                if time.time() - last >= PROGRESS_SECONDS:
                    last = time.time()
                    report(job["id"], "progress", {
                        "phase": "upscaling", "chunk": i, "chunks": n_chunks,
                        "chunkElapsed": round(time.time() - t0, 1),
                        "message": (tail(logf, 1) or [""])[-1][:300],
                        "logTail": tail(logf, 30),
                    })
        except BaseException:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
                proc.wait(timeout=20)
            except Exception:
                proc.kill()
            raise
    seconds = time.time() - t0
    if proc.returncode != 0 or not tmp.exists() or tmp.stat().st_size == 0:
        raise RuntimeError(f"SeedVR2 failed on chunk {i + 1} (exit {proc.returncode})\n" + "\n".join(tail(logf, 25)))
    tmp.rename(out)
    ow, oh, of = video_dims(out)
    stat = {"chunk": i, "frames": count, "outFrames": of, "outW": ow, "outH": oh, "seconds": round(seconds, 2)}
    return stat


def process_job(job, input_url):
    jid = job["id"]
    STATE["job"] = jid
    STATE.pop("cancel", None)
    d = JOBS / jid
    d.mkdir(parents=True, exist_ok=True)
    t_start = time.time()
    timings = {}

    ext = Path(job.get("name") or "input.mp4").suffix.lower() or ".mp4"
    if ext not in (".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"):
        ext = ".mp4"
    inp = d / f"input{ext}"
    if not inp.exists():
        set_state("working", f"downloading {job['name']}")
        report(jid, "progress", {"phase": "downloading", "message": job["name"]})
        t = time.time()
        download(input_url, inp, "input", expected=job.get("size"))
        timings["download"] = round(time.time() - t, 1)

    t = time.time()
    src_info = probe(inp)
    norm = d / "normalized.mp4"
    if not norm.exists():
        set_state("working", f"{job['name']}: preparing frames")
        report(jid, "progress", {"phase": "preparing"})
        normalize(inp, norm)
    info = probe(norm)
    info["audio"] = src_info["audio"]
    if not info["fps"]:
        info["fps"] = src_info["fps"]
    timings["prepare"] = round(time.time() - t, 1)
    log(f"probe: {info}")
    if not info["frames"] or not info["width"]:
        raise RuntimeError(f"Could not read the video ({info})")
    report(jid, "progress", {"phase": "probed", "probe": info})

    t = time.time()
    if not DRY_RUN:
        ensure_models(job["settings"]["model"])
    timings["models"] = round(time.time() - t, 1)

    cf = int(job["settings"].get("chunkFrames") or 0) or info["frames"]
    starts = list(range(0, info["frames"], cf))
    sizes = [min(cf, info["frames"] - s) for s in starts]
    n_chunks = len(starts)
    meta_path = d / "plan.json"
    plan = {"frames": info["frames"], "chunkFrames": cf}
    if meta_path.exists() and json.loads(meta_path.read_text()) != plan:
        # Settings changed since the half-finished run: start over.
        for p in d.glob("chunk_*"):
            p.unlink()
    meta_path.write_text(json.dumps(plan))

    chunk_seconds = 0.0
    chunk_seconds_this_run = 0.0
    out_w = out_h = 0
    for i, (start, count) in enumerate(zip(starts, sizes)):
        done = d / f"chunk_{i:04d}.json"
        if done.exists() and (d / f"chunk_{i:04d}.mp4").exists():
            st = json.loads(done.read_text())
            chunk_seconds += st["seconds"]
            out_w, out_h = st["outW"], st["outH"]
            continue
        set_state("working", f"{job['name']}: chunk {i + 1}/{n_chunks}")
        st = run_chunk(job, d, norm, i, n_chunks, start, count)
        done.write_text(json.dumps(st))
        chunk_seconds += st["seconds"]
        chunk_seconds_this_run += st["seconds"]
        out_w, out_h = st["outW"], st["outH"]
        report(jid, "chunk", {
            "dryRun": DRY_RUN,
            "stat": {**st, "inW": info["width"], "inH": info["height"]},
            "chunksDone": i + 1, "chunks": n_chunks,
        })
    timings["chunks"] = round(chunk_seconds, 1)
    timings["chunksThisRun"] = round(chunk_seconds_this_run, 1)

    # Join chunks and put the original audio back.
    set_state("working", f"{job['name']}: joining {n_chunks} chunks")
    report(jid, "progress", {"phase": "joining"})
    t = time.time()
    ffmpeg = which("ffmpeg")
    video_only = d / "joined.mp4"
    final = d / "final.mp4"
    lst = d / "concat.txt"
    lst.write_text("".join(f"file '{d / f'chunk_{i:04d}.mp4'}'\n" for i in range(n_chunks)))
    run([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
         "-i", lst, "-c", "copy", video_only])
    if info["audio"]:
        r = run([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", video_only, "-i", inp,
                 "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                 "-shortest", "-movflags", "+faststart", final], check=False)
        if not final.exists():
            log(f"audio mux failed, keeping video only: {r[-500:]}")
            video_only.rename(final)
    else:
        run([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", video_only, "-c", "copy",
             "-movflags", "+faststart", final])
    timings["join"] = round(time.time() - t, 1)

    # Keep the result on the Spark; the app downloads it from there.
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(job.get("name") or "video").stem)[:80] or "video"
    out_dir = OUTPUTS / jid
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{stem}_seedvr2_{job['settings']['resolution']}p.mp4"
    shutil.move(str(final), out)
    size = out.stat().st_size
    try:
        rel = str(out.resolve().relative_to(WORKSPACE.resolve()))
    except ValueError:
        rel = str(out.resolve())  # outside /workspace: only reachable from a session
    timings["wall"] = round(time.time() - t_start, 1)
    api("POST", f"/api/worker/jobs/{jid}/complete", {
        "workerId": WORKER_ID,
        "output": {"path": rel, "size": size},
        "timings": timings,
        "dryRun": DRY_RUN,
        "chunks": n_chunks,
        "outW": out_w,
        "outH": out_h,
    })
    log(f"done: {job['name']} in {timings['wall']:.0f}s ({size / 1e6:.1f} MB)")
    shutil.rmtree(d, ignore_errors=True)


def work_loop():
    last_idle_note = time.time()
    while True:
        try:
            set_state("idle", "waiting for jobs")
            r = api("POST", "/api/worker/next", {"workerId": WORKER_ID})
        except Exception as e:
            log(f"poll failed: {e}")
            time.sleep(POLL_SECONDS)
            continue
        job = r.get("job")
        if not job:
            if time.time() - last_idle_note > 600:
                last_idle_note = time.time()
                log("no jobs queued; the Spark goes back to inference after 30 min without GPU use")
            time.sleep(POLL_SECONDS)
            continue
        last_idle_note = time.time()
        log(f"job {job['id']}: {job['name']}")
        try:
            process_job(job, r["inputUrl"])
        except Canceled:
            log(f"job {job['id']} canceled")
            shutil.rmtree(JOBS / job["id"], ignore_errors=True)
        except Exception as e:
            err = f"{type(e).__name__}: {e}"
            log(f"job {job['id']} failed: {err}")
            traceback.print_exc()
            try:
                api("POST", f"/api/worker/jobs/{job['id']}/fail", {
                    "workerId": WORKER_ID, "error": err[-4000:],
                    "logTail": [l for l in str(e).split("\n")][-40:],
                })
            except Exception as e2:
                log(f"could not report failure: {e2}")
        finally:
            STATE["job"] = None


# ---------------------------------------------------------------- main

def load_config():
    global APP, SECRET
    cfg = {}
    if CONFIG.exists():
        cfg = json.loads(CONFIG.read_text())
    args = sys.argv[1:]
    for i, a in enumerate(args):
        if a == "--app" and i + 1 < len(args):
            cfg["app"] = args[i + 1]
        if a == "--secret" and i + 1 < len(args):
            cfg["secret"] = args[i + 1]
    cfg["app"] = os.environ.get("SU_APP") or cfg.get("app")
    cfg["secret"] = os.environ.get("SU_SECRET") or cfg.get("secret")
    if not cfg.get("app") or not cfg.get("secret"):
        sys.exit("Set SU_APP and SU_SECRET (or pass --app/--secret) the first time.")
    BASE.mkdir(parents=True, exist_ok=True)
    CONFIG.write_text(json.dumps({"app": cfg["app"], "secret": cfg["secret"]}))
    CONFIG.chmod(0o600)
    APP, SECRET = cfg["app"].rstrip("/"), cfg["secret"]


def take_lock():
    if LOCK.exists():
        try:
            pid = int(LOCK.read_text().strip())
            os.kill(pid, 0)
            sys.exit(f"Another worker is already running (pid {pid}). Stop it first: kill {pid}")
        except (ValueError, ProcessLookupError, PermissionError):
            pass
    LOCK.write_text(str(os.getpid()))


def main():
    BASE.mkdir(parents=True, exist_ok=True)
    os.chdir(BASE)
    load_config()
    if not DRY_RUN:
        ensure_python_with_torch()
    take_lock()
    log(f"spark-upscaler worker {VERSION} ({WORKER_ID}) → {APP}" + (" [DRY RUN]" if DRY_RUN else ""))
    threading.Thread(target=heartbeat_loop, daemon=True).start()
    try:
        setup()
        if "--skip-selftest" not in sys.argv and not (BASE / ".selftest-ok").exists():
            set_state("setup", "checking the connection to the app")
            if selftest():
                (BASE / ".selftest-ok").write_text(VERSION)
            else:
                raise RuntimeError("Self-test failed; see the log")
    except Exception as e:
        set_state("error", f"setup failed: {e}"[:1900])
        traceback.print_exc()
        time.sleep(40)  # let the heartbeat deliver the error
        sys.exit(1)
    work_loop()


if __name__ == "__main__":
    main()
