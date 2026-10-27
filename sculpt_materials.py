"""Bounded Green Planet material proxies for the sculpting prototype.

Native image residuals are appearance proxies, not recovered albedo, normals
or fine geometry. Generated noise and all material curves are authored choices.
Run once at asset preparation, never on an individual brush stroke.
"""

import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter, distance_transform_edt
from scipy.spatial import cKDTree, Delaunay


DEFAULT_DATA=Path('/private/tmp/nanolathe-neural-terrain')
SEED=64178243


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path,array):
    Image.fromarray(np.rint(array).clip(0,255).astype(np.uint8)).save(path)


def map_crop(data,name,xywh):
    directory=data/'corpus'/name
    metadata=json.loads((directory/'metadata.json').read_text())
    indexed=np.memmap(directory/'map-indexed.bin',np.uint8,mode='r',
                      shape=(metadata['height'],metadata['width']))
    palette=np.fromfile(directory/'palette-rgb.bin',np.uint8).reshape(256,3)
    x,y,w,h=xywh
    crop=palette[indexed[y:y+h,x:x+w]].copy()
    return crop,{'directory':str(directory),'metadata':metadata,'crop_xywh':xywh,
                 'crop_rgb_sha256':hashlib.sha256(crop.tobytes()).hexdigest(),
                 'palette_sha256':digest(directory/'palette-rgb.bin')}


def seam(cost):
    height,width=cost.shape
    acc=cost[0].copy();parents=np.zeros(cost.shape,np.int8)
    for y in range(1,height):
        options=np.stack((np.r_[np.inf,acc[:-1]],acc,np.r_[acc[1:],np.inf]))
        choice=options.argmin(axis=0)
        parents[y]=choice-1
        acc=cost[y]+options[choice,np.arange(width)]
    path=np.empty(height,int);path[-1]=acc.argmin()
    for y in range(height-1,0,-1):
        path[y-1]=path[y]+parents[y,path[y]]
    return path


def periodic_edges(image,width=12):
    """Constrain paired edge pixels; only a narrow proxy border is changed."""
    image=image.copy()
    for axis in (0,1):
        a=np.swapaxes(image,axis,0)
        for i in range(width):
            weight=(1-i/width)**2
            common=(a[i]+a[-1-i])/2
            a[i]=a[i]*(1-weight)+common*weight
            a[-1-i]=a[-1-i]*(1-weight)+common*weight
    return image


ROCK_STYLES=('restrained','structural')


