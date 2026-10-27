"""Bounded native grassy-slope appearance material, not recovered albedo.

Small interior patches preserve native moss ribs and tiny stones. Only broad
luminance is compensated; brightness is never interpreted as surface height.
All shapes and shared illumination remain the parent renderer's responsibility.
"""

import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter


DEFAULT_DATA=Path('/private/tmp/nanolathe-neural-terrain')
SEED=771091
PATCH=40
OVERLAP=16
CHOSEN='ribbed'
SOURCES=['green02','green03','green09','green10','green18','green24','green30',
         'green37','green38','green43','green50','green51','green55']
VARIANTS={'balanced':{'broadSigma':24,'contrast':.8},
          'ribbed':{'broadSigma':32,'contrast':1.0}}
LUMA=np.array([.299,.587,.114])


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path,rgb):
    Image.fromarray(np.rint(rgb).clip(0,255).astype(np.uint8)).save(path)


def seam(cost):
    h,w=cost.shape
    acc=cost[0].copy();parent=np.zeros(cost.shape,np.int8)
    for y in range(1,h):
        choices=np.stack((np.r_[np.inf,acc[:-1]],acc,np.r_[acc[1:],np.inf]))
        move=choices.argmin(axis=0)
        parent[y]=move-1
        acc=cost[y]+choices[move,np.arange(w)]
    path=np.empty(h,int);path[-1]=acc.argmin()
    for y in range(h-1,0,-1):
        path[y-1]=path[y]+parent[y,path[y]]
    return path


def collect(data):
    palette_path=data/'editor-green-sections/palette.pal'
    palette=np.fromfile(palette_path,np.uint8).reshape(256,4)[:,:3]
    sources=[];records=[];originals=[]
    variants={name:[] for name in VARIANTS}
    reference=float(np.array([55,93,27])@LUMA)
    for name in SOURCES:
        directory=data/'editor-green-decoded/greenworld/hills'/name
        metadata=json.loads((directory/'metadata.json').read_text())
        indexed=np.fromfile(directory/'indexed.bin',np.uint8).reshape(metadata['height'],metadata['width'])
        rgb=palette[indexed].astype(np.float32)
        lum=rgb@LUMA
        broad=gaussian_filter(rgb,(2,2,0))
        green=broad[...,1]-np.maximum(broad[...,0],broad[...,2])>12
        mid=gaussian_filter(lum,2)-gaussian_filter(lum,12)
        candidates=[]
        for y in range(16,rgb.shape[0]-PATCH-15,8):
            for x in range(16,rgb.shape[1]-PATCH-15,8):
                sl=np.s_[y:y+PATCH,x:x+PATCH]
                fraction=float(green[sl].mean());variation=float(mid[sl].std())
                mean=float(lum[sl].mean());black=float((lum[sl]<10).mean())
                if fraction<.84 or variation<4.5 or not 35<mean<79 or black>=.005:
                    continue
                # Avoid a whole monotonic silhouette crossing the patch. Four
                # subregions must carry texture, not just one large dark edge.
                local=mid[sl]
                quadrants=[local[:20,:20],local[:20,20:],local[20:,:20],local[20:,20:]]
                if min(float(q.std()) for q in quadrants)<1.4:
                    continue
                candidates.append({'section':name,'xy':[x,y],'size':PATCH,
                                   'green_fraction':fraction,'midband_rms':variation,
                                   'raw_mean_luminance':mean,'near_black_fraction':black})
        candidates.sort(key=lambda r:(-r['midband_rms'],r['xy'][1],r['xy'][0]))
        chosen=[]
        for record in candidates:
            x,y=record['xy']
            if any(np.hypot(x-r['xy'][0],y-r['xy'][1])<20 for r in chosen):
                continue
            chosen.append(record)
            if len(chosen)==12:
                break
        corrections={}
        for variant,parameters in VARIANTS.items():
            illumination=gaussian_filter(lum,parameters['broadSigma'])
            factor=np.clip(reference/np.maximum(illumination,18),.65,2.2)
            corrections[variant]=rgb*factor[...,None]
        for record in chosen:
            x,y=record['xy'];sl=np.s_[y:y+PATCH,x:x+PATCH]
            originals.append(rgb[sl].copy());records.append(record)
            for variant,parameters in VARIANTS.items():
                patch=corrections[variant][sl].copy()
                patch*=reference/max(float((patch@LUMA).mean()),1)
                mean=patch.mean(axis=(0,1))
                patch=mean+(patch-mean)*parameters['contrast']
                variants[variant].append(np.clip(patch,0,255))
        sources.append({'section':name,'metadata':metadata,
                        'indexed_sha256':digest(directory/'indexed.bin'),
                        'eligible_patch_count':len(candidates),'selected_patch_count':len(chosen)})
    if len(records)<32:
        raise ValueError('too few safe textured native grassy slope interiors')
    return {name:np.asarray(pool) for name,pool in variants.items()},records,originals,sources,digest(palette_path)


