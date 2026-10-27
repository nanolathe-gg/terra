"""Bounded native rock appearance layers; no recovered geology/height claim.

These materials preserve native shard shading and moss. The parent owns shape,
grass survival masks and any authored talus placement. All outputs stay external.
"""

import argparse
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter

from sculpt_slope_material import DEFAULT_DATA, LUMA, digest, quilt, save


RECIPES={
    'weathered':{'sources':['green18','green19','green25','green44','green50','green51','green55','green63','green70'],
                 'patch':40,'overlap':16,'seed':334901},
    'fractured':{'sources':['green05','green14','green18','green25','green26','green27','green29',
                             'green40','green44','green49','green50','green51','green54','green55',
                             'green58','green59','green63','green69','green70'],
                 'patch':28,'overlap':12,'seed':334902},
}


def collect(data,style,recipe):
    palette_path=data/'editor-green-sections/palette.pal'
    palette=np.fromfile(palette_path,np.uint8).reshape(256,4)[:,:3]
    originals=[];pool=[];records=[];sources=[];references={}
    k=recipe['patch']
    for name in recipe['sources']:
        directory=data/'editor-green-decoded/greenworld/hills'/name
        metadata=json.loads((directory/'metadata.json').read_text())
        indices=np.fromfile(directory/'indexed.bin',np.uint8).reshape(metadata['height'],metadata['width'])
        rgb=palette[indices].astype(np.float32);references[name]=rgb
        broad=gaussian_filter(rgb,(1.5,1.5,0));lum=rgb@LUMA
        green=broad[...,1]-broad[...,0]>12
        rock=broad[...,1]-broad[...,0]<9
        mid=gaussian_filter(lum,1)-gaussian_filter(lum,8)
        candidates=[]
        for y in range(16,rgb.shape[0]-k-15,4):
            for x in range(16,rgb.shape[1]-k-15,4):
                sl=np.s_[y:y+k,x:x+k];r=rock[sl];l=lum[sl]
                rf=float(r.mean());gf=float(green[sl].mean());black=float((l<10).mean())
                mean=float(l.mean());detail=float(mid[sl].std())
                sides=float(min(r[:4].mean(),r[-4:].mean(),r[:,:4].mean(),r[:,-4:].mean()))
                if style=='weathered':
                    safe=.38<rf<.8 and .15<gf<.55 and black<.035 and 45<mean<85 and sides>.18
                    # Favour mixed moss/mineral interiors rather than a grass
                    # region with a single exposed rock at its outer boundary.
                    score=detail-20*abs(rf-.6)
                else:
                    safe=rf>.82 and gf<.15 and black<.12 and 38<mean<83 and sides>.65
                    score=detail+4*rf
                if not safe or detail<3:
                    continue
                candidates.append({'section':name,'xy':[x,y],'size':k,'rock_fraction':rf,
                                   'green_fraction':gf,'near_black_fraction':black,
                                   'side_rock_min':sides,'mean_luminance':mean,
                                   'midband_rms':detail,'score':score})
        candidates.sort(key=lambda r:(-r['score'],r['xy'][1],r['xy'][0]))
        selected=[]
        for record in candidates:
            x,y=record['xy']
            if any(np.hypot(x-r['xy'][0],y-r['xy'][1])<k*.55 for r in selected):
                continue
            selected.append(record)
            if len(selected)==10:
                break
        for record in selected:
            x,y=record['xy'];raw=rgb[y:y+k,x:x+k].copy()
            # Preserve all within-shard contrast, hue and cracks. Only modest
            # scalar patch tone matching limits conspicuous lighting blocks.
            target=63 if style=='weathered' else 58.75
            factor=float(np.clip(target/record['mean_luminance'],.9,1.2))
            record['luminance_factor']=factor
            originals.append(raw);pool.append(np.clip(raw*factor,0,255));records.append(record)
        sources.append({'directory':str(directory),'section':name,
                        'indexed_sha256':digest(directory/'indexed.bin'),
                        'metadata_sha256':digest(directory/'metadata.json'),
                        'eligible_count':len(candidates),'selected_count':len(selected)})
    return np.asarray(pool),originals,records,sources,references,digest(palette_path)


