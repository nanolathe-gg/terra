"""Card D's local map bridge. Derived catalogues and exports stay private."""
import atexit
import base64
import json
import os
import re
import select
import shlex
import shutil
import struct
import subprocess
import tempfile
import threading
import uuid
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlsplit


class ExportJob:
    def __init__(self, ident, directory, process):
        self.id, self.directory, self.process = ident, directory, process
        self.lock = threading.RLock()
        self.cancelled = False

    def exchange(self, command=None):
        if self.cancelled:
            raise ValueError('Export was cancelled')
        if command is not None:
            self.process.stdin.write(json.dumps(command) + '\n')
            self.process.stdin.flush()
        ready, _, _ = select.select([self.process.stdout], [], [], 300)
        if not ready:
            raise ValueError('Map export helper timed out')
        line = self.process.stdout.readline()
        if not line:
            self.process.wait(timeout=10)
            raise ValueError(self.process.stderr.read().strip() or 'Map export helper stopped before replying')
        return json.loads(line)


class MapExport:
    def __init__(self, root, tool, game_roots, feature_tool):
        self.root = Path(root)
        self.tool = str(tool)
        self.feature_tool = str(feature_tool)
        self.game_roots = [str(p) for p in game_roots]
        self.catalogue = None
        self.feature_worlds = set()
        self.lock = threading.Lock()
        self.jobs_lock = threading.Lock()
        self.jobs = {}
        self.temporary = Path(tempfile.gettempdir()) / 'nanolathe-map-export-jobs'
        self.cleanup_crashes()
        atexit.register(self.close)

    def require_tool(self, tool):
        package = 'features' if tool == self.feature_tool else 'export'
        if not Path(tool).is_file():
            raise ValueError(f'Missing map-{package} helper: {tool}. Build it with: go build -o {shlex.quote(tool)} ./tools/map-editor/{package}')
        if not os.access(tool, os.X_OK):
            raise ValueError(f'Map-{package} helper is not executable: {tool}. Build it with: go build -o {shlex.quote(tool)} ./tools/map-editor/{package}')

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
        with path.open('rb') as source:
            handler.send_response(200)
            handler.send_header('Content-Type', content_type)
            handler.send_header('Cache-Control', 'no-store')
            if download:
                handler.send_header('Content-Disposition', "attachment; filename*=UTF-8''" + quote(download))
            handler.send_header('Content-Length', str(path.stat().st_size))
            handler.end_headers()
            shutil.copyfileobj(source, handler.wfile, 64 * 1024)

    @staticmethod
    def request(handler, limit):
        length = int(handler.headers.get('Content-Length', '0'))
        if length <= 0 or length > limit:
            raise ValueError(f'Export request must be between 1 byte and {limit // (1024 * 1024)} MiB')
        body = handler.rfile.read(length)
        if len(body) != length:
            raise ValueError('Export request ended before Content-Length')
        request = json.loads(body)
        if not isinstance(request, dict):
            raise ValueError('Expected an export object')
        return request

    def start(self, request):
        if 'chunks' in request:
            raise ValueError('Send PNGs to /map-export/chunk after starting the export')
        allowed = ('name', 'description', 'world', 'unitsX', 'unitsY', 'seaLevel', 'heights', 'features', 'starts', 'settings')
        if any(key not in allowed for key in request):
            raise ValueError('Unknown export metadata field')
        serialized = json.dumps(request, separators=(',', ':'), allow_nan=False)
        with self.lock:
            self.require_tool(self.tool)
            if request.get('features'):
                self.features(request.get('world'))
        ident = uuid.uuid4().hex
        self.temporary.mkdir(parents=True, exist_ok=True)
        directory = self.temporary / ('export-' + ident)
        directory.mkdir(mode=0o700)
        owner = dict(version=1, id=ident, pid=os.getpid(), out=str((self.root / 'exports').resolve()))
        manifest = directory / 'manifest.json'
        process = None
        try:
            (directory / 'owner.json').write_text(json.dumps(owner))
            manifest.write_text(serialized)
            # TMPDIR can select private diagnostic storage. Production uses
            # the OS temporary directory rather than the editor's asset tree.
            args = self.arguments(self.tool, '--stream', '--input', str(manifest), '--out', str(self.root / 'exports'), '--work', str(directory), '--features-root', str(self.root / 'features'))
            budget = os.environ.get('NANOLATHE_EXPORT_TILE_BUDGET_MB')
            if budget is not None:
                args += ['--tile-budget-mb', budget]
            process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
            job = ExportJob(ident, directory, process)
            ready = job.exchange()
            if ready.get('ready') is not True:
                raise ValueError('Map export helper did not become ready')
            with self.jobs_lock:
                self.jobs[ident] = job
            return dict(id=ident, width=ready['width'], height=ready['height'], maxChunkSide=ready['maxChunkSide'])
        except BaseException:
            if process is not None:
                self.stop_process(process)
            self.cleanup_directory(directory)
            raise

    def job(self, query):
        values = query.get('id', [])
        if len(values) != 1 or not re.fullmatch('[0-9a-f]{32}', values[0]):
            raise ValueError('One valid export id is required')
        with self.jobs_lock:
            job = self.jobs.get(values[0])
        if job is None:
            raise ValueError('Export id is unknown or no longer active')
        return job

    def chunk(self, job, x, y, width, height, source, length):
        if length <= 0 or length > 64 * 1024 * 1024:
            raise ValueError('A PNG chunk must be between 1 byte and 64 MiB')
        target = job.directory / 'chunk.png'
        try:
            with target.open('wb') as out:
                left = length
                while left:
                    block = source.read(min(left, 64 * 1024))
                    if not block:
                        raise ValueError('PNG upload ended before Content-Length')
                    out.write(block)
                    left -= len(block)
            result = job.exchange(dict(op='chunk', x=x, y=y, width=width, height=height, path=str(target)))
            result['id'] = job.id
            return result
        finally:
            target.unlink(missing_ok=True)

    def finish(self, job):
        result = job.exchange(dict(op='finish'))
        job.process.wait(timeout=10)
        if job.process.returncode:
            raise ValueError(job.process.stderr.read().strip() or 'Map export helper failed')
        return result

    def post(self, handler, path):
        parsed = urlsplit(path)
        if parsed.path == '/map-export':
            self.legacy(handler)
            return True
        if parsed.path == '/map-export/start':
            ready = self.start(self.request(handler, 16 * 1024 * 1024))
            try:
                self.reply(handler, ready)
            except BaseException:
                self.discard(self.job({'id': [ready['id']]}))
                raise
            return True
        if parsed.path not in ('/map-export/chunk', '/map-export/finish'):
            return False
        query = parse_qs(parsed.query, keep_blank_values=True)
        job = self.job(query)
        try:
            with job.lock:
                if parsed.path.endswith('/chunk'):
                    coordinates = []
                    for key in ('x', 'y', 'width', 'height'):
                        if len(query.get(key, [])) != 1 or not re.fullmatch(r'\d{1,6}', query[key][0]):
                            raise ValueError(f'One integer chunk {key} is required')
                        coordinates.append(int(query[key][0]))
                    result = self.chunk(job, *coordinates, handler.rfile, int(handler.headers.get('Content-Length', '0')))
                else:
                    result = self.finish(job)
                    self.discard(job)
            self.reply(handler, result)
        except BaseException:
            self.discard(job)
            raise
        return True

    def legacy(self, handler):
        request = self.request(handler, 96 * 1024 * 1024)
        chunks = request.pop('chunks', None)
        if not isinstance(chunks, list) or not 1 <= len(chunks) <= 25:
            raise ValueError('Expected 1–25 terrain chunks')
        ready = self.start(request)
        job = self.job({'id': [ready['id']]})
        try:
            with job.lock:
                from io import BytesIO
                for chunk in sorted(chunks, key=lambda c: (c['y'], c['x'])):
                    png = base64.b64decode(chunk['png'], validate=True)
                    if len(png) < 24 or png[:8] != b'\x89PNG\r\n\x1a\n':
                        raise ValueError('Expected a PNG terrain chunk')
                    width, height = struct.unpack('>II', png[16:24])
                    self.chunk(job, chunk['x'], chunk['y'], width, height, BytesIO(png), len(png))
                result = self.finish(job)
            self.reply(handler, result)
        finally:
            self.discard(job)

    def delete(self, handler, path):
        parsed = urlsplit(path)
        if parsed.path != '/map-export':
            return False
        job = self.job(parse_qs(parsed.query, keep_blank_values=True))
        # Signal before the job lock so cancellation interrupts conversion or
        # final assembly already running in another HTTP thread.
        job.cancelled = True
        if job.process.poll() is None:
            job.process.terminate()
        self.discard(job)
        self.reply(handler, dict(id=job.id, cancelled=True))
        return True

    @staticmethod
    def stop_process(process):
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)
        for stream in (process.stdin, process.stdout, process.stderr):
            stream.close()

    def discard(self, job):
        with self.jobs_lock:
            self.jobs.pop(job.id, None)
        with job.lock:
            self.stop_process(job.process)
            self.cleanup_directory(job.directory)

    def cleanup_directory(self, directory):
        # Remove explicit filenames and exact Go temp-name patterns only.
        # Unknown files and nonempty directories remain untouched.
        if directory.is_dir():
            for path in directory.iterdir():
                if path.name in ('owner.json', 'manifest.json', 'chunk.png') or re.fullmatch(r'nanolathe-map-(?:tiles|tnt)-[A-Za-z0-9_-]+', path.name):
                    if path.is_file() or path.is_symlink():
                        path.unlink(missing_ok=True)
            if not any(directory.iterdir()):
                directory.rmdir()
        ident = directory.name.removeprefix('export-')
        if re.fullmatch('[0-9a-f]{32}', ident):
            for kind in ('archive', 'indexed'):
                (self.root / 'exports' / f'.map-export-{ident}-{kind}.tmp').unlink(missing_ok=True)

    def cleanup_crashes(self):
        if not self.temporary.is_dir():
            return
        output = str((self.root / 'exports').resolve())
        for directory in self.temporary.iterdir():
            if not re.fullmatch(r'export-[0-9a-f]{32}', directory.name) or not directory.is_dir():
                continue
            try:
                owner = json.loads((directory / 'owner.json').read_text())
                if owner.get('version') != 1 or owner.get('id') != directory.name[7:] or owner.get('out') != output:
                    continue
                try:
                    os.kill(int(owner['pid']), 0)
                    continue
                except ProcessLookupError:
                    self.cleanup_directory(directory)
                except PermissionError:
                    continue
            except (OSError, ValueError, KeyError, TypeError):
                continue

    def close(self):
        with self.jobs_lock:
            jobs = list(self.jobs.values())
        for job in jobs:
            job.cancelled = True
            self.discard(job)

    @staticmethod
    def reply(handler, data, code=200):
        body = json.dumps(data).encode()
        handler.send_response(code)
        handler.send_header('Content-Type', 'application/json')
        handler.send_header('Cache-Control', 'no-store')
        handler.send_header('Content-Length', str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)
