"""Build the historical audit review, preserving its original keys and evidence."""
import argparse,html,json,re,shutil,statistics
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont
p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path('/tmp/terraform-tool-audit'));p.add_argument('--reference',type=Path,default=Path('/tmp/nanolathe-map-editor/agent-H12b/base-main-map-b'));p.add_argument('--out',type=Path,required=True);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True);media=a.out/'media';media.mkdir(exist_ok=True)
b=a.root/'results/before/baseline';q=a.root/'results/after/prototype';read=lambda p:json.loads(p.read_text());metrics=read(Path('docs/audit/measurements.json'));ledger=read(Path('docs/audit/controls.json'));workflow=read(Path('docs/audit/workflow-controls.json'))
def copy(src,name):
 dst=media/name
 if not dst.exists() or dst.stat().st_mtime<src.stat().st_mtime:shutil.copy2(src,dst)
 return 'media/'+name
scenes=[]
for f in sorted(b.glob('*-*/ours.png')):
 name=f.parent.name;retail=a.reference/name/'retail.png'
 if not retail.exists():raise FileNotFoundError(retail)
 scenes.append(dict(name=name,retail=copy(retail,name+'-reference.png'),before=copy(f,name+'-before.png'),after=copy(q/name/'ours.png',name+'-after.png'),referenceLabel='Third-party section reference' if name.startswith('zhon') else 'Retail TA reference'))
