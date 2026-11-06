"""Card D's local map bridge: the world catalogue and the retail feature catalogues for the feature tool. The map export itself runs
in the page (sculpt-export-worker.js, export/ built for WebAssembly); the map-export binary is used here only to read the catalogue
from installed content when the assets root is not prepared. Derived catalogues stay private."""
import json
import os
import shlex
import shutil
import subprocess
import threading
from pathlib import Path
from urllib.parse import unquote, urlsplit


class MapExport:
    def __init__(self, root, tool, game_roots, feature_tool, prepared=False):
        self.root = Path(root)
        # Prepared: use the saved catalogues; the content roots hold no retail maps.
        self.prepared = prepared
        self.tool = str(tool)
        self.feature_tool = str(feature_tool)
        self.game_roots = [str(p) for p in game_roots]
        self.catalogue = None
        self.feature_worlds = set()
        self.lock = threading.Lock()

    def require_tool(self, tool):
        package = 'features' if tool == self.feature_tool else 'export'
        if not Path(tool).is_file():
            raise ValueError(f'Missing map-{package} helper: {tool}. Build it with: go build -o {shlex.quote(tool)} ./{package}')
        if not os.access(tool, os.X_OK):
            raise ValueError(f'Map-{package} helper is not executable: {tool}. Build it with: go build -o {shlex.quote(tool)} ./{package}')

    def arguments(self, tool, *args):
        self.require_tool(tool)
        return [tool, *[arg for root in self.game_roots for arg in ('--root', root)], *args]

    def run(self, *args):
        return self.command(self.tool, *args)

    def command(self, tool, *args):
        done = subprocess.run(self.arguments(tool, *args), capture_output=True, text=True, timeout=180)
        if done.returncode:
            raise ValueError(done.stderr.strip() or f'Map helper failed: {tool}')
        return json.loads(done.stdout)

    def catalog(self):
        if self.catalogue is None:
            self.catalogue = json.loads((self.root / 'map-catalog.json').read_text()) if self.prepared else self.run('--catalog')
        return self.catalogue

    def features(self, world):
        data = self.catalog()
        if world not in data['worlds'] or data['worlds'][world].get('disabledReason'):
            raise ValueError('This world has no established retail feature set')
        target = self.root / 'features' / world / 'catalog.json'
        if self.prepared:
            if not target.is_file():
                raise ValueError(f'No prepared feature catalogue for {world}: {target}')
            return target.parent
        if world not in self.feature_worlds:
            self.root.mkdir(parents=True, exist_ok=True)
            source = self.root / 'map-catalog.json'
            source.write_text(json.dumps(data))
            self.command(self.feature_tool, '--catalog', str(source), '--world', world, '--out', str(self.root / 'features'))
            self.feature_worlds.add(world)
        return target.parent

    def get(self, handler, path):
        path = urlsplit(path).path
        if path == '/map-catalog.json':
            with self.lock:
                data = self.catalog()
            self.reply(handler, data)
            return True
        if path.startswith('/map-features/'):
            parts = unquote(path.removeprefix('/map-features/')).split('/')
            if len(parts) != 2 or parts[0] not in ('green', 'red', 'archipelago', 'moon', 'lava', 'desert', 'crystal', 'ice'):
                handler.send_error(404)
                return True
            world, name = parts
            if name != 'catalog.json' and (Path(name).name != name or not name.endswith('.png')):
                handler.send_error(404)
                return True
            with self.lock:
                directory = self.features(world)
            self.file(handler, directory / name, 'application/json' if name == 'catalog.json' else 'image/png')
            return True
        return False

    @staticmethod
    def file(handler, path, content_type):
        if not path.is_file():
            handler.send_error(404)
            return
        with path.open('rb') as source:
            handler.send_response(200)
            handler.send_header('Content-Type', content_type)
            handler.send_header('Cache-Control', 'no-store')
            handler.send_header('Content-Length', str(path.stat().st_size))
            handler.end_headers()
            shutil.copyfileobj(source, handler.wfile, 64 * 1024)

    @staticmethod
    def reply(handler, data, code=200):
        body = json.dumps(data).encode()
        handler.send_response(code)
        handler.send_header('Content-Type', 'application/json')
        handler.send_header('Cache-Control', 'no-store')
        handler.send_header('Content-Length', str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)