def quilt(patches,size=512,patch=PATCH,overlap=OVERLAP,seed=SEED):
    extent=size+patch
    canvas=np.zeros((extent+patch,extent+patch,3),np.float32)
    rng=np.random.default_rng(seed)
    placements=[]
    for y in range(0,extent,patch-overlap):
        for x in range(0,extent,patch-overlap):
            error=np.zeros(len(patches))
            if x:
                error+=np.mean((patches[:,:,:overlap]-canvas[y:y+patch,x:x+overlap])**2,axis=(1,2,3))
            if y:
                error+=np.mean((patches[:,:overlap]-canvas[y:y+overlap,x:x+patch])**2,axis=(1,2,3))
            shortlist=np.argsort(error,kind='stable')[:6] if x or y else np.arange(len(patches))
            chosen=int(rng.choice(shortlist));new=patches[chosen]
            old=canvas[y:y+patch,x:x+patch];take=np.ones((patch,patch),bool)
            if x:
                cut=seam(np.mean((old[:,:overlap]-new[:,:overlap])**2,axis=2))
                take[:,:overlap]&=np.arange(overlap)[None,:]>=cut[:,None]
            if y:
                cut=seam(np.mean((old[:overlap]-new[:overlap])**2,axis=2).T)
                take[:overlap]&=np.arange(overlap)[:,None]>=cut[None,:]
            old[take]=new[take]
            placements.append({'destination_xy':[x,y],'source_patch':chosen})
    image=canvas[:extent,:extent].copy()
    error=np.mean((image[:,:patch]-image[:,size:])**2,axis=2)
    error[:,:2]+=1e8;error[:,-2:]+=1e8
    vertical=seam(error)
    take=np.arange(patch)[None,:]<vertical[:,None]
    image[:,:patch]=np.where(take[...,None],image[:,size:],image[:,:patch])
    image=image[:,:size]
    error=np.mean((image[:patch]-image[size:])**2,axis=2).T
    error[:,:2]+=1e8;error[:,-2:]+=1e8
    horizontal=seam(error)
    take=np.arange(patch)[:,None]<horizontal[None,:]
    image[:patch]=np.where(take[...,None],image[size:],image[:patch])
    return image[:size],{'placements':placements,'periodic_vertical_cut':vertical.tolist(),
                       'periodic_horizontal_cut':horizontal.tolist()}


