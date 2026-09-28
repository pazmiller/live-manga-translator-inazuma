import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from manga_worker import MangaWorker


class MangaWorkerTests(unittest.TestCase):
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