def rock_proxy(source,origin,style='restrained'):
    if style not in ROCK_STYLES:
        raise ValueError('unknown rock style: '+style)
    structural=style=='structural'
    raw=source.astype(np.float32)
    # Reject whole black clefts, moss clumps and broadly lit/shaded regions
    # before extracting residuals. No black shadow is promoted into albedo.
    broad_sigma=32 if structural else 6
    residual=raw-gaussian_filter(raw,(broad_sigma,broad_sigma,0))
    candidates=[];patches=[];originals=[]
    size,overlap=(64,24) if structural else (24,8)
    for y in range(0,source.shape[0]-size+1,8):
        for x in range(0,source.shape[1]-size+1,8):
            patch=raw[y:y+size,x:x+size]
            excess=patch[...,1]-np.maximum(patch[...,0],patch[...,2])
            luma=patch.mean(axis=2)
            if structural:
                gray=((excess<16)&(excess>-16)).mean()
                black=(luma<12).mean();green=(excess>18).mean()
                if gray<=.67 or black>=.035 or green>=.23 or not 32<luma.mean()<130:
                    continue
            else:
                gray=((excess<12)&(excess>-14)).mean()
                black=(luma<14).mean();green=(excess>18).mean()
                if gray<=.8 or black>=.02 or green>=.08 or not 35<luma.mean()<120:
                    continue
            detail=residual[y:y+size,x:x+size].copy()
            detail-=detail.mean(axis=(0,1))
            luminance=detail@np.array([.299,.587,.114],np.float32)
            # Structural mode retains mineral plates/fractures and some moss
            # colour. It removes only broad light, so its baked-light risk is
            # explicitly higher than the restrained fine-grain proxy.
            if structural:
                detail=.95*luminance[...,None]+.55*(detail-luminance[...,None])
                detail=np.clip(detail,-55,55)
            else:
                detail=.55*luminance[...,None]+.12*(detail-luminance[...,None])
                detail=np.clip(detail,-22,22)
            patches.append(detail+np.array([85,84,79]))
            originals.append(patch)
            candidates.append({'source_xy':[origin[0]+x,origin[1]+y],
                               'size':size,'gray_fraction':float(gray),
                               'black_fraction':float(black),'green_fraction':float(green)})
    if len(patches)<16:
        raise ValueError('too few neutral native mineral patches for the bounded proxy')
    patches=np.asarray(patches)
    rng=np.random.default_rng(SEED+810 if structural else SEED)
    canvas=np.zeros((256+size,256+size,3),float)
    records=[]
    stride=size-overlap
    for y in range(0,256,stride):
        for x in range(0,256,stride):
            error=np.zeros(len(patches))
            if x:
                error+=np.mean((patches[:,:,:overlap]-canvas[y:y+size,x:x+overlap])**2,axis=(1,2,3))
            if y:
                error+=np.mean((patches[:,:overlap]-canvas[y:y+overlap,x:x+size])**2,axis=(1,2,3))
            shortlist=np.argsort(error,kind='stable')[:5] if x or y else np.arange(len(patches))
            selected=int(rng.choice(shortlist));new=patches[selected]
            old=canvas[y:y+size,x:x+size]
            take=np.ones((size,size),bool)
            if x:
                path=seam(np.mean((old[:,:overlap]-new[:,:overlap])**2,axis=2))
                take[:,:overlap]&=np.arange(overlap)[None,:]>=path[:,None]
            if y:
                path=seam(np.mean((old[:overlap]-new[:overlap])**2,axis=2).T)
                take[:overlap]&=np.arange(overlap)[:,None]>=path[None,:]
            old[take]=new[take]
            records.append({'destination_xy':[x,y],'source_patch':selected})
    proxy=periodic_edges(canvas[:256,:256])
    proxy+=np.array([85,84,79])-proxy.mean(axis=(0,1))
    return proxy,candidates,records,originals


