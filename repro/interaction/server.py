"""Loopback-only interaction benchmark host; normal application serving is unchanged."""
import argparse, importlib.util, json, mimetypes, sys
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlsplit, parse_qs
p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--port',type=int,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
root=a.source.resolve();here=Path(__file__).resolve().parent;a.out.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(root));spec=importlib.util.spec_from_file_location('perf_sculpt',root/'sculpt.py');s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
from sculpt_document import MapDocument
documents=MapDocument(a.out/'documents')
configs={b:s.biome_config(b) for b in s.BIOME_NAMES}
patterns={b:{'name':s.BIOME_NAMES[b],'groundTable':c['materialTable']} for b,c in configs.items() if 'ground' in json.loads((root/c['materialTable'].lstrip('/')).read_text())}
for b,c in configs.items():c.update(biomes=s.BIOME_NAMES,groundPatterns=patterns,variants={k:v['label'] for k,v in s.WORLD_VARIANTS.get(b,{}).items()})
class Handler(BaseHTTPRequestHandler):
 def reply(self,data,kind='application/json',status=200):
  if not isinstance(data,bytes):data=json.dumps(data).encode()
  self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.end_headers()
  try:self.wfile.write(data)
  except (BrokenPipeError,ConnectionResetError):pass
 def do_GET(self):
  u=urlsplit(self.path);q=parse_qs(u.query);name=u.path.strip('/')
  try:
   if name=='map-catalog.json':self.reply({'worlds':{b:s.export_defaults(b) for b in configs}});return
   if name=='sculpt-config.json':
    b=q.get('biome',['green'])[0];v=q.get('variant',[''])[0];self.reply(s.apply_variant(configs[b],b,v) if v else configs[b]);return
   if name=='interaction/scenes.json':self.reply({f.stem:json.loads(f.read_text()) for f in (root/'repro/scenes').glob('*.json')});return
   if name.startswith('map-features/') and name.endswith('/catalog.json'):self.reply({'features':[],'unavailable':'Performance fixture: no retail feature assets loaded.'});return
   if documents.get(self,self.path):return
   if name.startswith('interaction/'):
    f=(here/name.removeprefix('interaction/')).resolve()
    if not f.is_relative_to(here):raise ValueError('invalid path')
   elif name.startswith('results/'):
    f=(a.out/name.removeprefix('results/')).resolve()
    if not f.is_relative_to(a.out.resolve()):raise ValueError('invalid path')
   else:f=s.SOURCES.get('sculpt.html' if name in ('','sculpt') else name)
   if f is None or not f.is_file():self.send_error(404);return
   data=f.read_bytes()
   if f.name=='sculpt.html':data=data.replace(b'<head>',b'<head><script src="/interaction/hooks.js"></script>')
   if name=='sculpt.js':data+=b'\nif(experiment.has("interaction")){'+(here/'expose.js').read_bytes()+b'\n}\n'
   self.reply(data,mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
  except Exception as e:self.reply({'error':str(e)},status=400)
 def do_POST(self):
  name=urlsplit(self.path).path.removeprefix('/interaction/save/')
  if not self.path.startswith('/interaction/save/') or '..' in name or '\\' in name or Path(name).suffix not in ('.json','.png') or name.startswith('/'):
   self.send_error(400);return
  n=int(self.headers.get('Content-Length','0'))
  if n>32*1024*1024:self.send_error(413);return
  f=a.out/name;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(self.rfile.read(n));self.reply({'saved':name})
 def do_PUT(self):
  if not documents.put(self,self.path):self.send_error(404)
 def do_DELETE(self):
  if not documents.delete(self,self.path):self.send_error(404)
 def log_message(self,fmt,*args):
  if len(args)>1 and str(args[1]) not in ('200','304'):super().log_message(fmt,*args)
print(f'Interaction host http://127.0.0.1:{a.port}/interaction/index.html source={root}',flush=True)
ThreadingHTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
