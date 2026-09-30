"""Keep the optional Manga OCR model in one child process for the app lifetime."""
import base64
import json
import os
import queue
import subprocess
import threading


class MangaWorkerError(Exception):
    def __init__(self, message, status_code=502):
        super().__init__(message)
        self.status_code = status_code


class MangaWorker:
    def __init__(self, python_resolver, script, startup_timeout=90, request_timeout=30):
        self.python_resolver = python_resolver
        self.script = script
        self.startup_timeout = startup_timeout
        self.request_timeout = request_timeout
        self.state = "loading" if python_resolver() else "missing"
        self._lock = threading.Lock()
        self._process = None
        self._responses = None
        self._closed = False

    def status(self):
        if self.state == "ready" and (self._process is None or self._process.poll() is not None):
            self.state = "error"
        return self.state

    @staticmethod
    def _read_lines(process, responses):
        try:
            for line in process.stdout:
                try:
                    responses.put(json.loads(line))
                except ValueError:
                    continue
        finally:
            responses.put(None)

    def _stop_locked(self):
        process = self._process
        self._process = None
        self._responses = None
        if process is None:
            return
        if process.poll() is None:
            if os.name == "nt":
                try:
                    subprocess.run(["taskkill.exe", "/PID", str(process.pid), "/T", "/F"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3,
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                except (OSError, subprocess.TimeoutExpired):
                    process.terminate()
            else:
                process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
        for stream in (process.stdin, process.stdout):
            try:
                stream.close()
            except OSError:
                pass

    def _start_locked(self):
        if self._closed or self.status() == "ready":
            return
        python = self.python_resolver()
        if python is None:
            self.state = "missing"
            return
        self._stop_locked()
        self.state = "loading"
        try:
            command = [str(python)] + ([str(self.script)] if self.script is not None else [])
            process = subprocess.Popen(command, stdin=subprocess.PIPE,
                                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                       text=True, encoding="utf-8", bufsize=1,
                                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            self._process = process
            self._responses = queue.Queue()
            threading.Thread(target=self._read_lines, args=(process, self._responses), daemon=True).start()
            ready = self._responses.get(timeout=self.startup_timeout)
            if not ready or ready.get("type") != "ready":
                raise MangaWorkerError("日漫精读模型启动失败，请检查可选依赖和模型缓存", 503)
            self.state = "ready"
        except queue.Empty:
            self.state = "error"
            self._stop_locked()
        except (OSError, MangaWorkerError):
            self.state = "error"
            self._stop_locked()

    def start(self):
        with self._lock:
            self._start_locked()

    def recognize(self, png):
        with self._lock:
            self._start_locked()
            if self.state != "ready":
                raise MangaWorkerError("日漫精读模型未就绪，请检查安装后重启应用", 503)
            try:
                self._process.stdin.write(json.dumps({"image": base64.b64encode(png).decode("ascii")}) + "\n")
                self._process.stdin.flush()
                answer = self._responses.get(timeout=self.request_timeout)
                if answer and answer.get("error"):
                    raise MangaWorkerError(answer["error"])
                if not answer or not isinstance(answer.get("text"), str):
                    raise MangaWorkerError("日漫精读未返回有效文字，请重试")
                return answer["text"]
            except queue.Empty:
                self.state = "error"
                self._stop_locked()
                raise MangaWorkerError("日漫精读响应超时，请重试", 504) from None
            except OSError:
                self.state = "error"
                self._stop_locked()
                raise MangaWorkerError("日漫精读进程已停止，请重试") from None

    def close(self):
        with self._lock:
            self._closed = True
            self.state = "stopped"
            self._stop_locked()