def shallow_water_proxy(data,palette):
    """Quilt only native shallow interiors; no coast silhouettes or recolour."""
    size,overlap=32,12
    patches=[];records=[];sources=[]
    for name in ['coast/n_135','coast/b_e01_135']:
        directory=data/'editor-green-decoded/greenworld'/name
        metadata=json.loads((directory/'metadata.json').read_text())
        indexed=np.fromfile(directory/'indexed.bin',np.uint8).reshape(metadata['height'],metadata['width'])
        rgb=palette[indexed].astype(np.float32)
        blue=(rgb[...,2]>rgb[...,1]+40)&(rgb[...,2]>rgb[...,0]+60)
        distance=distance_transform_edt(blue)
        sources.append({'section':name,'metadata':metadata,
                        'indexed_sha256':digest(directory/'indexed.bin')})
        for y in range(0,rgb.shape[0]-size+1,8):
            for x in range(0,rgb.shape[1]-size+1,8):
                patch=rgb[y:y+size,x:x+size]
                mean=patch.mean(axis=(0,1))
                separation=float(distance[y:y+size,x:x+size].min())
                if separation<12 or not (65<mean[0]<100 and 108<mean[1]<145 and mean[2]>240):
                    continue
                patches.append(patch)
                records.append({'source_section':name,'source_xy':[x,y],
                                'size':size,'meanRGB':mean.tolist(),
                                'minimum_distance_from_nonwater':separation})
    if len(patches)<16:
        raise ValueError('no sufficiently broad safe native shallow-water sample pool')
    patches=np.asarray(patches)
    rng=np.random.default_rng(SEED+1717)
    # Extra extent allows cyclic cuts across both pairs of texture borders,
    # while every resulting pixel still comes directly from a native patch.
    canvas=np.zeros((320,320,3),np.float32)
    placements=[]
    for y in range(0,288,size-overlap):
        for x in range(0,288,size-overlap):
            error=np.zeros(len(patches))
            if x:
                error+=np.mean((patches[:,:,:overlap]-canvas[y:y+size,x:x+overlap])**2,axis=(1,2,3))
            if y:
                error+=np.mean((patches[:,:overlap]-canvas[y:y+overlap,x:x+size])**2,axis=(1,2,3))
            shortlist=np.argsort(error,kind='stable')[:6] if x or y else np.arange(len(patches))
            selected=int(rng.choice(shortlist));new=patches[selected]
            old=canvas[y:y+size,x:x+size];take=np.ones((size,size),bool)
            if x:
                path=seam(np.mean((old[:,:overlap]-new[:,:overlap])**2,axis=2))
                take[:,:overlap]&=np.arange(overlap)[None,:]>=path[:,None]
            if y:
                path=seam(np.mean((old[:overlap]-new[:overlap])**2,axis=2).T)
                take[:overlap]&=np.arange(overlap)[:,None]>=path[None,:]
            old[take]=new[take]
            placements.append({'destination_xy':[x,y],'source_patch':selected})
    wrapped=canvas[:288,:288].copy()
    cost=np.mean((wrapped[:,:32]-wrapped[:,256:288])**2,axis=2)
    cost[:,:2]+=1e8;cost[:,-2:]+=1e8
    vertical=seam(cost)
    take=np.arange(32)[None,:]<vertical[:,None]
    wrapped[:,:32]=np.where(take[...,None],wrapped[:,256:288],wrapped[:,:32])
    wrapped=wrapped[:,:256]
    cost=np.mean((wrapped[:32]-wrapped[256:288])**2,axis=2).T
    cost[:,:2]+=1e8;cost[:,-2:]+=1e8
    horizontal=seam(cost)
    take=np.arange(32)[:,None]<horizontal[None,:]
    wrapped[:32]=np.where(take[...,None],wrapped[256:288],wrapped[:32])
    tile=wrapped[:256].copy()
    return tile,patches,{'sources':sources,'patchSize':size,'overlap':overlap,
                        'patches':records,'placements':placements,
                        'cyclic_vertical_cut':vertical.tolist(),
                        'cyclic_horizontal_cut':horizontal.tolist(),
                        'treatment':'native RGB copies, translations and binary cuts only',
                        'meanRGB':tile.mean(axis=(0,1)).tolist(),
                        'scope':'shallow appearance proxy; source sea levels and depths unknown'}


def normalized(field):
    field=field-field.mean()
    scale=max(float(np.percentile(np.abs(field),99.5)),1e-8)
    return np.clip(.5+.49*field/scale,0,1)


NOISE_VARIANTS=('irregular-planar','ridged-gaussian')


def irregular_planar(size):
    """Periodic linear facets from wholly random sites, not a jittered grid."""
    rng=np.random.default_rng(SEED+293)
    sites=rng.uniform(0,size,(1400,2))
    values=rng.normal(size=len(sites))
    points=np.concatenate([sites+[dx,dy] for dy in (-size,0,size)
                           for dx in (-size,0,size)])
    heights=np.tile(values,9)
    triangles=Delaunay(points)
    yy,xx=np.indices((size,size))
    query=np.column_stack((xx.ravel(),yy.ravel()))
    simplex=triangles.find_simplex(query)
    local=query-triangles.transform[simplex,2]
    bary=np.einsum('nij,nj->ni',triangles.transform[simplex,:2],local)
    weights=np.column_stack((bary,1-bary.sum(axis=1)))
    field=np.sum(heights[triangles.simplices[simplex]]*weights,axis=1)
    return field.reshape(size,size)


def ridged_gaussian(size):
    """A noncellular comparison: absolute multiscale periodic Gaussian fields."""
    rng=np.random.default_rng(SEED+389)
    result=np.zeros((size,size))
    for sigma,weight in [(3,.65),(9,.35)]:
        field=gaussian_filter(rng.normal(size=(size,size)),sigma,mode='wrap')
        field/=max(float(field.std()),1e-8)
        result-=weight*np.abs(field)
    return result


