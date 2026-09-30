"""Real auth/HTTP/streaming, deterministic OCR/provider data for Electron QA."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import server
import uvicorn
from local_auth import read_session_key


class FixtureManga:
    def start(self): pass
    def close(self): pass
    def status(self): return 'ready'
    def recognize(self, image): return '精読テスト'


def translated(bubbles, *args, **kwargs):
    for bubble in bubbles:
        yield {**bubble, 'translated':'Fixture translation', 'cached':False}


server.app.state.session_key = read_session_key(sys.stdin.buffer)
server.prewarm = lambda: server._warm.update(state='ready')
server._manga = FixtureManga()
server.manga_ocr_python = lambda: Path(sys.executable)
server.ocr.ocr_lines = lambda image, source: [{'box':[60,60,200,140], 'text':'こんにちは', 'score':1}]
server.translate.translated_bubbles = translated
server.translate.translate_text = lambda *args, **kwargs: 'Corrected translation'
uvicorn.run(server.app, host='127.0.0.1', port=int(sys.argv[1]), log_level='warning')