# Coarse-block displacement sensitivity; omit the outer block to avoid wrap edges.
def block_delta(x,y):
 x=x[16:-16,16:-16,:3].astype(float);y=y[16:-16,16:-16,:3].astype(float);h,w=x.shape[:2];h=h//16*16;w=w//16*16
 def stats(z):
  z=z[:h,:w].reshape(h//16,16,w//16,16,3).transpose(0,2,1,3,4);l=z@np.array([.2126,.7152,.0722]);return z.mean((2,3)),l.mean((2,3)),l.std((2,3))
 xm,xl,xs=stats(x);ym,yl,ys=stats(y)
 return float(((abs(xl-yl)>6)|(abs(xs-ys)>4)|(np.linalg.norm(xm-ym,axis=-1)>8)).mean())
noise=[]
for s in scenes:
 x=np.asarray(Image.open(b/s['name']/'ours.png').convert('RGB'));noise.append(dict(scene=s['name'],shiftX=2,shiftY=1,changedBlocks=block_delta(x,np.roll(x,(1,2),(0,1)))))
Path('docs/audit/displacement-noise.json').write_text(json.dumps(noise,indent=2)+'\n')
# Each image in the contact sheets is resized for display only. Full PNGs stay available.
try:font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',18)
except OSError:font=ImageFont.load_default()
for s in scenes:
 c=Image.new('RGB',(960,370),'#172027');d=ImageDraw.Draw(c)
 for i,(k,title) in enumerate([('retail',s['referenceLabel']),('before','Before'),('after','Prototype')]):
  d.text((i*320+8,8),title,fill='#dfe8e5',font=font);im=Image.open(a.out/s[k]).convert('RGB');im.thumbnail((320,320));c.paste(im,(i*320,38))
 c.save(media/(s['name']+'-triptych.jpg'),quality=92)
fixes=[]
for world,key in [('ice','frostGaps'),('ice','frostGapReach'),('ice','frostGapSize'),('ice','frostGapDepth'),('ice','mineralDetail'),('green','faceEdge'),('green','gullyRock'),('desert','strataSpacing')]:
 imgs=[]
 for folder,label in [(b,'before'),(q,'after')]:
  for side in ['lo','hi']:imgs.append(dict(src=copy(folder/'diagnostic'/world/(key+'-'+side+'.png'),key+'-'+label+'-'+side+'.png'),label=label+' · '+side))
 fixes.append(dict(key=key,images=imgs))
for f in sorted(q.glob('perf/*/*.png')):copy(f,'perf-'+f.parent.name+'-'+f.name)
for f in sorted(q.glob('profiles/*.png')):copy(f,'profile-'+f.name)
for phase,folder in [('before',b),('after',q)]:
 for f in sorted((folder/'ground-source').glob('*.png')):copy(f,'source-'+phase+'-'+f.name)
for f in sorted(q.glob('scale/*.png')):copy(f,'scale-'+f.name)
for name in ['controls.csv','controls.json','measurements.json','summary.json','workflow-controls.json','validation.json','displacement-noise.json','TOOL_AUDIT.md']:shutil.copy2(Path('docs/audit')/name,a.out/name)
# Minimal deterministic rendering for this report's Markdown (not a general parser).
def inline(s):
 s=html.escape(s);s=re.sub(r'`([^`]+)`',r'<code>\1</code>',s);s=re.sub(r'\*\*([^*]+)\*\*',r'<strong>\1</strong>',s);return s
lines=Path('docs/audit/TOOL_AUDIT.md').read_text().splitlines();parts=[];i=0
while i<len(lines):
 line=lines[i]
 if not line.strip():i+=1;continue
 if line.startswith('#'):
  n=len(line)-len(line.lstrip('#'));parts.append(f'<h{n}>{inline(line[n:].strip())}</h{n}>');i+=1
 elif line.startswith('|'):
  rows=[]
  while i<len(lines) and lines[i].startswith('|'):
   cells=[c.strip() for c in lines[i].strip('|').split('|')];i+=1
   if all(re.fullmatch(r'[- :]+',c) for c in cells):continue
   tag='th' if not rows else 'td';rows.append('<tr>'+''.join(f'<{tag}>{inline(c)}</{tag}>' for c in cells)+'</tr>')
  parts.append('<div class="table-scroll"><table>'+''.join(rows)+'</table></div>')
 elif line.startswith('- ') or re.match(r'^\d+\. ',line):
  numbered=bool(re.match(r'^\d+\. ',line));tag='ol' if numbered else 'ul';items=[]
  while i<len(lines) and (re.match(r'^\d+\. ',lines[i]) if numbered else lines[i].startswith('- ')):
   text=re.sub(r'^\d+\. ','',lines[i]) if numbered else lines[i][2:];items.append('<li>'+inline(text)+'</li>');i+=1
  parts.append(f'<{tag}>'+''.join(items)+f'</{tag}>')
 else:
  para=[]
  while i<len(lines) and lines[i].strip() and not lines[i].startswith(('#','|','- ')) and not re.match(r'^\d+\. ',lines[i]):para.append(lines[i]);i+=1
  parts.append('<p>'+inline(' '.join(para))+'</p>')
repairhtml=''.join('<details class="repair"><summary>'+html.escape(f['key'])+'</summary><div class="four">'+''.join('<figure><figcaption>'+x['label']+'</figcaption><a href="'+x['src']+'"><img loading="lazy" src="'+x['src']+'"></a></figure>' for x in f['images'])+'</div></details>' for f in fixes)
featureRows=''.join('<tr><td>'+str(r['units'])+'×'+str(r['units'])+' '+r['region']+'</td><td>'+f"{statistics.median(t['beforeMs'] for t in r['trials']):.1f}"+'</td><td>'+f"{statistics.median(t['afterMs'] for t in r['trials']):.1f}"+'</td><td>'+str(all(t['identical'] for t in r['trials']))+'</td></tr>' for r in metrics['featurePerformance'])
repeats=metrics['repeatedPerformance'];repeatRows=[]
for name in sorted({r['scene'] for r in repeats}):
 cols=[]
 for key,metric in [('reliefOctaves','captureMs'),('erosionAge','refinementMs')]:
  vals=[statistics.median(r[metric] for r in repeats if r['scene']==name and r['key']==key and r['label']==label and r['iteration']>0) for label in ['default','trial']];cols.extend([f'{v:.1f}' for v in vals])
 repeatRows.append('<tr><td>'+name+'</td>'+''.join('<td>'+c+'</td>' for c in cols)+'</tr>')
worst=max(noise,key=lambda r:r['changedBlocks']);median=statistics.median(r['changedBlocks'] for r in noise)
data=json.dumps(dict(scenes=scenes,controls=ledger,workflow=workflow),separators=(',',':')).replace('</',r'<\/')
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Terraform · tool and pipeline audit</title><style>
:root{color-scheme:dark;font:16px/1.55 system-ui;background:#111a20;color:#dce7e5}*{box-sizing:border-box}body{margin:0}header,main{max-width:1500px;margin:auto;padding:28px 38px}header{border-bottom:1px solid #31434a}h1{font-size:34px;letter-spacing:-.7px;line-height:1.15}h2{margin-top:42px;font-size:25px}h3{font-size:19px}p,li{max-width:105ch}a{color:#9ed8bd}nav{display:flex;gap:20px;flex-wrap:wrap}section{scroll-margin-top:20px}button,input,select{font:inherit;color:inherit;background:#1e2b32;border:1px solid #52676d;border-radius:5px;padding:8px}input[type=search]{width:min(540px,90vw)}label{display:inline-flex;gap:10px;align-items:center;margin:10px 18px 10px 0}.note{color:#a6b8bd}.pill{border:1px solid #54776a;border-radius:8px;padding:12px 18px;background:#1c3029}.three,.two,.four{display:grid;gap:12px}.three{grid-template-columns:repeat(3,1fr)}.two{grid-template-columns:repeat(2,1fr)}.four{grid-template-columns:repeat(4,1fr)}figure{margin:0}figcaption{padding:8px;background:#1b2930}img{width:100%;display:block;aspect-ratio:1;object-fit:contain;image-rendering:auto}#ui img{aspect-ratio:1372/997}summary{cursor:pointer;padding:12px;border-bottom:1px solid #34464d}details{margin:14px 0;background:#17242a;border:1px solid #34464d;border-radius:6px}details .four{padding:10px}table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:10px;vertical-align:top;border-bottom:1px solid #34464d}th{background:#26383f;position:sticky;top:0}code{background:#26343a;padding:1px 4px;border-radius:3px}.table-scroll{overflow:auto;max-height:800px;border:1px solid #34464d}.ledger td:first-child{white-space:nowrap}.ledger td:last-child{min-width:320px}#comparison-label{font-weight:600}#story{max-width:1280px}#story h1{display:none}.overlay{position:relative;aspect-ratio:1;overflow:hidden}.overlay img{position:absolute;inset:0;height:100%;object-fit:contain}#overlay-after{clip-path:inset(0 50% 0 0)}#wipe{width:100%;margin:0}.small{font-size:13px}@media(max-width:850px){header,main{padding:18px}.three,.two,.four{grid-template-columns:1fr}th{position:static}}
</style><header><p class="note">TERRAFORM · ARTIST-DIRECTED PROCEDURAL TERRAIN</p><h1>Tools that earn their place</h1><p>Control audit, exact performance improvements, and a reviewable UI prototype. Baseline c4b1b80 · 31 October 2026.</p><div class="pill"><strong>Review branch only.</strong> 27 default scenes are pixel- and height-identical. Repaired controls now respond. Main has not been merged or pushed.</div><p><a href="http://127.0.0.1:8895/?biome=green&amp;mapX=2&amp;mapY=2&amp;audit=1&amp;auditScene=green-2&amp;scratch=tool-audit-review">Open live prototype</a> · <a href="TOOL_AUDIT.md">Markdown report</a> · <a href="controls.csv">417-parameter CSV</a> · <a href="measurements.json">Raw measurements</a></p><nav><a href="#ui">UI</a><a href="#comparison">Reference sheet</a><a href="#repairs">Repairs</a><a href="#alternatives">Alternatives</a><a href="#ledger">Control ledger</a><a href="#story">Full report</a></nav></header><main>
<section id="ui"><h2>Before / prototype UI</h2><p>Fewer tool buttons, explicit drawing modes, generic feature names, searchable process groups, and fine controls on request. Click images for full size.</p><div class="two"><figure><figcaption>Before</figcaption><a href="ui-before.jpg"><img src="ui-before.jpg"></a></figure><figure><figcaption>Prototype</figcaption><a href="ui-after.jpg"><img src="ui-after.jpg"></a></figure></div></section>
<section id="comparison"><h2>The existing comparison sheet</h2><p>All 27 windows are preserved. The reference is the target, not a new replacement chosen to flatter the result. This pass improves control reliability and cost; it does not close the visible retail gaps.</p><label>Scene <select id="scene"></select></label><p id="comparison-label"></p><div class="three" id="triptych"></div><details><summary>Before / prototype wipe (identical defaults)</summary><div style="max-width:700px;margin:auto"><div class="overlay"><img id="overlay-before"><img id="overlay-after"></div><input aria-label="Before after wipe" id="wipe" type="range" min="0" max="100" value="50"></div></details><p class="note">Full PNGs are linked above each image. Reference fixtures and world variants are unchanged. Default equality is measured from original pixels, not these resized previews.</p></section>
<section id="repairs"><h2>Repaired controls: low and high, before and after</h2><p>Each row uses the same explicit feature fixture and endpoint settings. Before pairs are unchanged for disconnected controls; after pairs show the restored response. Placement-table controls can have a small but real effect.</p>REPAIRS
<details><summary>Ground-source selection</summary><p>Before, different source requests could fall back to the same generated texture. After, sampled and borrowed sources are distinct. Default generated ground remains exact.</p><div class="three">SOURCEIMAGES</div></details></section>
<section id="alternatives"><h2>Cheaper alternatives, with their costs visible</h2><p>The exact dry pass and exact feature-fill changes are implemented. Fewer refinement iterations and fewer relief octaves remain trials. Choose any scene to compare the latter.</p><label>Trial scene <select id="trial-scene"></select></label><div class="three" id="trial-images"></div><p class="note">Noise-detail differences are easier to see at full resolution. A low changed-block percentage is not a target-class fidelity approval.</p><h3>Warm timings, milliseconds</h3><div class="table-scroll"><table><tr><th>Scene</th><th>5 octaves capture</th><th>3 octaves capture</th><th>200 iterations refinement</th><th>16 iterations refinement</th></tr>REPEATS</table></div><h3>Feature placement, milliseconds</h3><table><tr><th>Case</th><th>Before</th><th>Prototype</th><th>Identical</th></tr>FEATURES</table><h3>Shared profile replacement trial</h3><p>Best fit still changes silhouette. Plateau RMS 6.40 / max 13.59; rounded ridge RMS 17.52 / max 32.06 height units. Keep the classic constructions.</p><div class="four">PROFILES</div><p class="note">Alignment sensitivity: shifting unchanged rendered images by 2 px horizontally and 1 px vertically changes a median NOISEMED% of coarse blocks (maximum NOISEMAX%, NOISESCENE). This is a noise-floor illustration, not a fidelity threshold.</p></section>
<section id="ledger"><h2>Every parameter, with evidence and a decision</h2><p>417 default parameters, plus WORKFLOWCOUNT workflow/control records. “Primary” is a proposed UI tier. Positive sensitivity proves an effect, not an approved improvement. Internal parameters with source-only evidence are identified.</p><label>Search <input id="control-search" type="search" placeholder="Name, key, group, feature or decision"></label><label>Domain <select id="domain"><option value="">All domains</option><option>World</option><option>Shape</option><option>Internal / compatibility</option></select></label><p id="control-count"></p><div class="table-scroll"><table class="ledger"><thead><tr><th>Key / label</th><th>Group / decision</th><th>Measured impact</th><th>Reference / rationale / limits</th></tr></thead><tbody id="control-rows"></tbody></table></div><details><summary>Editing, brush basics, placement, view, graphics, documents and export</summary><div class="table-scroll"><table><thead><tr><th>Control</th><th>Purpose / decision</th><th>Evidence / limits</th></tr></thead><tbody id="workflow-rows"></tbody></table></div></details></section>
<section id="story">STORY</section><p class="note">Generated from local audit evidence. Retail assets remain outside Git. Full 40×40 export and in-game behavior are not qualified by this report.</p></main><script type="application/json" id="data">DATA</script><script>
const data=JSON.parse(document.getElementById('data').textContent),$=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
for(const id of ['scene','trial-scene'])$(id).innerHTML=data.scenes.map(s=>`<option>${esc(s.name)}</option>`).join('');
const figure=(src,label)=>`<figure><figcaption><a href="${esc(src)}">${esc(label)} ↗</a></figcaption><a href="${esc(src)}"><img loading="lazy" src="${esc(src)}"></a></figure>`;
function scene(){const s=data.scenes.find(s=>s.name===$('scene').value);$('comparison-label').textContent=s.name+' · '+s.referenceLabel+' · max pixel delta 0 · max sampled height delta 0';$('triptych').innerHTML=figure(s.retail,s.referenceLabel)+figure(s.before,'Before')+figure(s.after,'Prototype');$('overlay-before').src=s.before;$('overlay-after').src=s.after;}function trial(){const n=$('trial-scene').value;$('trial-images').innerHTML=[['default','Current final quality'],['relax16','Trial: 16 iterations'],['relief3','Trial: 3 relief octaves']].map(([k,t])=>figure(`media/perf-${n}-${k}.png`,t)).join('');}
$('scene').onchange=scene;$('trial-scene').onchange=trial;$('wipe').oninput=()=>{$('overlay-after').style.clipPath=`inset(0 ${100-Number($('wipe').value)}% 0 0)`;};$('trial-scene').value='ice-1';scene();trial();
function controls(){const q=$('control-search').value.toLowerCase(),domain=$('domain').value,rows=data.controls.filter(r=>(!domain||r.domain===domain)&&JSON.stringify(r).toLowerCase().includes(q));$('control-count').textContent=rows.length+' / '+data.controls.length+' parameters';$('control-rows').innerHTML=rows.map(r=>`<tr><td><code>${esc(r.key)}</code><br>${esc(r.label)}<br><span class="note">${esc(r.range)}</span></td><td>${esc(r.domain)} · ${esc(r.group)}<br><strong>${esc(r.decision)}</strong></td><td>${r.maxReferenceBlocksPct!==''?esc(r.maxReferenceBlocksPct)+'% reference blocks<br>':''}${r.maxOperatingBlocksPct!==''?esc(r.maxOperatingBlocksPct)+'% operating blocks<br>':''}${r.maxPixelDelta!==''?'Max RGB '+esc(r.maxPixelDelta)+'<br>':''}${r.fieldMax!==''?'Max field delta '+esc(r.fieldMax)+'<br>':''}${r.heightMax!==''?'Max height delta '+esc(r.heightMax)+'<br>':''}${r.referenceCases} ${r.domain==='Shape'?'field cases':'reference windows'} / ${r.diagnosticCases} conditional cases</td><td>${esc(r.purpose)}<br><span class="note">${esc(r.note)}<br>Experiment rows: ${esc(r.provenance)}</span></td></tr>`).join('');}
$('control-search').oninput=controls;$('domain').onchange=controls;controls();$('workflow-rows').innerHTML=data.workflow.map(r=>`<tr><td>${esc(r.key)}<br><span class="note">${esc(r.group)}</span></td><td>${esc(r.purpose)}<br><strong>${esc(r.decision)}</strong></td><td>${esc(r.evidence)}<br><span class="note">${esc(r.limitation)}</span></td></tr>`).join('');
</script></html>'''
sourceimages=''.join('<figure><figcaption>'+phase+' · '+label+'</figcaption><a href="media/source-'+phase+'-'+key+'.png"><img loading="lazy" src="media/source-'+phase+'-'+key+'.png"></a></figure>' for phase in ['before','after'] for key,label in [('default','default'),('ground','sampled'),('groundPattern','borrowed')])
profiles=''.join('<figure><figcaption>'+kind+' · '+mode+'</figcaption><a href="media/profile-'+kind+'-'+mode+'.png"><img loading="lazy" src="media/profile-'+kind+'-'+mode+'.png"></a></figure>' for kind in ['plateau','hill'] for mode in ['classic','shared'])
for key,value in {'REPAIRS':repairhtml,'REPEATS':''.join(repeatRows),'FEATURES':featureRows,'PROFILES':profiles,'SOURCEIMAGES':sourceimages,'NOISEMED':f'{median*100:.2f}','NOISEMAX':f"{worst['changedBlocks']*100:.2f}",'NOISESCENE':worst['scene'],'WORKFLOWCOUNT':str(len(workflow)),'STORY':''.join(parts),'DATA':data}.items():page=page.replace(key,value)
(a.out/'report.html').write_text(page)
print(json.dumps({'report':str(a.out/'report.html'),'scenes':len(scenes),'parameters':len(ledger),'workflowRecords':len(workflow),'noiseMedian':median,'noiseMax':worst,'mediaFiles':len(list(media.iterdir()))},indent=2))
