from types import SimpleNamespace

import pytest

from app import start


@pytest.mark.parametrize("targets,restarts", [([], 0), (["notion", "hubspot"], 1)])
def test_start_migrates_supervises_and_stops_children(monkeypatch, targets, restarts):
    calls, children, delays = [], [], []

    class Process:
        def __init__(self, api=False, failed=False):
            self.api, self.returncode = api, 1 if failed else None

        def poll(self):
            if self.api and len(delays) >= 8:
                self.returncode = 0
            return self.returncode

        def terminate(self):
            self.returncode = 0

        def wait(self, timeout=None):
            assert self.returncode is not None
            return self.returncode

    def spawn(arguments):
        calls.append(arguments)
        child = Process(api=len(children) == 0, failed=len(children) == 1)
        children.append(child)
        return child

    monkeypatch.setattr(start, "Settings", lambda: SimpleNamespace(sync_targets=targets))
    monkeypatch.setattr(start.subprocess, "run", lambda args, check: calls.append(args))
    monkeypatch.setattr(start.subprocess, "Popen", spawn)
    monkeypatch.setattr(start.signal, "signal", lambda *_: None)
    monkeypatch.setattr(start.time, "sleep", lambda delay: delays.append(delay))
    assert start.main() == 0
    assert calls[0][-3:] == ["alembic", "upgrade", "head"]
    assert calls[1][2:4] == ["uvicorn", "app.main:app"]
    assert len(children) == 2 + restarts
    assert all(child.returncode is not None for child in children)


def test_disabled_worker_logs_and_exits(monkeypatch, caplog):
    from app import worker
    monkeypatch.setattr(worker, "Settings", lambda: SimpleNamespace(sync_targets=[]))
    monkeypatch.setattr(worker, "make_engine", lambda *_: pytest.fail("Disabled worker must not open a database."))
    monkeypatch.setattr(worker, "argparse", SimpleNamespace(ArgumentParser=lambda **_: SimpleNamespace(
        add_argument=lambda *a, **k: None, parse_args=lambda: SimpleNamespace(once=False))))
    with caplog.at_level("INFO"):
        worker.main()
    assert "External sync is disabled" in caplog.text
