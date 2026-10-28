"""Card D's local map bridge. Derived catalogues and exports stay private."""
import base64
import json
import subprocess
import tempfile
import threading
from pathlib import Path
from urllib.parse import quote, unquote


class MapExport:
    def __init__(self, root, tool, game_roots, feature_tool):
        self.root = Path(root)
        self.tool = str(tool)
        self.feature_tool = str(feature_tool)
        self.game_roots = [str(p) for p in game_roots]
        self.catalogue = None
        self.feature_worlds = set()
        self.lock = threading.Lock()

    def run(self, *args):
        return self.command(self.tool, *args)

    def command(self, tool, *args):
        roots = [arg for root in self.game_roots for arg in ('--root', root)]
        done = subprocess.run([tool, *roots, *args], capture_output=True, text=True, timeout=180)
        if done.returncode:
            raise ValueError(done.stderr.strip() or 'Map helper failed')
        return json.loads(done.stdout)

    def catalog(self):
        if self.catalogue is None:
            self.catalogue = self.run('--catalog')
        return self.catalogue

    def features(self, world):
        data = self.catalog()
        if world not in data['worlds'] or data['worlds'][world].get('disabledReason'):
            raise ValueError('This world has no established retail feature set')
        target = self.root / 'features' / world / 'catalog.json'
        if world not in self.feature_worlds:
            self.root.mkdir(parents=True, exist_ok=True)
            source = self.root / 'map-catalog.json'
            source.write_text(json.dumps(data))
            self.command(self.feature_tool, '--catalog', str(source), '--world', world, '--out', str(self.root / 'features'))
            self.feature_worlds.add(world)
        return target.parent

    def get(self, handler, path):
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
        if path.startswith('/map-exports/'):
            name = unquote(path.removeprefix('/map-exports/'))
            if Path(name).name != name or Path(name).suffix.lower() not in ('.ufo', '.png'):
                handler.send_error(404)
                return True
            self.file(handler, self.root / 'exports' / name, 'image/png' if name.endswith('.png') else 'application/octet-stream', name)
            return True
        return False

    @staticmethod
    def file(handler, path, content_type, download=None):
        if not path.is_file():
            handler.send_error(404)
            return
        body = path.read_bytes()
        handler.send_response(200)
        handler.send_header('Content-Type', content_type)
        handler.send_header('Cache-Control', 'no-store')
        if download:
            handler.send_header('Content-Disposition', "attachment; filename*=UTF-8''" + quote(download))
        handler.send_header('Content-Length', str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)

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
            if request.get('features'):
                self.features(request.get('world'))
            manifest = {k: request[k] for k in ('name', 'description', 'world', 'unitsX', 'unitsY', 'seaLevel', 'heights')}
            for key in ('features', 'starts', 'settings'):
                if key in request:
                    manifest[key] = request[key]
            manifest['chunks'] = []
            for i, chunk in enumerate(chunks):
                target = Path(directory) / f'chunk-{i}.png'
                target.write_bytes(base64.b64decode(chunk['png'], validate=True))
                manifest['chunks'].append(dict(x=chunk['x'], y=chunk['y'], path=str(target)))
            source = Path(directory) / 'manifest.json'
            source.write_text(json.dumps(manifest))
            result = self.run('--input', str(source), '--out', str(self.root / 'exports'), '--features-root', str(self.root / 'features'))
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