def hill_rock(data,out):
    """Appearance-only shard interiors; retain native shading within each shard."""
    palette_path=data/'editor-green-sections/palette.pal'
    palette=np.fromfile(palette_path,np.uint8).reshape(256,4)[:,:3]
    names=['green18','green30','green43','green50','green51','green55']
    patch=28;pool=[];originals=[];records=[];sources=[];native={}
    target=float(np.array([60,60,49])@LUMA)
    for name in names:
        directory=data/'editor-green-decoded/greenworld/hills'/name
        metadata=json.loads((directory/'metadata.json').read_text())
        indexed=np.fromfile(directory/'indexed.bin',np.uint8).reshape(metadata['height'],metadata['width'])
        rgb=palette[indexed].astype(np.float32);native[name]=rgb
        lum=rgb@LUMA;broad=gaussian_filter(rgb,(1,1,0))
        rock=(broad[...,1]-broad[...,0]<10)&(broad[...,0]-broad[...,2]>-3)
        candidates=[]
        for y in range(16,rgb.shape[0]-patch-15,4):
            for x in range(16,rgb.shape[1]-patch-15,4):
                sl=np.s_[y:y+patch,x:x+patch];r=rock[sl];l=lum[sl]
                fraction=float(r.mean());black=float((l<10).mean());mean=float(l.mean())
                # Require rock on every side to reduce complete grass/crest/
                # foot profiles. Partial edges remain a visual-review limit.
                sides=min(r[:3].mean(),r[-3:].mean(),r[:,:3].mean(),r[:,-3:].mean())
                if fraction<.82 or sides<.65 or not 35<mean<83 or black>.15:
                    continue
                variation=float((gaussian_filter(l,1)-gaussian_filter(l,7)).std())
                if variation<4:
                    continue
                candidates.append({'section':name,'xy':[x,y],'size':patch,
                                   'rock_fraction':fraction,'side_rock_min':float(sides),
                                   'near_black_fraction':black,'raw_mean_luminance':mean,
                                   'midband_rms':variation})
        candidates.sort(key=lambda r:(-r['rock_fraction'],-r['midband_rms'],r['xy'][1],r['xy'][0]))
        selected=[]
        for record in candidates:
            x,y=record['xy']
            if any(np.hypot(x-r['xy'][0],y-r['xy'][1])<14 for r in selected):
                continue
            selected.append(record)
            if len(selected)==12:
                break
        for record in selected:
            x,y=record['xy'];raw=rgb[y:y+patch,x:x+patch].copy()
            # A scalar per patch keeps each native shard/crack contrast intact.
            # This is a restrained tone match, not an intrinsic-light recovery.
            factor=float(np.clip(target/record['raw_mean_luminance'],.8,1.45))
            record['luminance_factor']=factor
            originals.append(raw);pool.append(np.clip(raw*factor,0,255));records.append(record)
        sources.append({'section':name,'directory':str(directory),
                        'indexed_sha256':digest(directory/'indexed.bin'),
                        'metadata_sha256':digest(directory/'metadata.json'),
                        'eligible_patch_count':len(candidates),'selected_patch_count':len(selected)})
    if len(pool)<16:
        raise ValueError('too few safe native hill rock interior patches')
    tile,quilt_record=quilt(np.asarray(pool),size=256,patch=patch,overlap=12,seed=SEED+1)
    save(out/'slope-rock.png',tile)
    actual=np.asarray(Image.open(out/'slope-rock.png'))
    save(out/'slope-rock-repeat.png',np.tile(actual,(2,2,1)))
    contact=Image.new('RGB',(1024,600),(24,26,24));draw=ImageDraw.Draw(contact)
    for i,name in enumerate(['green50','green51','green55']):
        contact.paste(Image.fromarray(native[name].astype(np.uint8)),(i*256,28))
        draw.text((i*256+6,8),name+'; source at native scale',fill='white')
        for record in records:
            if record['section']==name:
                x,y=record['xy'];draw.rectangle((i*256+x,y+28,i*256+x+patch-1,y+28+patch-1),outline=(208,126,74))
    contact.paste(Image.fromarray(actual),(768,28));draw.text((774,8),'hill rock quilt; native scale',fill='white')
    draw.text((8,300),'selected native interiors',fill='white')
    draw.text((520,300),'same patches after scalar tone match',fill='white')
    for i,(raw,corrected) in enumerate(zip(originals,pool)):
        x=(i%14)*34;y=324+(i//14)*34
        contact.paste(Image.fromarray(raw.astype(np.uint8)),(x,y))
        contact.paste(Image.fromarray(np.uint8(np.rint(corrected))),(512+x,y))
    contact.save(out/'slope-rock-contact.png')
    result={'rockPath':str(out/'slope-rock.png'),'rockMeanRGB':actual.mean(axis=(0,1)).tolist(),
            'rockSHA256':digest(out/'slope-rock.png'),'rockContactPath':str(out/'slope-rock-contact.png'),
            'rockProvenancePath':str(out/'slope-rock.json')}
    report={'result':result,'sources':sources,'palette_sha256':digest(palette_path),
            'native_patches':records,'quilt':quilt_record,
            'parameters':{'patchSize':patch,'overlap':12,'size':[256,256],'seed':SEED+1,
                          'referenceMeanRGB':[60,60,49],'luminanceFactorClamp':[.8,1.45],
                          'rotation':False,'scaling':False,'generated_detail':False},
            'limits':['Native shard shading and real cracks remain baked; this is not physical albedo.',
                      'Green30/43 can provide no safe interior under these bounded checks.',
                      'Interior screening avoids complete hill profiles in inspected samples; small moss intrusions and partial edges remain.',
                      'Limited source faces mean some shards repeat; broad silhouette and geometry remain renderer-owned.']}
    (out/'slope-rock.json').write_text(json.dumps(report,indent=2)+'\n')
    return result


def make_slope_material(data:Path,out:Path)->dict:
    start=time.perf_counter();data=Path(data);out=Path(out);out.mkdir(parents=True,exist_ok=True)
    pools,patches,originals,sources,palette_hash=collect(data)
    variants={};records={}
    for name,pool in pools.items():
        tile,record=quilt(pool)
        save(out/('slope-grass-'+name+'.png'),tile)
        variants[name]=tile;records[name]=record
    tile=variants[CHOSEN]
    save(out/'slope-grass.png',tile)
    actual=np.asarray(Image.open(out/'slope-grass.png'))
    save(out/'slope-grass-repeat.png',np.tile(actual,(2,2,1)))
    contact=Image.new('RGB',(1536,560),(24,26,24));draw=ImageDraw.Draw(contact)
    for i,(name,image) in enumerate(variants.items()):
        draw.text((i*512+8,8),name+'; native pixel scale',fill='white')
        contact.paste(Image.fromarray(np.uint8(np.rint(image).clip(0,255))),(i*512,28))
    draw.text((1032,8),'selected native slope interiors, before compensation',fill='white')
    for i,patch in enumerate(originals[:132]):
        contact.paste(Image.fromarray(np.uint8(patch)),(1024+(i%11)*44,28+(i//11)*44))
    contact.save(out/'slope-grass-contact.png')
    parameters={'chosen':CHOSEN,'patchSize':PATCH,'overlap':OVERLAP,'seed':SEED,
                'variants':VARIANTS,'referenceMeanRGB':[55,93,27],
                'illuminationFactorClamp':[.65,2.2],
                'selection':'green-dominant40px interiors, midband variation, limited stones/black,20px nonmaximum suppression',
                'geometry':'none; brightness is not interpreted as height'}
    result={'path':str(out/'slope-grass.png'),'meanRGB':actual.mean(axis=(0,1)).tolist(),
            'size':[512,512],'sha256':digest(out/'slope-grass.png'),
            'contactPath':str(out/'slope-grass-contact.png'),
            'provenancePath':str(out/'slope-grass.json'),'parameters':parameters}
    result.update(hill_rock(data,out))
    report={'result':result,'sources':sources,'palette_sha256':palette_hash,
            'native_patches':patches,'quilt_variants':records,
            'generation_seconds':time.perf_counter()-start,
            'output_sha256':{name:digest(out/name) for name in
                             ['slope-grass.png','slope-grass-balanced.png','slope-grass-ribbed.png','slope-rock.png']},
            'limits':['Baked microshading remains; this is not physically recovered albedo.',
                      'Native rib direction and source formations may repeat; no arbitrary geology claim.',
                      'Broad luminance correction does not reconstruct a true material/lighting decomposition.',
                      'Parent must provide the actual geometry, normals, lighting and slope blend.']}
    (out/'slope-grass.json').write_text(json.dumps(report,indent=2)+'\n')
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data',type=Path,default=DEFAULT_DATA)
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    print(json.dumps(make_slope_material(args.data,args.out),indent=2))
