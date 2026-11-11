// Surface-local voxel storage. Every 8x8 column owns only its occupied vertical
// range; two half-float density samples share a word. Positions stay on a global
// lattice so different render partitions evaluate the same solid.
struct VolumeSettings {
    origin:vec2f, step:f32, columnsX:u32,
    columnsY:u32, width:u32, height:u32, capacity:u32,
    low:f32, high:f32, screenY:vec2f,
}
@group(2) @binding(0) var<uniform> vs:VolumeSettings;
@group(2) @binding(1) var<storage,read> vc:array<vec4i>;
@group(2) @binding(2) var<storage,read> vd:array<u32>;
@group(2) @binding(3) var vh:texture_2d<f32>;
@group(2) @binding(4) var vg:texture_2d<f32>;
@group(2) @binding(5) var<storage,read> vb:array<vec4i>;

// The existing Surface relief slider and local relief paint scale the entire
// surface, including displacement and weathering of the volumetric rock.
fn voxelRelief(p:vec2f,slope:f32)->f32 {
    if(u.styleOn==0){return u.detail;}
    let local=textureSampleLevel(masksTex,linearClamp,maskUv(p),1,0.0).g;
    return u.detail*styleScale(styleEdge(p,local,slope));
}
fn voxelAuthored(p:vec2f)->vec4f {
    let q=p/vs.step-.5;let i=vec2i(floor(q))-vec2i(round(vs.origin/vs.step));let f=fract(q);let last=vec2i(i32(vs.width),i32(vs.height))-1;
    let a=clamp(i,vec2i(0),last);let b=clamp(i+1,vec2i(0),last);
    return mix(mix(textureLoad(vh,a,0),textureLoad(vh,vec2i(b.x,a.y),0),f.x),mix(textureLoad(vh,vec2i(a.x,b.y),0),textureLoad(vh,b,0),f.x),f.y);
}
fn voxelGuide(p:vec2f)->vec4f{return textureLoad(vg,clamp(vec2i(floor(p/vs.step))-vec2i(round(vs.origin/vs.step)),vec2i(0),vec2i(i32(vs.width),i32(vs.height))-1),0);}
fn voxelCell(i:vec3i)->f32 {
    let xy=i.xy-vec2i(round(vs.origin/vs.step));
    if(any(xy<vec2i(0))||any(xy>=vec2i(i32(vs.width),i32(vs.height)))){
        let p=(vec3f(i)+.5)*vs.step;let h=voxelAuthored(p.xy);return (p.z-h.x)*max(h.w,.02);
    }
    let c=vc[u32(xy.y/8)*vs.columnsX+u32(xy.x/8)];
    let z=i.z-c.x*8;
    if(z<0||z>=c.y*8){
        // Omitted bricks are outside the surface band or the expanded camera
        // volume. Its neighborhood contains every shadow / wear / normal tap.
        let p=(vec3f(i)+.5)*vs.step;let h=voxelAuthored(p.xy);
        return (p.z-h.x)*max(h.w,.02);
    }
    let index=u32(c.z)*512u+u32(z)*64u+u32(xy.y%8)*8u+u32(xy.x%8);
    let pair=unpack2x16float(vd[index/2u]);return select(pair.x,pair.y,(index&1u)!=0u);
}
fn voxelField(p:vec3f)->f32 {
    let q=p/vs.step-.5;let i=vec3i(floor(q));let f=fract(q);
    return mix(mix(mix(voxelCell(i),voxelCell(i+vec3i(1,0,0)),f.x),mix(voxelCell(i+vec3i(0,1,0)),voxelCell(i+vec3i(1,1,0)),f.x),f.y),mix(mix(voxelCell(i+vec3i(0,0,1)),voxelCell(i+vec3i(1,0,1)),f.x),mix(voxelCell(i+vec3i(0,1,1)),voxelCell(i+vec3i(1,1,1)),f.x),f.y),f.z);
}
fn voxelGradient(p:vec3f)->vec3f {
    let e=vs.step*.75;
    return vec3f(voxelField(p+vec3f(e,0,0))-voxelField(p-vec3f(e,0,0)),voxelField(p+vec3f(0,e,0))-voxelField(p-vec3f(0,e,0)),voxelField(p+vec3f(0,0,e))-voxelField(p-vec3f(0,0,e)))/(2.0*e);
}
fn voxelNormal(p:vec3f)->vec3f {
    let g=voxelGradient(p);return select(vec3f(0,0,1),normalize(g),dot(g,g)>1e-12);
}
fn voxelRockHeight(p:vec3f,painted:f32)->f32 {
    // Only authored cuts enable rock below the plain. Testing the baked
    // microrelief here would turn ordinary ground grain into rocky banks.
    let raised=smoothstep(u.base+1.0,u.base+8.0,p.z);
    if(raised==1.0){return raised;}
    let cut=1.0-smoothstep(u.base-.5,u.base,baseHeight(p.xy));
    return max(raised,max(cut,smoothstep(.1,.6,painted)));
}
// Material age inferred from the same local cuts as the solid. This is an
// artistic rind-depth model, not a persisted geological age simulation.
fn voxelSkin(p:vec3f,slope:f32,painted:f32,rain:f32)->vec2f {
    if(max(u.faceFresh,u.faceRind)<=0.0||u.rockFace<=0.0){return vec2f(0);}
    let skinGate=rockFaceGate(slope,painted,routeProtection(p.xy))*voxelRockHeight(p,painted)*clamp(voxelRelief(p.xy,slope)*u.rockFace*.5,0.0,1.0);
    if(skinGate<=0.0){return vec2f(0);}
    let r=voxelRockSpace(p);let hard=voxelHardness(p);
    let c=voxelBlocks(r,max(4.0,u.faceBlockSize));let broad=voxelBlocks(r,max(24.0,u.faceBlockSize*2.5));
    let removed=(voxelSpall(r,c,hard)+voxelRelease(broad,hard)*min(24.0,u.faceBlockSize*.8)+u.faceJoint*voxelJoint(r,c,broad)*3.0)*u.rockFace*.5*voxelRelief(p.xy,slope);
    let depth=u.faceRindDepth*(.75+.5*voxelNoise(r/max(12.0,u.faceBlockSize*1.7)));
    let fresh=smoothstep(depth*.35+.2,depth*1.25+.8,removed);
    let mature=mix(.65,1.0,clamp(rain,0.0,1.0));
    return vec2f(fresh*u.faceFresh,(1.0-fresh)*u.faceRind*mature)*skinGate;
}
#ifdef VOLUME_COMPUTE
@group(3) @binding(0) var cacheOut:texture_storage_2d<rgba32float,write>;
@group(3) @binding(1) var guideOut:texture_storage_2d<rgba32float,write>;
@group(3) @binding(2) var<storage,read_write> columnsOut:array<vec4i>;
@group(3) @binding(3) var<storage,read_write> bricksOut:array<vec4i>;
struct VolumeCount {bricks:atomic<u32>,invalid:atomic<u32>,padding:vec2u}
@group(3) @binding(4) var<storage,read_write> countOut:VolumeCount;
@group(3) @binding(5) var<storage,read_write> densityOut:array<u32>;
@group(3) @binding(6) var blockOut:texture_storage_2d<rgba32float,write>;
@group(2) @binding(6) var vk:texture_2d<f32>;
fn voxelSourceHeight(p:vec2f)->f32 {
    let h=surfaceHeight(p);
    if(u.iceSoft<=0.0){return h;}
    var softened=0.0;
    for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){softened+=baseHeight(p+vec2f(f32(x),f32(y))*6.5);}}
    let base=baseHeight(p);return h+u.iceSoft*smoothstep(u.base+1.5,u.base+8.0,base)*(softened/9.0-base);
}
@compute @workgroup_size(8,8)
fn voxelPrepare(@builtin(global_invocation_id) id:vec3u){
    if(id.x>=vs.width||id.y>=vs.height){return;}
    let p=vs.origin+(vec2f(id.xy)+.5)*vs.step;
    let e=max(2.0,vs.step);let h=voxelSourceHeight(p);
    let g=vec2f(voxelSourceHeight(p+vec2f(e,0))-voxelSourceHeight(p-vec2f(e,0)),voxelSourceHeight(p+vec2f(0,e))-voxelSourceHeight(p-vec2f(0,e)))/(2.0*e);
    textureStore(cacheOut,vec2i(id.xy),vec4f(h,normalize(vec3f(-g,1))));
}
// The guide gives each voxel the direction its rock is displaced along: its own surface normal, or that of a steeper face within 16 px,
// so a cliff's foot and brow move with the cliff. Blocks of 4 px on the global lattice are reduced first to their steepest normal, and
// every voxel then searches the same blocks. Searching the surface itself at each voxel's own position plus multiples of 4 px, as before,
// gave neighbors disjoint candidates: they picked different faces, and the solid carried a 4 px lattice of dots on every steep face.
// The surface's range (low, high: what voxelClassify allocates bricks from) is still read at those multiples of 4 px, so a column's bricks
// are the ones it had.
fn voxelBlockCells()->i32{return max(1,i32(round(4.0/vs.step)));}
@compute @workgroup_size(8,8)
fn voxelGuideBlocks(@builtin(global_invocation_id) id:vec3u){
    let cells=voxelBlockCells();let last=vec2i(i32(vs.width),i32(vs.height))-1;
    if(any(vec2i(id.xy)*cells>last)){return;}
    var n=vec2f(0);var steep=2.0;
    for(var y=0;y<cells;y++){for(var x=0;x<cells;x++){
        let a=textureLoad(vh,min(vec2i(id.xy)*cells+vec2i(x,y),last),0);
        if(a.w<steep){steep=a.w;n=a.yz;}
    }}textureStore(blockOut,vec2i(id.xy),vec4f(n,steep,0));
}
@compute @workgroup_size(8,8)
fn voxelGuideBuild(@builtin(global_invocation_id) id:vec3u){
    if(id.x>=vs.width||id.y>=vs.height){return;}
    let at=vec2i(id.xy);let original=textureLoad(vh,at,0);var n=original.yz;var score=1.0-original.w;var low=original.x;var high=original.x;
    for(var y=-4;y<=4;y++){for(var x=-4;x<=4;x++){
        let off=vec2i(round(vec2f(f32(x),f32(y))*4.0/vs.step));if(length(vec2f(off))*vs.step>16.0){continue;}
        let h=textureLoad(vh,clamp(at+off,vec2i(0),vec2i(i32(vs.width),i32(vs.height))-1),0).x;low=min(low,h);high=max(high,h);
    }}
    let cells=voxelBlockCells();let size=f32(cells)*vs.step;let blocks=vec2i(textureDimensions(vk));let home=at/cells;
    let reach=i32(ceil(16.0/size))+1;
    for(var y=-reach;y<=reach;y++){for(var x=-reach;x<=reach;x++){
        let b=home+vec2i(x,y);if(any(b<vec2i(0))||any(b>=blocks)){continue;}
        let d=length((vec2f(b)+.5)*size-(vec2f(at)+.5)*vs.step);if(d>16.0){continue;}   // to the block's middle
        let a=textureLoad(vk,b,0);let q=(1.0-a.z)/(1.0+d*d*.035);
        if(a.z<.5&&q>score){n=a.xy;score=q;}
    }}textureStore(guideOut,at,vec4f(n,low,high));
}
@compute @workgroup_size(8,8)
fn voxelClassify(@builtin(global_invocation_id) id:vec3u){
    if(id.x>=vs.columnsX||id.y>=vs.columnsY){return;}
    var low=1e8;var high=-1e8;var steep=0.0;
    for(var y=0;y<8;y++){for(var x=0;x<8;x++){
        let g=textureLoad(vg,vec2i(id.xy)*8+vec2i(x,y),0);low=min(low,g.z);high=max(high,g.w);steep=max(steep,length(g.xy));
    }}
    if(low<vs.low||high>vs.high){atomicAdd(&countOut.invalid,1u);}
    let center=vs.origin+(vec2f(id.xy)*8.0+4.0)*vs.step;
    let painted=voxelPaintRock(center);
    // A rim's bare rock has half a face's relief, so half its reach above and below.
    let apron=max(max(6.0*vs.step,40.0*max(smoothstep(.1,.45,steep),smoothstep(.0,.1,painted))),20.0*smoothstep(.0,.1,rimRockAt(center)));
    // Keep only the part of this surface column that can project into the
    // output rectangle, plus the full shadow, normal, and four-pass wear reach.
    // A tall scene therefore does not allocate all the unrelated rock behind it.
    let y=vs.origin.y+f32(id.y*8u)*vs.step;let guard=64.0+18.0*vs.step;
    // Below the water plane the ray is vertical in XY. Keep that interval as
    // well as the slanted dry ray; otherwise deep rock can vanish at tile edges.
    let waterY=y+(u.base-u.sea)*.5;
    let submergedView=low<u.sea&&waterY+8.0*vs.step>=vs.screenY.x-guard*.5&&waterY<=vs.screenY.y+guard*.5;
    let projectedBottom=u.base+2.0*(y-vs.screenY.y)-guard;
    let projectedTop=u.base+2.0*(y+8.0*vs.step-vs.screenY.x)+guard;
    let bottom=max(max(vs.low,low)-apron,select(projectedBottom,min(projectedBottom,vs.low-apron),submergedView));
    let top=min(min(vs.high,high)+apron,select(projectedTop,max(projectedTop,u.sea+guard),submergedView));
    let first=i32(floor(bottom/(vs.step*8.0)));let last=i32(ceil(top/(vs.step*8.0)));
    let count=u32(max(0,last-first));let start=atomicAdd(&countOut.bricks,count);
    columnsOut[id.y*vs.columnsX+id.x]=vec4i(first,i32(count),i32(start),0);
    for(var z=0u;z<count;z++){if(start+z<vs.capacity){bricksOut[start+z]=vec4i(vec2i(id.xy),first+i32(z),i32(start+z));}}
}
fn voxelPaintRock(p:vec2f)->f32 {
    if(u.paintOn==0){return 0.0;}
    return max(0.0,textureSampleLevel(masksTex,linearClamp,maskUv(p),0,0.0).r);
}
fn voxelDensity(p:vec3f)->f32 {
    let source=voxelAuthored(p.xy);let guide=voxelGuide(p.xy);let nz=sqrt(max(.000225,1.0-dot(guide.xy,guide.xy)));let n=normalize(vec3f(guide.xy,nz));
    let d=(p.z-source.x)*min(max(source.w,.015),n.z);
    if(abs(d)>40.0||u.rockFace<=0.0){return d;}
    let slope=length(n.xy)/max(n.z,.015);let route=routeProtection(p.xy);
    let painted=voxelPaintRock(p.xy);let rim=rimRockAt(p.xy);
    let face=max(rockFaceGate(slope,painted,route),rimRelief(rim,route));
    let soil=u.faceLayers*smoothstep(.08,.6,slope)*smoothstep(.5,.9,n.z)*(1.0-route);
    if(max(face,soil)<.001){return d;}
    let heightGate=voxelRockHeight(p,max(painted,rim));
    if(max(face,soil)*heightGate<.001){return d;}
    let r=voxelRockSpace(p);
    let c=voxelBlocks(r,max(4.0,u.faceBlockSize));let broad=voxelBlocks(r,max(24.0,u.faceBlockSize*2.5));
    let joint=voxelJoint(r,c,broad);
    let course=voxelNoise(r/vec3f(max(14.0,u.faceRun*.3),max(14.0,u.faceRun*.3),max(3.0,u.faceBed*.6)))-.5;
    let faces=u.faceBlock*(c.face*.65+broad.face*1.05);
    let mass=course*u.faceMass*2.2;
    // Fine laminations follow the same deformed column as the larger beds.
    let phase=fract(voxelColumnCoord(p)/u.faceLaminaSize);
    let lamina=(smoothstep(.02,.2,phase)*(1.0-smoothstep(.72,.98,phase))-.5)*u.faceLamina*2.5;
    let bed=(.55-voxelHardness(p))*u.faceLedge*2.4;
    let detail=voxelDetail(r);
    let pits=(abs(voxelNoise(r/max(2.0,u.faceCreaseSize))-.5)-.25)*u.faceCrease*2.5;
    let angle=radians(u.faceScratchAngle);
    let scratched=vec3f(r.x*cos(angle)-r.z*sin(angle),r.y,r.x*sin(angle)+r.z*cos(angle));
    let runnel=pow(1.0-abs(voxelNoise(scratched/vec3f(max(2.0,u.faceScratchSize),max(2.0,u.faceScratchSize),u.faceScratchLength))*2.0-1.0),4.0)*u.faceScratch*.5;
    let grit=(voxelNoise(p/u.faceGritSize)-.5)*u.faceGrit*4.0;
    // Soil-covered beds have their own rounded terraces, including on
    // slopes that also expose rock; an activation mask alone hid this control.
    // Chips remove corners and patches along weaker partings. This exposes
    // broad intact faces instead of adding the same fine noise everywhere.
    let hard=voxelHardness(p);
    let spall=voxelSpall(r,c,hard);
    let clasts=voxelClasts(p);
    let inclusion=u.faceClast*(clasts.x-.12)*min(4.0,u.faceClastSize*.22);
    let release=voxelRelease(broad,hard)*min(24.0,u.faceBlockSize*.8);
    let runoff=u.runoffCut*rockWeatherAt(p.xy).x*(1.25-.75*voxelHardness(p));
    let structure=(faces+mass+pits*detail+grit*detail-spall-release+inclusion-u.faceJoint*joint*3.0-runnel*detail-runoff+bed+u.faceExtrude*6.0*(.65+.35*c.tone))*face+soil*(bed*3.0+mass*1.5)+lamina*(face+soil*3.0);
    let offset=32.0*tanh(u.rockFace*.5*voxelRelief(p.xy,slope)*structure/32.0)*heightGate;
    let q=p-n*offset;let moved=voxelAuthored(q.xy);
    return (q.z-moved.x)*min(max(moved.w,.015),n.z);
}
@compute @workgroup_size(4,8,8)
fn voxelBuild(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) local:vec3u){
    let brick=group.x+group.y*128u;if(brick>=vs.capacity){return;}
    let b=vb[brick];let cell=vec3i(b.xyz)*8+vec3i(i32(local.x)*2,i32(local.y),i32(local.z));
    let p=vec3f(vs.origin,0)+(vec3f(cell)+.5)*vs.step;
    let a=voxelDensity(p);let c=voxelDensity(p+vec3f(vs.step,0,0));
    densityOut[brick*256u+local.z*32u+local.y*4u+local.x]=pack2x16float(vec2f(a,c));
}
fn voxelWear(p:vec3i)->f32 {
    let d=voxelCell(p);if(abs(d)>6.0*vs.step){return d;}
    let q=(vec3f(p)+.5)*vs.step;let g=voxelGuide(q.xy);let nz=sqrt(max(.000225,1.0-dot(g.xy,g.xy)));
    let painted=max(voxelPaintRock(q.xy),.5*rimRockAt(q.xy));
    let heightGate=voxelRockHeight(q,painted);
    let exposure=max(1.0-smoothstep(.75,.98,nz),painted)*(1.0-routeProtection(q.xy))*heightGate;
    let sum=voxelCell(p+vec3i(1,0,0))+voxelCell(p-vec3i(1,0,0))+voxelCell(p+vec3i(0,1,0))+voxelCell(p-vec3i(0,1,0))+voxelCell(p+vec3i(0,0,1))+voxelCell(p-vec3i(0,0,1));
    let gradient=length(vec3f(voxelCell(p+vec3i(1,0,0))-voxelCell(p-vec3i(1,0,0)),voxelCell(p+vec3i(0,1,0))-voxelCell(p-vec3i(0,1,0)),voxelCell(p+vec3i(0,0,1))-voxelCell(p-vec3i(0,0,1))))/(2.0*vs.step);
    // The six-neighbor diffusion coefficient stays below 1/6 at every
    // exposed control value; erosion depth and rounding remain independent.
    // Keep four wear passes within the allocated 40-pixel surface apron,
    // even when a local relief stroke amplifies the global setting.
    let depth=min(2.0,u.rockFace*.5*voxelRelief(q.xy,length(g.xy)/nz));
    return d+u.faceWear*exposure*(.8*depth*(1.0-voxelHardness(q))*gradient+(sum-6.0*d)*.12*clamp(depth,0.0,1.0));
}
@compute @workgroup_size(4,8,8)
fn voxelWeather(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) local:vec3u){
    let brick=group.x+group.y*128u;if(brick>=vs.capacity){return;}
    let b=vb[brick];let cell=vec3i(b.xyz)*8+vec3i(vec2i(round(vs.origin/vs.step)),0)+vec3i(i32(local.x)*2,i32(local.y),i32(local.z));
    densityOut[brick*256u+local.z*32u+local.y*4u+local.x]=pack2x16float(vec2f(voxelWear(cell),voxelWear(cell+vec3i(1,0,0))));
}
#endif
#ifdef VOLUME_RENDER
fn voxelRayPoint(screen:vec2f,z:f32,underwater:bool)->vec3f {
    return vec3f(screen.x,screen.y+(select(z,u.sea,underwater)-u.base)*.5,z);
}
fn voxelHit(screen:vec2f)->vec3f {
    var z=vs.high+40.0;var previous=z;var underwater=false;
    for(var i=0;i<4096;i++){
        let d=voxelField(voxelRayPoint(screen,z,underwater));if(d<=0.0){break;}
        previous=z;z-=clamp(d*.45,.24*vs.step,8.0*vs.step);
        // Water projects at its level. The same solid supplies its seabed.
        if(!underwater&&previous>=u.sea&&z<u.sea){z=u.sea;previous=z;underwater=true;}
        if(z<vs.low-40.0){break;}
    }
    // Reconstruct every sample from the screen ray: incremental XY stepping
    // accumulated a different rounding error when the allocator split a tile.
    var lo=previous;var hi=z;
    for(var i=0;i<16;i++){let mid=(lo+hi)*.5;if(voxelField(voxelRayPoint(screen,mid,underwater))>0.0){lo=mid;}else{hi=mid;}}
    return round(voxelRayPoint(screen,(lo+hi)*.5,underwater)*256.0)/256.0;
}
// Test the final solid above a shelf, including roofs formed by side displacement.
fn voxelRain(p:vec3f,n:vec3f)->f32 {
    if(n.z<=.1){return 0.0;}
    let xy=clamp(vec2i((p.xy-vs.origin)/vs.step)/8,vec2i(0),vec2i(i32(vs.columnsX),i32(vs.columnsY))-1);
    let c=vc[u32(xy.y)*vs.columnsX+u32(xy.x)];let top=f32((c.x+c.y)*8)*vs.step;
    var q=p+vec3f(0,0,vs.step*1.5);
    for(var i=0;i<128;i++){
        if(q.z>=top){return 1.0;}
        let d=voxelField(q);if(d<.02*vs.step){return 0.0;}
        q.z+=clamp(d*.5,vs.step,vs.step*4.0);
    }return 0.0;
}
fn voxelShadow(p:vec3f,n:vec3f)->f32 {
    var t=vs.step;for(var i=0;i<48;i++){
        let q=p+n*vs.step*.8+u.light*t;
        if(t>24.0||q.z>vs.high+40.0){break;}
        let d=voxelField(q);if(d<.05*vs.step){return 0.0;}t+=clamp(d*.45,.4*vs.step,3.0*vs.step);
    }return 1.0;
}
// Signed surface curvature at one, two, and four voxels. This keeps the
// artist's cavity accent attached to real grooves, including vertical faces.
fn voxelCavity(p:vec3f,n:vec3f)->f32 {
    let axis=select(vec3f(0,0,1),vec3f(1,0,0),abs(n.z)>.9);let t=normalize(cross(n,axis));let b=cross(n,t);
    let gradient=max(.05,length(voxelGradient(p)));let weights=array<f32,3>(.5,.3,.2);var curvature=0.0;
    for(var i=0;i<3;i++){
        let reach=f32(1u<<u32(i))*vs.step;
        let mean=.25*(voxelField(p+t*reach)+voxelField(p-t*reach)+voxelField(p+b*reach)+voxelField(p-b*reach));
        curvature-=weights[i]*mean/(reach*gradient);
    }
    return smoothstep(.02,.5,curvature)-.15*smoothstep(.08,.8,-curvature);
}
fn voxelOcclusion(p:vec3f,n:vec3f)->f32 {
    let axis=select(vec3f(0,0,1),vec3f(1,0,0),abs(n.z)>.9);let t=normalize(cross(n,axis));let b=cross(n,t);var occluded=0.0;
    for(var i=0;i<4;i++){
        let a=f32(i)*1.5707963;let dir=n*.6+(t*cos(a)+b*sin(a))*.8;
        for(var j=0;j<4;j++){let distance=(1.5+f32(j*j)*1.1)*vs.step;if(voxelField(p+n*.6*vs.step+dir*distance)<.05*vs.step){occluded+=1.0-f32(j)*.16;break;}}
    }return 1.0-occluded*.14;
}
#endif