def noise_texture(variant='irregular-planar'):
    if variant not in NOISE_VARIANTS:
        raise ValueError('unknown noise variant: '+variant)
    rng=np.random.default_rng(SEED)
    size=512
    channels=[]
    for sigma in (24,7):
        channels.append(normalized(gaussian_filter(rng.normal(size=(size,size)),sigma,mode='wrap')))
    # Preserve A's existing random-stream position. These legacy sampler draws
    # supply no sites or geometry; B now uses a separate generator above.
    rng.random(3698)
    field=irregular_planar(size) if variant=='irregular-planar' else ridged_gaussian(size)
    channels.append(normalized(field))
    channels.append(normalized(gaussian_filter(rng.normal(size=(size,size)),1,mode='wrap')))
    return np.stack(channels,axis=2)*255


def palette_lut(palette):
    # RGB PNG has no transparency semantics. Exclude exact black to keep the
    # prototype's dark material facets readable after palette quantization.
    usable=np.unique(palette[np.any(palette>0,axis=1)],axis=0)
    y,x=np.indices((32,1024))
    rgb=np.stack((x%32,y,x//32),axis=2)*255/31
    _,nearest=cKDTree(usable.astype(float)).query(rgb.reshape(-1,3))
    return usable[nearest].reshape(32,1024,3)


def prepare_assets(out:Path,data:Path=DEFAULT_DATA,noise_variant='irregular-planar',*,rock_style='restrained')->dict:
    start=time.perf_counter();out=Path(out);data=Path(data);out.mkdir(parents=True,exist_ok=True)
    grass,grass_record=map_crop(data,'cavedog_links_cc-f65e8019',(2080,3168,512,512))
    raw_rock,rock_record=map_crop(data,'wretched_ridges-7f55816d',(1696,1696,736,960))
    rocks={style:rock_proxy(raw_rock,(1696,1696),style) for style in ROCK_STYLES}
    rock,patches,placements,originals=rocks[rock_style]
    directory=data/'editor-green-decoded/greenworld/water/greenwater01'
    water_meta=json.loads((directory/'metadata.json').read_text())
    palette_path=data/'editor-green-sections/palette.pal'
    palette=np.fromfile(palette_path,np.uint8).reshape(256,4)[:,:3]
    water=palette[np.fromfile(directory/'indexed.bin',np.uint8).reshape(water_meta['height'],water_meta['width'])]
    shallow,shallow_patches,shallow_record=shallow_water_proxy(data,palette)
    variants={name:noise_texture(name) for name in NOISE_VARIANTS}
    noise=variants[noise_variant];lut=palette_lut(palette)
    for name,array in [('grass',grass),('rock',rock),('water',water),('water-shallow',shallow),
                       ('noise',noise),('palette-lut',lut)]:
        save(out/(name+'.png'),array)
    water_board=Image.new('RGB',(1024,840),(24,26,24));water_draw=ImageDraw.Draw(water_board)
    for x,label,array in [(0,'native shallow quilt',shallow),(256,'unchanged native deep tile',water)]:
        water_draw.text((x+6,8),label,fill='white')
        water_board.paste(Image.fromarray(np.uint8(array)),(x,28))
    water_draw.text((520,8),'safe native shallow interior patches',fill='white')
    for i,patch in enumerate(shallow_patches[:91]):
        water_board.paste(Image.fromarray(np.uint8(patch)),(520+(i%13)*36,28+(i//13)*36))
    common=shallow.mean(axis=(0,1))
    for x,label,array in [(0,'native shallow repeated, no colour change',shallow),
                           (512,'deep residual at same mean, gain1 (comparison)',water)]:
        water_draw.text((x+6,294),label,fill='white')
        display=np.tile(array,(2,2,1)).astype(float)
        if x:
            display=display-water.mean(axis=(0,1))+common
        water_board.paste(Image.fromarray(np.uint8(np.clip(display,0,255))),(x,316))
    water_board.save(out/'water-material-contact.png')
    rock_board=Image.new('RGB',(1024,840),(24,26,24));rock_draw=ImageDraw.Draw(rock_board)
    for i,(style,(proxy,candidates,_,native)) in enumerate(rocks.items()):
        save(out/('rock-'+style+'.png'),proxy)
        x=i*512
        rock_draw.text((x+6,8),style+' proxy; native256px tile',fill='white')
        rock_board.paste(Image.fromarray(np.uint8(np.clip(proxy,0,255))),(x,28))
        rock_draw.text((x+264,8),'native source patches, unmodified',fill='white')
        source_size=native[0].shape[0]
        limit=(256//(source_size+4))**2
        columns=256//(source_size+4)
        for j,patch in enumerate(native[:limit]):
            rock_board.paste(Image.fromarray(np.uint8(patch)),
                            (x+264+(j%columns)*(source_size+4),28+(j//columns)*(source_size+4)))
        rock_draw.text((x+6,294),'same proxy repeated at native pixel scale',fill='white')
        repeated=np.tile(np.uint8(np.clip(proxy,0,255)),(2,2,1))
        rock_board.paste(Image.fromarray(repeated),(x,316))
    rock_board.save(out/'rock-style-contact.png')
    noise_board=Image.new('RGB',(1024,1080),(24,26,24));noise_draw=ImageDraw.Draw(noise_board)
    for i,(name,array) in enumerate(variants.items()):
        save(out/('noise-'+name+'.png'),array)
        b=array[...,2]/255
        save(out/('noise-'+name+'-B.png'),array[...,2])
        # Same flat slope and parent amplitudes; this is only a local normal
        # diagnostic, not a replacement for the parent's actual clay render.
        yy,xx=np.indices(b.shape)
        height=.6*xx+14*(array[...,1]/255-.5)+5*(b-.5)
        gy,gx=np.gradient(height)
        normals=np.stack((-gx,-gy,np.ones_like(gx)),axis=2)
        normals/=np.linalg.norm(normals,axis=2)[...,None]
        light=np.array([-.65,-.45,1.0]);light/=np.linalg.norm(light)
        shade=np.clip(.25+.75*np.maximum(0,normals@light),0,1)
        gray=np.repeat(np.rint(shade[...,None]*255),3,axis=2)
        save(out/('noise-'+name+'-slope.png'),gray)
        noise_draw.text((i*512+6,8),name+' B height',fill='white')
        noise_board.paste(Image.fromarray(np.uint8(array[...,2])).convert('RGB'),(i*512,28))
        noise_draw.text((i*512+6,548),'same slope:14*G +5*B, normal-only diagnostic',fill='white')
        noise_board.paste(Image.fromarray(gray.astype(np.uint8)),(i*512,568))
    noise_board.save(out/'noise-variants-contact.png')
    config={'biome':'Green planet','rockStyle':rock_style,
            'textures':{k:'/sculpt-assets/'+v+'.png' for k,v in
                        [('grass','grass'),('rock','rock'),('water','water'),('noise','noise'),('palette','palette-lut')]},
            'material':{'rockSlope':1.145,'rockFeather':.43,'rockCurvature':.28,
                        'wetBand':13,'shallowDepth':2,'deepDepth':42,
                        'grassDetail':1.0,'rockDetail':1.0,'waterDetail':1.0,
                        'rockMeanRGB':[85,84,79]},
            'water':{'shallowRGB':[96,138,252],'deepRGB':[38,76,226],
                     'shallowMeanRGB':shallow.mean(axis=(0,1)).tolist(),
                     'meanRGB':water.mean(axis=(0,1)).tolist(),
                     'mean':(water.mean(axis=(0,1))/255).tolist(),
                     'grainRGB':[1.0,1.0,1.0]},
            'noise':{'seed':SEED,'size':512,'scales':[48,14,6,2],
                     'variant':noise_variant,'facetScaleRange':[6,30],
                     'encoding':'RGBA, approximate mean0.5 and amplitude0.5; decode2*x-1',
                     'channels':['broad','mid',noise_variant,'fine']},
            'palette':{'size':32,'imageSize':[1024,32],
                       'layout':'x=rbin+32*bbin, y=gbin; bins round(clamp(rgb,0,1)*31)',
                       'sampling':'nearest; clamp edges','excludedExactBlack':True},
            'curves':{'scope':'artist prototype defaults, not retail formulas',
                      'rockSlope':{'start':.93,'full':1.36},
                      'wetGround':{'heightStart':13,'heightFull':1},
                      'waterDepth':{'shallow':2,'deep':42}}}
    config['textures']['waterShallow']='/sculpt-assets/water-shallow.png'
    # Native-resolution diagnostic; the rock repeat panel exposes patch grids
    # and any surviving broad clefts instead of hiding them in a thumbnail.
    board=Image.new('RGB',(1024,820),(24,26,24));draw=ImageDraw.Draw(board)
    items=[('native grass',grass[:256,:256]),('neutral rock proxy',rock),
           ('native water',water),('noise RGB',noise[:256,:256,:3])]
    for i,(label,array) in enumerate(items):
        draw.text((i*256+6,8),label,fill='white')
        board.paste(Image.fromarray(np.uint8(np.clip(array,0,255))),(i*256,28))
    repeated=np.tile(np.uint8(np.clip(rock,0,255)),(2,2,1))
    draw.text((6,294),'rock proxy repeated at native pixel scale',fill='white');board.paste(Image.fromarray(repeated),(0,314))
    draw.text((520,294),'native rock candidates (before broad-light removal)',fill='white')
    source_size=originals[0].shape[0]
    columns=max(1,480//(source_size+4))
    for i,patch in enumerate(originals[:columns*7]):
        board.paste(Image.fromarray(np.uint8(patch)),
                    (520+(i%columns)*(source_size+4),320+(i//columns)*(source_size+4)))
    board.save(out/'material-contact.png')
    provenance={'config':config,'generation_seconds':time.perf_counter()-start,
                'grass':grass_record,'rock':rock_record,
                'rock_method':{'style':rock_style,
                               'patchSize':64 if rock_style=='structural' else 24,
                               'overlap':24 if rock_style=='structural' else 8,
                               'broadLightGaussianSigma':32 if rock_style=='structural' else 6,
                               'luminanceResidualGain':.95 if rock_style=='structural' else .55,
                               'chromaResidualGain':.55 if rock_style=='structural' else .12,
                               'residualClip':[-55,55] if rock_style=='structural' else [-22,22],
                               'periodicBorderPixels':12,
                               'patches':patches,'placements':placements},
                'rock_variants':{style:{'patches':values[1],'placements':values[2],
                                         'meanRGB':values[0].mean(axis=(0,1)).tolist(),
                                         'minRGB':values[0].min(axis=(0,1)).tolist()}
                                 for style,values in rocks.items()},
                'water':{'metadata':water_meta,'indexed_sha256':digest(directory/'indexed.bin')},
                'water_shallow':shallow_record,
                'palette_sha256':digest(palette_path),
                'output_sha256':{n:digest(out/(n+'.png')) for n in
                                 ['grass','rock','water','water-shallow','noise','palette-lut',
                                  'noise-irregular-planar','noise-ridged-gaussian',
                                  'rock-restrained','rock-structural']},
                'statistics':{'rockMeanRGB':rock.mean(axis=(0,1)).tolist(),
                              'rockMinRGB':rock.min(axis=(0,1)).tolist(),
                              'noiseMeanRGBA':(noise.mean(axis=(0,1))/255).tolist()},
                'limits':['Material proxies are not recovered intrinsic albedo or fine-height maps.',
                          'Structural rock retains8–32px source shading as well as fractures; intrinsic recovery is not established.',
                          'Whole large black voids and broad illumination are rejected/removed, not all directional lighting.',
                          'New meso geometry must come from the common heightfield, not this texture.',
                          'Palette matching uses byte RGB Euclidean distance; no historical quantizer claim.',
                          'All authored curves are Green Planet appearance defaults only.']}
    (out/'materials.json').write_text(json.dumps(provenance,indent=2)+'\n')
    return config


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--data',type=Path,default=DEFAULT_DATA)
    parser.add_argument('--noise-variant',choices=NOISE_VARIANTS,default='irregular-planar')
    parser.add_argument('--rock-style',choices=ROCK_STYLES,default='restrained')
    args=parser.parse_args();start=time.perf_counter()
    print(json.dumps(prepare_assets(args.out,args.data,args.noise_variant,rock_style=args.rock_style),indent=2))
    print('prepared in',round(time.perf_counter()-start,3),'seconds')
