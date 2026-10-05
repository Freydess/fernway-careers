"""Migrate, supervise the worker, and serve the API in Render's single container."""
import os
import signal
import subprocess
import sys
import time

from app.config import Settings


def main():
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True)
    settings = Settings()
    api = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", os.getenv("PORT", "8000")])
    worker = subprocess.Popen([sys.executable, "-m", "app.worker"])
    stopping = False

    def stop(_signum, _frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        while not stopping and api.poll() is None:
            if worker.poll() is not None and settings.sync_targets:
                print("Sync worker exited; restarting in 5 seconds.", flush=True)
                for _ in range(5):
                    if stopping or api.poll() is not None:
                        break
                    time.sleep(1)
                if not stopping and api.poll() is None:
                    worker = subprocess.Popen([sys.executable, "-m", "app.worker"])
            time.sleep(0.5)
    finally:
        for process in (api, worker):
            if process.poll() is None:
                process.terminate()
        for process in (api, worker):
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
    return api.returncode if not stopping else 0


if __name__ == "__main__":
    sys.exit(main())
