"""Card D's local export bridge. No retail data is written into the checkout."""
import base64
import json
import subprocess
import tempfile
import threading
from pathlib import Path
from urllib.parse import quote, unquote


class MapExport:
    def __init__(self, root, tool, game_roots):
        self.root = Path(root)
        self.tool = str(tool)
        self.game_roots = [str(p) for p in game_roots]
        self.catalogue = None
        self.lock = threading.Lock()

    def run(self, *args):
        roots = [arg for root in self.game_roots for arg in ('--root', root)]
        done = subprocess.run([self.tool, *roots, *args], capture_output=True, text=True, timeout=180)
        if done.returncode:
            raise ValueError(done.stderr.strip() or 'Map export helper failed')
        return json.loads(done.stdout)

    def get(self, handler, path):
        if path == '/map-catalog.json':
            with self.lock:
                if self.catalogue is None:
                    self.catalogue = self.run('--catalog')
            self.reply(handler, self.catalogue)
            return True
        if path.startswith('/map-exports/'):
            name = unquote(path.removeprefix('/map-exports/'))
            if Path(name).name != name or Path(name).suffix.lower() not in ('.ufo', '.png'):
                handler.send_error(404)
                return True
            file = self.root / 'exports' / name
            if not file.is_file():
                handler.send_error(404)
                return True
            body = file.read_bytes()
            handler.send_response(200)
            handler.send_header('Content-Type', 'image/png' if file.suffix == '.png' else 'application/octet-stream')
            handler.send_header('Content-Disposition', "attachment; filename*=UTF-8''" + quote(name))
            handler.send_header('Content-Length', str(len(body)))
            handler.end_headers()
            handler.wfile.write(body)
            return True
        return False

    def post(self, handler, path):
        if path != '/map-export':
            handler.send_error(404)
            return
        length = int(handler.headers.get('Content-Length', '0'))
        if length <= 0 or length > 96 * 1024 * 1024:
            raise ValueError('Export request must be between 1 byte and 96 MiB')
        request = json.loads(handler.rfile.read(length))
        if not isinstance(request, dict):
            raise ValueError('Expected an export object')
        chunks = request.get('chunks', [])
        if not isinstance(chunks, list) or not 1 <= len(chunks) <= 25:
            raise ValueError('Expected 1–25 terrain chunks')
        tmp = self.root / 'tmp'
        tmp.mkdir(parents=True, exist_ok=True)
        with self.lock, tempfile.TemporaryDirectory(prefix='export-', dir=tmp) as directory:
            manifest = {k: request[k] for k in ('name', 'description', 'world', 'unitsX', 'unitsY', 'seaLevel', 'heights')}
            manifest['chunks'] = []
            for i, chunk in enumerate(chunks):
                target = Path(directory) / f'chunk-{i}.png'
                target.write_bytes(base64.b64decode(chunk['png'], validate=True))
                manifest['chunks'].append(dict(x=chunk['x'], y=chunk['y'], path=str(target)))
            source = Path(directory) / 'manifest.json'
            source.write_text(json.dumps(manifest))
            result = self.run('--input', str(source), '--out', str(self.root / 'exports'))
        self.reply(handler, result)

    @staticmethod
    def reply(handler, data, code=200):
        body = json.dumps(data).encode()
        handler.send_response(code)
        handler.send_header('Content-Type', 'application/json')
        handler.send_header('Cache-Control', 'no-store')
        handler.send_header('Content-Length', str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)
