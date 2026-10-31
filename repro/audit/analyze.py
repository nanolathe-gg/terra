"""Build a machine-readable control ledger from actual registries and GPU results.
Run with the project's Python environment; media stay in the local audit folder.
"""
import argparse,csv,json,re
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path('/private/tmp/terraform-tool-audit'));p.add_argument('--out',type=Path,default=Path('docs/audit'));a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
def read(p,default=None):return json.loads(p.read_text()) if p.exists() else default
inv=read(a.root/'inventory.json');defaults=read(a.root/'defaults.json');before=a.root/'results/before/baseline';after=a.root/'results/after/prototype'
world=[r for f in sorted(before.glob('world-*.json')) for r in read(f,[])];diag=[dict(r,phase=phase) for phase,folder in [('before',before),('after',after)] for f in sorted(folder.glob('diagnostic-*.json')) for r in read(f,[])];shapes=read(before/'shape-controls.json',[]);reg=read(after/'regressions.json',{});experiments=Path('EXPERIMENTS.md').read_text().splitlines();schema=Path('sculpt-control-schema.js').read_text();primary=set(re.findall(r"'([^']+)'",schema.split('export const WORLD_PRIMARY_CONTROLS=new Set([')[1].split(']);')[0]));retired={'sandReach','windStrength','sandPatchy','sandTail'};fixed={'frostGaps','frostGapReach','frostGapSize','frostGapDepth','mineralDetail','faceEdge','gullyRock','strataSpacing'}
presentation={r['key']:r for r in read(a.root/'presentation.json',[])}
internal=[r for f in sorted(after.glob('internal-*.json')) for r in read(f,[])]
surface=[r for f in sorted(after.glob('surface-*.json')) for r in read(f,[])]
intent={
 'Ground':('Reusable plain tiles and rolling dry ground','all'), 'Relief':('Grain, folds and lumps read at TA camera scale','green,lava,moon'), 'Light':('Readable painted faces and cast shadows','all'), 'Faces':('Vegetation/rock placement and slope finish','green,archipelago,moon'),
 'Shine':('Glints and rough reflective material','crystal,ice'), 'Boulders':('Stones and vegetation-coloured caps','green,desert'), 'Debris':('Loose stone near cliff feet','green,desert'), 'Sand':('Sand cover, deposit tint and ripple grain','desert,archipelago'),
 'Cracks':('Fractured faces, hairlines and broken blocks','green,red,crystal'), 'Rock structure':('Beds, joints and ledges on exposed faces','green,red,desert'), 'Contour bands':('Tonal terraces and drawn contour lines','archipelago,lava'), 'Strata':('Coloured bands through raised forms','desert'),
 'Water':('Shelf depth colours, waterline, shallow bed and banks','all'), 'Palette':('TA palette and controlled quantization','all'), 'Desert foot band':('Pale/grey ribbon around raised feet','desert'), 'Desert caps':('Uniform pale cap above coloured beds','desert'),
 'Rock face':('Material contrast and face structure','green,red,desert'), 'Shallow water':('Lit, mottled, cracked and grainy shallow beds','green,red,archipelago'), 'Fringe':('Repeated drifting outline margins','archipelago'),
 'Lava hill':('Pillows, chips, creases and hanging veins','lava'), 'Lava banks':('Dark creases beneath terrace steps','lava'), 'Pockmarks':('Small pits across raised ground','moon'), 'Moon surface':('Cups, ribs and folds on steep forms','moon'),
 'Ice mountains':('Slate, straight fibres and cap lumps','ice,crystal'), 'Ice blocks':('Soft lighting, snow caps and hatched aprons','ice'), 'Ice frost':('Needle shore bands and low pockets','ice')}
def purpose(group):
 for prefix,value in intent.items():
  if group.startswith(prefix):return value
 return ('Material finish or authored terrain feature','all')
def provenance(key):
 rows=[]
 for line in experiments:
  if re.search(r'\b'+re.escape(key)+r'\b',line):
   m=re.match(r'\|\s*(\d+)\s*\|',line)
   if m:rows.append(m.group(1))
 return ', '.join(rows[-5:]) or 'No exact-key ledger entry; family rationale only'
ledger=[]
for group,ls in inv['knobs']:
 for key,label,lo,hi,step,*_ in ls:
  rr=[r for r in world if r['key']==key];dd=[r for r in diag if r['key']==key];mx=max([r['maxRGB'] for r in rr+dd]or[0]);blocks=max([r['changedBlocks'] for r in rr]or[0]);oper=max([r['operatingRange']['changedBlocks'] for r in dd]or[0]);decision='Primary' if key in primary else 'Fine tuning'
  note='Inherited feature; positive sensitivity proves output impact, not improved retail fidelity.'
  if key in retired:decision='Retire';note='No runtime consumer after transport removal; zero pixels across all three retail-shape fixtures. Compatibility defaults retained.'
  elif key=='crevice':decision='Park / hidden';note='Experiment 4 left this off: darkens broad faces rather than drawing useful crevices. Do not promote without a new target comparison.'
  elif key in fixed:note='Repaired live wiring. Compare the diagnostic before/after evidence; default renders remain identical.'
  elif mx==0:decision='Investigate / hide until qualified';note='No rendered impact in tested contexts. Do not infer global death from an inactive dependency or absent material.'
  elif blocks<.05:note='Small or conditional whole-window impact. Inspect target region and nonzero operating range before promoting or removing.'
  pp,refs=purpose(group)
  ledger.append(dict(domain='World',key=key,label=presentation.get(key,{}).get('label',label),group=presentation.get(key,{}).get('group',group),range=f'{lo}..{hi}',decision=decision,reference=refs,purpose=pp,referenceCases=len(rr),maxReferenceBlocksPct=round(blocks*100,3),maxPixelDelta=mx,diagnosticCases=len(dd),maxOperatingBlocksPct=round(oper*100,3) if dd else '',heightMax='',fieldMax='',nonfinite='',provenance=provenance(key),note=note))
