"""Local audit host. Injects audit-only hooks; never alters the normal server.
python repro/audit/server.py --source REPO --port 8895 --out /private/tmp/terraform-tool-audit/results/after
Only loopback is bound. Retail assets and generated screenshots stay outside Git.
"""
import argparse, importlib.util, json, mimetypes, sys
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlsplit, parse_qs
p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--port',type=int,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--assets',type=Path,default=Path('/private/tmp/terraform-tool-audit/assets'));p.add_argument('--evidence',type=Path,default=Path('/private/tmp/terraform-tool-audit'));p.add_argument('--export-tool',type=Path,default=Path('/private/tmp/nanolathe-map-editor/map-export'));p.add_argument('--report',type=Path);a=p.parse_args()
ROOT=a.source.resolve(); AUDIT=Path(__file__).resolve().parent; ASSETS=a.assets.resolve();a.out.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(ROOT));spec=importlib.util.spec_from_file_location('audit_sculpt',ROOT/'sculpt.py');s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
from sculpt_export import MapExport
exports=MapExport(ASSETS,a.export_tool,[Path.home()/'TotalAnnihilation'],True)
configs,catalogue=s.world_configs(list(s.BIOME_NAMES))
generated=s.site_data(list(s.BIOME_NAMES),configs,catalogue,{'defaultWorld':'green','worlds':list(s.BIOME_NAMES)})
class Handler(BaseHTTPRequestHandler):
 def reply(self,data,kind='application/json',status=200):
  if not isinstance(data,bytes):data=json.dumps(data).encode()
  self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.end_headers()
  try:self.wfile.write(data)
  except (BrokenPipeError,ConnectionResetError):pass
 def do_GET(self):
  u=urlsplit(self.path);q=parse_qs(u.query);name=u.path.strip('/')
  try:
   if exports.get(self,self.path):return
   if name in generated:self.reply(generated[name]);return
   if name in ('audit/erosion-before.js','audit/fields-before.js','audit/features-before.js'):
    source='sculpt-erosion.js' if 'erosion' in name else 'sculpt-features.js' if 'features' in name else 'sculpt-gpu-fields.js'
    data=((a.evidence/'baseline')/source).read_text().replace("from './sculpt-","from '/sculpt-")
    self.reply(data.encode(),'text/javascript');return
   if name=='audit/inventory.json':self.reply((a.evidence/'inventory.json').read_bytes());return
   if name=='audit/scenes.json':self.reply({p.stem:json.loads(p.read_text()) for p in (ROOT/'repro/scenes').glob('*.json')});return
   if name=='audit/defaults.json':self.reply({'defaults':s.KNOB_DEFAULTS,'worlds':s.WORLD_KNOBS,'engine':s.ENGINE_KNOBS});return
   file=None
   if name.startswith('audit-report/') and a.report:
    file=(a.report/name.removeprefix('audit-report/')).resolve()
    if not file.is_relative_to(a.report.resolve()):raise ValueError('invalid report path')
   elif name.startswith('audit/'):
    leaf=name.removeprefix('audit/');file=(AUDIT/leaf).resolve()
    if not file.is_relative_to(AUDIT):raise ValueError('invalid audit path')
   elif name.startswith('results/'):
    file=(a.out/name.removeprefix('results/')).resolve()
    if not file.is_relative_to(a.out.resolve()):raise ValueError('invalid result path')
   elif name.startswith('sculpt-assets/'):
    b,leaf=name.removeprefix('sculpt-assets/').split('/',1);file=(ASSETS/f'assets-{b}'/leaf)
    if '/' in leaf or b not in configs:raise ValueError('invalid asset')
   else:file=s.SOURCES.get('sculpt.html' if name in ('','sculpt') else name)
   if file is None or not file.is_file():self.send_error(404);return
   data=file.read_bytes()
   # Only pages explicitly requesting audit receive private development access.
   if name=='sculpt.js':data+=b'\nif(experiment.has("audit")){'+(AUDIT/'hook.js').read_bytes()+b'\n}\n'
   self.reply(data,mimetypes.guess_type(str(file))[0] or 'application/octet-stream')
  except Exception as e:self.reply({'error':str(e)},status=400)
 def do_POST(self):
  name=urlsplit(self.path).path.removeprefix('/audit/save/')
  if not self.path.startswith('/audit/save/') or any(x in name for x in ['..','\\']) or name.startswith('/') or Path(name).suffix not in ('.json','.png'):
   self.send_error(400);return
  n=int(self.headers.get('Content-Length','0'))
  if n>32*1024*1024:self.send_error(413);return
  f=a.out/name;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(self.rfile.read(n));self.reply({'saved':name})
 def do_DELETE(self):
  if not exports.delete(self,self.path):self.send_error(404)
 def log_message(self,fmt,*args):
  if args and len(args)>1 and str(args[1]) not in ('200','304'):super().log_message(fmt,*args)
print(f'Audit host http://127.0.0.1:{a.port}/audit/index.html source={ROOT}',flush=True)
ThreadingHTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
