import sys
import tempfile
import unittest
import io
from unittest.mock import MagicMock, patch
from types import SimpleNamespace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from manga_worker import MangaWorker


class MangaWorkerTests(unittest.TestCase):
    def test_frozen_backend_finds_only_its_bundled_worker(self):
        import server
        with tempfile.TemporaryDirectory() as directory:
            resources = Path(directory)
            runtime = SimpleNamespace(frozen=True, executable=str(resources / 'backend/inazuma-backend.exe'))
            with patch.object(server, 'sys', runtime):
                self.assertIsNone(server.manga_ocr_python())
                worker = resources / 'manga-ocr/inazuma-manga-ocr.exe'
                worker.parent.mkdir()
                worker.touch()
                self.assertEqual(server.manga_ocr_python(), worker)

    def test_bundled_executable_starts_without_python_script_argument(self):
        process = MagicMock()
        process.stdout = io.StringIO('{"type":"ready"}\n')
        process.poll.return_value = None
        worker = MangaWorker(lambda: Path('inazuma-manga-ocr.exe'), None, startup_timeout=2)
        with patch('manga_worker.subprocess.Popen', return_value=process) as start:
            worker.start()
        self.assertEqual(worker.status(), 'ready')
        self.assertEqual(start.call_args.args[0], ['inazuma-manga-ocr.exe'])
        process.poll.return_value = 0
        worker.close()

    def test_reuses_process_and_stops_it_on_close(self):
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / "fake_manga.py"
            script.write_text(
                "import json, os, sys\n"
                "print(json.dumps({'type': 'ready'}), flush=True)\n"
                "for line in sys.stdin:\n"
                "    json.loads(line)\n"
                "    print(json.dumps({'text': str(os.getpid())}), flush=True)\n",
                encoding="utf-8",
            )
            worker = MangaWorker(lambda: Path(sys.executable), script, startup_timeout=5, request_timeout=5)
            try:
                worker.start()
                self.assertEqual(worker.status(), "ready")
                first_pid = worker.recognize(b"first")
                self.assertTrue(first_pid.isdecimal())
                self.assertEqual(worker.recognize(b"second"), first_pid)
            finally:
                process = worker._process
                worker.close()
            self.assertIsNotNone(process.poll())
            self.assertEqual(worker.status(), "stopped")


if __name__ == "__main__":
    unittest.main()