for f in inv['shapes']:
 key,_,label,kinds,lo,hi,step,scale,help,*_=f;rr=[r for r in shapes if r['key']==key];dd=[r for r in reg.get('conditional',[]) if r['key']==key];mx=max([r['max'] for r in rr+dd]or[0]);zeros=[r['kind'] for r in rr if r['max']==0]
 note='Synthetic GPU field fixture; not an isolated retail fidelity test. '+help
 if zeros:note+=' Initial zero cases: '+', '.join(zeros)+'. '+('Retested on submerged negative offset; all shoreline controls respond.' if key not in ['baseVary','baseBump','iceFacetSize'] else 'UI now restricts the inactive context; custom-profile foot effects remain available.')
 ledger.append(dict(domain='Shape',key=key,label=presentation.get(key,{}).get('label',label),group=', '.join(kinds),range=f'{lo/scale:g}..{hi/scale:g}',decision='Conditional / contextual' if zeros else 'Retain',reference='',purpose=help,referenceCases=len(rr),maxReferenceBlocksPct='',maxPixelDelta='',diagnosticCases=len(dd),maxOperatingBlocksPct='',heightMax=max([r['heightMax'] for r in rr+dd]or[0]),fieldMax=mx,nonfinite=sum(r['nonfinite'] for r in rr+dd),provenance=provenance(key),note=note))
for key in sorted(set(defaults['defaults'])-{r['key'] for r in ledger}):
 rr=[r for r in internal if r['key']==key]
 if key=='fringeStyle':rr=[r for r in surface if r['key']=='fringe-style']
 if key=='groundPattern':rr=[r for r in read(after/'ground-source.json',[]) if r['key']==key]
 ledger.append(dict(domain='Internal / compatibility',key=key,label=key,group='Preset or implementation parameter',range=str(defaults['defaults'][key]),decision='Retire inactive selector' if key=='fringeStyle' else 'Keep in ground-source selector' if key=='groundPattern' else 'Keep out of primary UI; qualify before exposure',reference='',purpose='See exact-key experiment provenance and pipeline source.',referenceCases=0,maxReferenceBlocksPct='',maxPixelDelta=max([r['maxRGB'] for r in rr]or[0]) if rr else '',diagnosticCases=len(rr),maxOperatingBlocksPct='',heightMax='',fieldMax='',nonfinite='',provenance=provenance(key),note=('No pixels changed; the shared renderer uses one bridged fringe layer. Selector hidden, compatibility value retained.' if key=='fringeStyle' else 'Repaired requested texture-source selection; default generated ground remains exact.' if key=='groundPattern' else 'Measured on an explicit feature fixture. Positive output sensitivity does not establish retail improvement.' if rr else 'Ground texture source selection is inspected in source and reference renders; no isolated runtime sweep.')))
(a.out/'controls.json').write_text(json.dumps(ledger,indent=2)+'\n')
with (a.out/'controls.csv').open('w',newline='') as f:w=csv.DictWriter(f,fieldnames=ledger[0].keys(),lineterminator='\n');w.writeheader();w.writerows(ledger)
# Metrics contain no retail pixels and can be kept with the review branch.
metrics={'world':world,'diagnostic':diag,'shape':shapes,'regressions':reg,'comparison':read(a.root/'comparison.json',[]),'performance':[r for f in after.glob('performance-*.json') for r in read(f,[])],'scale':{f.stem:read(f) for f in after.glob('scale-*.json')},'features':read(after/'feature-controls.json',[]),'internal':internal,'surface':surface,'featurePerformance':read(after/'feature-performance.json',[]),'featureRegressions':read(after/'feature-regressions.json',[]),'groundSource':{phase:read(folder/'ground-source.json',[]) for phase,folder in [('before',before),('after',after)]},'profiles':read(after/'profiles.json',[]),'repeatedPerformance':[r for f in sorted(after.glob('repeat-*.json')) for r in read(f,[])]}
(a.out/'measurements.json').write_text(json.dumps(metrics,separators=(',',':'))+'\n')
summary={'registeredWorldControls':len({r['key'] for r in world}),'worldReferenceMeasurements':len(world),'registeredShapeControls':len(inv['shapes']),'shapeToolMeasurements':len(shapes),'diagnosticMeasurements':len(diag),'primaryWorldControls':len(primary),'retiredControls':len(retired),'parkedWorldControls':1,'worldInspectorControls':243,'graphicsPaletteControls':3,'worldWithExactZeroInAllReferenceWindows':[f[0] for _,ls in inv['knobs'] for f in ls if all(r['maxRGB']==0 for r in world if r['key']==f[0])],'worldStillUnmeasuredInOutput':[r['key'] for r in ledger if r['domain']=='World' and r['maxPixelDelta']==0],'allDefaults':len(defaults['defaults']),'internalMeasurements':len(internal),'surfaceMeasurements':len(surface),'hiddenDefaults':sum(r['domain']=='Internal / compatibility' for r in ledger)}
(a.out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