def make_rock_layers(data:Path,out:Path)->dict:
    start=time.perf_counter();data=Path(data);out=Path(out);out.mkdir(parents=True,exist_ok=True)
    result={};reports={};visuals={};native={}
    for style,recipe in RECIPES.items():
        pool,originals,records,sources,references,palette_hash=collect(data,style,recipe)
        if len(pool)<12:
            reports[style]={'omitted':'fewer than 12 safe native interior patches','sources':sources}
            continue
        tile,placements=quilt(pool,size=256,patch=recipe['patch'],overlap=recipe['overlap'],seed=recipe['seed'])
        path=out/('rock-'+style+'.png');save(path,tile)
        actual=np.asarray(Image.open(path));save(out/('rock-'+style+'-repeat.png'),np.tile(actual,(2,2,1)))
        result[style]={'path':str(path),'meanRGB':actual.mean(axis=(0,1)).tolist(),
                       'sha256':digest(path),'size':[256,256],'nativePatchCount':len(records)}
        reports[style]={'result':result[style],'recipe':recipe,'sources':sources,
                        'native_patches':records,'quilt':placements,'palette_sha256':palette_hash,
                        'tone_match':{'target_luminance':63 if style=='weathered' else 58.75,
                                      'scalar_clamp':[.9,1.2],'within_patch_contrast_gain':1}}
        visuals[style]=(actual,originals);native.update(references)
    # No discrete loose-stone ground interior was established in the inspected
    # sections. A complete cliff foot would bake a feature into the material.
    reports['debris']={'omitted':'No safe native loose-stone/talus interior established; flat01/02/03 are grass, inspected WretchedRidges foot meets grass directly.',
                       'policy':'Do not substitute complete cliff feet, shrink shards, or manufacture high-frequency stone noise.'}
    contact=Image.new('RGB',(1280,856),(24,26,24));draw=ImageDraw.Draw(contact)
    for i,name in enumerate(['green18','green25','green44','green50','green51']):
        if name in native:
            contact.paste(Image.fromarray(native[name][:256,:256].astype(np.uint8)),(i*256,24))
            draw.text((i*256+4,5),name+' native reference',fill='white')
    for i,(style,(actual,originals)) in enumerate(visuals.items()):
        y=304+i*272
        contact.paste(Image.fromarray(actual),(0,y+20));draw.text((4,y),style+' output; native scale',fill='white')
        draw.text((276,y),'selected native interiors before tone match',fill='white')
        k=RECIPES[style]['patch']
        for j,patch in enumerate(originals):
            x=272+(j%20)*48;py=y+20+(j//20)*48
            contact.paste(Image.fromarray(patch.astype(np.uint8)),(x,py))
    contact_path=out/'rock-layers-contact.png';contact.save(contact_path)
    result['contactPath']=str(contact_path);result['provenancePath']=str(out/'rock-layers.json')
    provenance={'materials':reports,'outputs':result,'generation_seconds':time.perf_counter()-start,
                'reference_inspection':{'hill_catalog':'editor-green-decoded/greenworld/hills',
                                        'flat_sections':['greenflat01','greenflat02','greenflat03'],
                                        'map':'corpus/wretched_ridges-7f55816d','native_crop_xywh':[1760,2080,512,512],
                                        'map_crop_use':'visual reference only; no pixels enter these materials'},
                'limits':['Appearance proxy, not recovered retail authoring, physical albedo or height.',
                          'Baked directional microshading and partial moss/edge structure remain.',
                          'No rotations, reflection, scaling, generated detail, recolour or contrast amplification.',
                          'Quilting can repeat shard groups; geometry and spatial material masks remain parent-owned.',
                          'Weathered is observed moss/mineral mixture, not a recovered weathering or grass-survival rule.']}
    (out/'rock-layers.json').write_text(json.dumps(provenance,indent=2)+'\n')
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data',type=Path,default=DEFAULT_DATA)
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    print(json.dumps(make_rock_layers(args.data,args.out),indent=2))
