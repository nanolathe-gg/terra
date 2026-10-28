"""Incremental map documents: small metadata and independently saved chunks."""
import hashlib
import json
import os
import re
import shutil
import tempfile
import threading
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


class MapDocument:
    def __init__(self, root):
        self.root = Path(root) / 'documents'
        self.lock = threading.RLock()

    @staticmethod
    def token(value, label):
        if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}', value) or '..' in value:
            raise ValueError(f'{label} must contain 1–128 ASCII letters, digits, underscores, hyphens or single dots')
        return value

    def address(self, path):
        parsed = urlsplit(path)
        if parsed.path not in ('/map-document', '/map-document/chunk'):
            return None
        query = parse_qs(parsed.query, keep_blank_values=True)
        if len(query.get('id', [])) != 1:
            raise ValueError('One document id is required')
        ident = self.token(query['id'][0], 'Document id')
        key = None
        if parsed.path.endswith('/chunk'):
            if len(query.get('key', [])) != 1:
                raise ValueError('One chunk key is required')
            key = self.token(query['key'][0], 'Chunk key')
        return ident, key

    def load(self, ident):
        path = self.root / ident / 'document.json'
        if not path.is_file():
            return {'document': {}, 'chunks': {}, 'revision': 0}
        return json.loads(path.read_text())

    @staticmethod
    def atomic(path, body):
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix='.document-', dir=path.parent)
        try:
            with os.fdopen(fd, 'wb') as target:
                target.write(body)
                target.flush()
                os.fsync(target.fileno())
            os.replace(name, path)
        finally:
            Path(name).unlink(missing_ok=True)

    def save(self, ident, state):
        self.atomic(self.root / ident / 'document.json', json.dumps(state, sort_keys=True, separators=(',', ':'), allow_nan=False).encode())

    @staticmethod
    def result(ident, state):
        return dict(id=ident, document=state['document'], revision=state['revision'],
                    chunks=[dict(key=key, bytes=rec['bytes'], sha256=rec['sha256']) for key, rec in sorted(state['chunks'].items())])

    @staticmethod
    def reply(handler, data, code=200):
        body = json.dumps(data, allow_nan=False).encode()
        handler.send_response(code)
        handler.send_header('Content-Type', 'application/json')
        handler.send_header('Cache-Control', 'no-store')
        handler.send_header('Content-Length', str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)

    def get(self, handler, path):
        address = self.address(path)
        if address is None:
            return False
        ident, key = address
        with self.lock:
            state = self.load(ident)
            if not (self.root / ident / 'document.json').is_file():
                handler.send_error(404)
                return True
            if key is None:
                self.reply(handler, self.result(ident, state))
                return True
            rec = state['chunks'].get(key)
            if rec is None:
                handler.send_error(404)
                return True
            with (self.root / ident / rec['file']).open('rb') as source:
                handler.send_response(200)
                handler.send_header('Content-Type', 'application/octet-stream')
                handler.send_header('Cache-Control', 'no-store')
                handler.send_header('Content-Length', str(rec['bytes']))
                handler.send_header('ETag', '"' + rec['sha256'] + '"')
                handler.end_headers()
                shutil.copyfileobj(source, handler.wfile, 64 * 1024)
        return True

    def put(self, handler, path):
        address = self.address(path)
        if address is None:
            return False
        ident, key = address
        length = int(handler.headers.get('Content-Length', '0'))
        limit = (32 if key is not None else 16) * 1024 * 1024
        if length < 0 or length > limit or (key is None and length == 0):
            raise ValueError(f'Document request exceeds {limit // (1024 * 1024)} MiB')
        body = handler.rfile.read(length)
        if len(body) != length:
            raise ValueError('Document request ended before Content-Length')
        with self.lock:
            state = self.load(ident)
            if key is None:
                document = json.loads(body)
                if not isinstance(document, dict):
                    raise ValueError('Document metadata must be a JSON object')
                # Metadata holds the graph, features, starts and OTA settings;
                # binary field planes belong to the separate chunk endpoint.
                serialized = json.dumps(document, sort_keys=True, separators=(',', ':'), allow_nan=False)
                previous = json.dumps(state['document'], sort_keys=True, separators=(',', ':'), allow_nan=False)
                if serialized != previous or not (self.root / ident / 'document.json').is_file():
                    state['document'] = document
                    state['revision'] += 1
                    self.save(ident, state)
                self.reply(handler, self.result(ident, state))
                return True
            digest = hashlib.sha256(body).hexdigest()
            previous = state['chunks'].get(key)
            changed = previous is None or previous['sha256'] != digest
            if changed:
                # Content names keep the previous manifest readable if the
                # process stops between the chunk and metadata replacements.
                filename = f'chunk-{key}-{digest}.bin'
                self.atomic(self.root / ident / filename, body)
                state['chunks'][key] = dict(file=filename, bytes=length, sha256=digest)
                state['revision'] += 1
                self.save(ident, state)
                if previous:
                    (self.root / ident / previous['file']).unlink(missing_ok=True)
            self.reply(handler, dict(id=ident, key=key, bytes=length, sha256=digest, changed=changed, revision=state['revision']))
        return True

    def delete(self, handler, path):
        address = self.address(path)
        if address is None:
            return False
        ident, key = address
        with self.lock:
            state = self.load(ident)
            if key is not None:
                previous = state['chunks'].pop(key, None)
                if previous:
                    state['revision'] += 1
                    self.save(ident, state)
                    (self.root / ident / previous['file']).unlink(missing_ok=True)
            else:
                for rec in state['chunks'].values():
                    (self.root / ident / rec['file']).unlink(missing_ok=True)
                (self.root / ident / 'document.json').unlink(missing_ok=True)
                directory = self.root / ident
                if directory.is_dir() and not any(directory.iterdir()):
                    directory.rmdir()
            self.reply(handler, dict(id=ident, deleted=True))
        return True
