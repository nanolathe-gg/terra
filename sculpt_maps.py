"""Local stand-in for the save-link Worker (deploy/worker/worker.js): the same /maps API under /api/maps.

POST /api/maps takes a gzipped Terraform save and replies {"id"}; GET /api/maps/<id> returns it with Content-Encoding: gzip.
The id is the first 16 base32 characters of the SHA-256 of the gzipped bytes. Files live in <assets root>/maps/. There is no
delete here: remove a file by hand.
"""
import base64, hashlib, json, re, zlib
from pathlib import Path
from urllib.parse import urlsplit

MAX_COMPRESSED = 1024 * 1024
MAX_UNCOMPRESSED = 16 * 1024 * 1024
FORMAT = 'nanolathe-terrain-sculpt'
ID_RE = re.compile(r'[a-z2-7]{16}')


class Refusal(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def map_id(gz):
    return base64.b32encode(hashlib.sha256(gz).digest()).decode().lower()[:16]


def check_save(gz):
    if gz[:2] != b'\x1f\x8b':
        raise Refusal(400, 'The body is not gzip data. Send the save compressed with gzip.')
    try:
        inflater = zlib.decompressobj(31)
        raw = inflater.decompress(gz, MAX_UNCOMPRESSED + 1)
        if len(raw) > MAX_UNCOMPRESSED or inflater.unconsumed_tail:
            raise Refusal(413, 'The save is too large once uncompressed (limit 16 MB).')
        if not inflater.eof:
            raise zlib.error('truncated')
        text = raw.decode('utf-8')
    except (zlib.error, UnicodeDecodeError):
        raise Refusal(400, 'The gzip data is damaged or does not hold UTF-8 text.')
    try:
        save = json.loads(text)
    except ValueError:
        raise Refusal(400, 'The save is not valid JSON.')
    if not isinstance(save, dict) or save.get('format') != FORMAT:
        raise Refusal(400, f'This is not a Terraform save: its format must be {FORMAT}.')
    version = save.get('version')
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise Refusal(400, 'This is not a Terraform save: it has no version number.')
    nodes = save.get('nodes')
    if not isinstance(nodes, list) or not all(isinstance(n, dict) for n in nodes):
        raise Refusal(400, 'This is not a Terraform save: nodes must be a list of stroke objects.')


class SavedMaps:
    def __init__(self, assets_root):
        self.root = Path(assets_root) / 'maps'

    def _reply(self, handler, body, status=200, headers=None):
        data = json.dumps(body).encode() if not isinstance(body, bytes) else body
        handler.send_response(status)
        for k, v in {'Content-Type': 'application/json', 'Cache-Control': 'no-store', **(headers or {})}.items():
            handler.send_header(k, v)
        handler.send_header('Content-Length', str(len(data)))
        handler.end_headers()
        handler.wfile.write(data)

    def get(self, handler, path):
        """Serve GET /api/maps/<id>; False when the path is not ours."""
        m = re.fullmatch(r'/api/maps/([^/]*)', urlsplit(path).path)
        if not m:
            return False
        file = self.root / f'{m.group(1)}.json.gz'
        if not ID_RE.fullmatch(m.group(1)) or not file.is_file():
            self._reply(handler, {'error': 'No saved map has this id.'}, 404)
        else:
            self._reply(handler, file.read_bytes(), headers={'Content-Encoding': 'gzip', 'Cache-Control': 'public, max-age=31536000, immutable'})
        return True

    def post(self, handler, path):
        """Handle POST /api/maps; False when the path is not ours."""
        if urlsplit(path).path != '/api/maps':
            return False
        try:
            length = int(handler.headers.get('Content-Length') or 0)
            if length > MAX_COMPRESSED:
                raise Refusal(413, 'The save is too large (limit 1 MB compressed).')
            gz = handler.rfile.read(length)
            check_save(gz)
            ident = map_id(gz)
            self.root.mkdir(parents=True, exist_ok=True)
            file = self.root / f'{ident}.json.gz'
            if not file.exists():
                tmp = file.with_suffix('.tmp')
                tmp.write_bytes(gz)
                tmp.replace(file)
            self._reply(handler, {'id': ident})
        except Refusal as err:
            self._reply(handler, {'error': str(err)}, err.status)
        return True
