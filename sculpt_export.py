"""Card D's local map bridge: the world catalogue. The map export itself runs in the page (sculpt-export-worker.js, export/ built for
WebAssembly), with the map's own generated features; the map-export binary is used here only to read the catalogue from installed
content when the assets root is not prepared. Derived catalogues stay private."""
import json
import os
import shlex
import subprocess
import threading
from pathlib import Path
from urllib.parse import urlsplit


class MapExport:
    def __init__(self, root, tool, game_roots, prepared=False):
        self.root = Path(root)
        # Prepared: use the saved catalogue; the content roots hold no retail maps.
        self.prepared = prepared
        self.tool = str(tool)
        self.game_roots = [str(p) for p in game_roots]
        self.catalogue = None
        self.lock = threading.Lock()

    def require_tool(self, tool):
        if not Path(tool).is_file():
            raise ValueError(f'Missing map-export helper: {tool}. Build it with: go build -o {shlex.quote(tool)} ./export')
        if not os.access(tool, os.X_OK):
            raise ValueError(f'Map-export helper is not executable: {tool}. Build it with: go build -o {shlex.quote(tool)} ./export')

    def arguments(self, tool, *args):
        self.require_tool(tool)
        return [tool, *[arg for root in self.game_roots for arg in ('--root', root)], *args]

    def run(self, *args):
        done = subprocess.run(self.arguments(self.tool, *args), capture_output=True, text=True, timeout=180)
        if done.returncode:
            raise ValueError(done.stderr.strip() or f'Map helper failed: {self.tool}')
        return json.loads(done.stdout)

    def catalog(self):
        if self.catalogue is None:
            self.catalogue = json.loads((self.root / 'map-catalog.json').read_text()) if self.prepared else self.run('--catalog')
        return self.catalogue

    def get(self, handler, path):
        path = urlsplit(path).path
        if path == '/map-catalog.json':
            with self.lock:
                data = self.catalog()
            self.reply(handler, data)
            return True
        return False

    @staticmethod
    def reply(handler, data, code=200):
        body = json.dumps(data).encode()
        handler.send_response(code)
        handler.send_header('Content-Type', 'application/json')
        handler.send_header('Cache-Control', 'no-store')
        handler.send_header('Content-Length', str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)
