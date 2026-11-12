/*COMMON*/
// Shared local surface transport, before loose stones and voxel construction.
// Four art pixels per cell, 16 bounded downhill steps. The apron covers every
// dependency so a different chunk budget cannot change the drainage network.
@group(1) @binding(0) var flowTerrain:texture_2d<f32>;
@group(1) @binding(1) var flowPrevious:texture_2d<f32>;
@group(1) @binding(2) var flowOut:texture_storage_2d<rgba32float,write>;
@group(1) @binding(3) var sourceBeds:texture_2d<f32>;
@group(1) @binding(4) var sourceOut:texture_storage_2d<rgba32float,write>;
@group(1) @binding(5) var rimOut:texture_storage_2d<rgba32float,write>;
const FLOW_STEP=4.0;
const FLOW_DIRS=array<vec2i,8>(vec2i(1,0),vec2i(1,1),vec2i(0,1),vec2i(-1,1),vec2i(-1,0),vec2i(-1,-1),vec2i(0,-1),vec2i(1,-1));
fn flowAt(t:texture_2d<f32>,i:vec2i)->vec4f{return textureLoad(t,clamp(i,vec2i(0),vec2i(textureDimensions(t))-1),0);}
fn flowPoint(i:vec2u)->vec2f{return u.rockWeatherGrid.xy+(vec2f(i)+.5)*FLOW_STEP;}
fn flowInBounds(i:vec2u)->bool{return all(i<vec2u(u.rockWeatherGrid.zw));}
fn flowHeight(p:vec2f)->f32 {
    // Small surface irregularities select connected channels on broad planar
    // walls; the authored terrain still determines every downhill direction.
    return baseHeight(p)+(valueNoise(p/max(u.rock[rockSlotAt(p) & rockMask].runoffScale,8.0)+vec2f(37,91))-.5)*1.4;   // p's own rock's catchment size
}
@compute @workgroup_size(8,8)
fn rockTerrain(@builtin(global_invocation_id) id:vec3u){
    if(!flowInBounds(id.xy)){return;}let p=flowPoint(id.xy);useRock(p);let h=flowHeight(p);
    let g=vec2f(flowHeight(p+vec2f(4,0))-flowHeight(p-vec2f(4,0)),flowHeight(p+vec2f(0,4))-flowHeight(p-vec2f(0,4)))/8.0;
    let tm=timeMapsAt(p);let rain=(.15+pow(valueNoise(p/max(u.rock[rs & rockMask].runoffScale,8.0)+vec2f(5,17)),3.0)*2.5)*(1.0+tm.flow*2.0);
    textureStore(flowOut,vec2i(id.xy),vec4f(h,-g,rain*smoothstep(u.sea,u.sea+2.0,h)*(1.0-routeProtection(p))));
    // Cache source geology once per 4px cell. Deposit gathering uses the same
    // folded beds and fracture identities as the solid, with no CPU readback.
    let point=vec3f(p,baseHeight(p));var hard=.55;var slot=0.0;var thick=u.rock[rs & rockMask].faceBed;
    if(u.rock[rs & rockMask].columnCount>0){let bed=voxelBed(point);hard=columnGather(bed,length(g)).x;slot=bed.slot;thick=bed.thick*u.rock[rs & rockMask].faceBed/5.5;}
    var released=0.0;
    if(u.rock[rs & rockMask].faceBreak>0.0){let block=voxelBlocks(voxelRockSpace(point),max(24.0,u.rock[rs & rockMask].faceBlockSize*2.5));released=voxelRelease(block,hard);}
    // z: the bed's colour slot, plus 8 times the cell's rock slot, so a deposit knows whose rock each source is.
    textureStore(sourceOut,vec2i(id.xy),vec4f(hard,released,slot+8.0*f32(rs & rockMask),thick));
}
// The share of a cell's water that leaves along dir, by the concentration of the cell's own rock (slot k).
fn flowLobe(fall:vec2f,dir:vec2f,k:u32)->f32 {
    let n=fall/max(length(fall),.001);
    return pow(max(0.0,dot(n,normalize(dir))),mix(1.0,8.0,u.rock[k & rockMask].runoffConcentration));
}
fn flowTotal(fall:vec2f)->f32 {
    var total=0.0;for(var j=0;j<8;j++){total+=flowLobe(fall,vec2f(FLOW_DIRS[j]),rs);}
    return max(total,.001);
}
@compute @workgroup_size(8,8)
fn rockRain(@builtin(global_invocation_id) id:vec3u){
    if(!flowInBounds(id.xy)){return;}useRock(flowPoint(id.xy));let t=flowAt(flowTerrain,vec2i(id.xy));let total=flowTotal(t.yz);
    // Cache the angular normalization, rather than recomputing all eight
    // outgoing weights for every incoming neighbor on every transport step.
    textureStore(flowOut,vec2i(id.xy),vec4f(t.w/total,total,0,0));
}
@compute @workgroup_size(8,8)
fn rockFlow(@builtin(global_invocation_id) id:vec3u){
    if(!flowInBounds(id.xy)){return;}let i=vec2i(id.xy);let t=flowAt(flowTerrain,i);var incoming=0.0;
    for(var j=0;j<8;j++){
        let at=i+FLOW_DIRS[j];let q=flowAt(flowTerrain,at);
        let down=smoothstep(0.0,.05,q.x-t.x);
        incoming+=flowAt(flowPrevious,at).x*flowLobe(q.yz,-vec2f(FLOW_DIRS[j]),rockSlotAt(u.rockWeatherGrid.xy+(vec2f(at)+.5)*FLOW_STEP))*down;   // the neighbour's own rock
    }
    let total=flowAt(flowPrevious,i).y;
    textureStore(flowOut,i,vec4f((t.w+incoming*.96)/total,total,0,0));
}
@compute @workgroup_size(8,8)
fn rockDeposit(@builtin(global_invocation_id) id:vec3u){
    if(!flowInBounds(id.xy)){return;}let p=flowPoint(id.xy);useRock(p);let t=flowAt(flowTerrain,vec2i(id.xy));
    let h=baseHeight(p);
    let slope=length(vec2f(baseHeight(p+vec2f(4,0))-baseHeight(p-vec2f(4,0)),baseHeight(p+vec2f(0,4))-baseHeight(p-vec2f(0,4))))/8.0;let dry=smoothstep(u.sea+1.0,u.sea+3.0,h);let route=1.0-routeProtection(p);
    let transported=flowAt(flowPrevious,vec2i(id.xy));let flow=transported.x*transported.y;
    // Wide damp ribbons surround narrower incised threads. Both read the
    // transported discharge, so a stain cannot drift away from its groove.
    let runoff=u.rock[rs & rockMask].runoff*max(0.0,flow-1.0)/8.0;
    let channel=clamp(pow(max(0.0,runoff),mix(.7,1.7,u.rock[rs & rockMask].runoffConcentration)),0.0,1.5)*dry*route;
    var catchment=0.0;var travel=0.0;var mass=0.0;var provenance=vec4f(0);
    // The debris here is its sources' rock: each source's own numbers (its slot, which rockTerrain kept with its beds) set how far its debris
    // falls and how it breaks, and the strongest source's how much lies (dom). The steps reach as far as the farthest-falling rock in use.
    var dom=rs & rockMask;var domWeight=0.0;
    // With one rock in use (rockMask 0) the farthest reach is read from the same uniform as each source's, so the steps compile as one rock's did.
    let farthest=select(u.debrisReachMax,u.rock[rs & rockMask].debrisReach,rockMask==0u);
    // Rockfall envelopes from actual higher ground. Angle of repose prevents
    // gravel coating vertical faces; fractured sources produce separate fans.
    for(var j=0;j<8;j++){
        let dir=normalize(vec2f(FLOW_DIRS[j]));
        for(var k=1;k<=4;k++){
            let distance=farthest*f32(k)/4.0;let q=p+dir*distance;let rise=baseHeight(q)-h;
            let source=smoothstep(5.0,24.0,rise)*smoothstep(.2,.8,rise/max(distance,1.0));
            let sourceCell=vec2i(floor((q-u.rockWeatherGrid.xy)/FLOW_STEP));let bed=flowAt(sourceBeds,sourceCell);
            let src=u32(bed.z*.125)&rockMask;let bedSlot=bed.z-8.0*f32(src);let reach=u.rock[src & rockMask].debrisReach;
            let fracture=.25+.75*valueNoise(q/max(12.0,u.rock[src & rockMask].faceBlockSize*1.8)+vec2f(11,63));
            let weight=select(0.0,source*fracture*(1.0+bed.y*5.0)*exp(-distance/max(4.0,reach*.7)),distance<=reach);
            let color=u.strataColors[clamp(i32(bedSlot+.5),0,4)].rgb;
            let size=clamp(sqrt(max(1.0,u.rock[src & rockMask].faceBlockSize*bed.w))*.09*mix(.65,1.3,bed.x),.35,2.4);
            provenance+=vec4f(color,size)*weight;
            if(weight>domWeight){domWeight=weight;dom=src;}
            catchment=max(catchment,weight);travel+=weight*distance/max(reach,1.0);mass+=weight;
        }
    }
    let shelf=1.0-smoothstep(.45,1.0,slope);
    let pocket=clamp(.65+(baseHeight(p+vec2f(8,0))+baseHeight(p-vec2f(8,0))+baseHeight(p+vec2f(0,8))+baseHeight(p-vec2f(0,8))-4.0*h)*.04,.35,1.4);
    // The foot zone. The envelopes above need the ground to rise steeply all the way from the point, so they end where a debris slope does, and
    // the plain beyond was one tone to the slope's toe. Debris also lies out from the toe of rising ground, thinning to nothing at Rockfall
    // reach. Eight ways out, six steps each: the toe is where the ground has risen 6 units, read between two steps so it changes evenly as the
    // point moves, and it counts by how high the ground goes on within the reach (12 units barely, 30 wholly: not a hummock) and by how steep
    // its steepest step is (.6 units a px barely, .9 wholly: a wall, a mountain or a debris slope, which rests at .84; a hill has no foot).
    // Only gentle ground is a foot (a slope under .15 a px wholly, none over .45). The far edge is ragged: tongues and gaps, not a contour.
    var foot=0.0;var footMass=0.0;var footFrom=dom;var footNear=0.0;
    // Any rock in use that sheds debris (with one rock, its own test, so the pass compiles as one rock's did).
    if(select(u.debrisAny,u.rock[rs & rockMask].debrisAmount,rockMask==0u)>0.0){
        let wobble=.7+.3*valueNoise(p/64.0+vec2f(19,83));
        let reach=farthest*wobble;let stride=reach/6.0;   // .4 to 1 of Rockfall reach
        for(var j=0;j<8;j++){
            let dir=normalize(vec2f(FLOW_DIRS[j]));var before=0.0;var way=-1.0;var top=0.0;var steep=0.0;
            for(var k=1;k<=6;k++){
                let rise=baseHeight(p+dir*stride*f32(k))-h;top=max(top,rise);steep=max(steep,(rise-before)/stride);
                if(way<0.0&&rise>=6.0){way=stride*(f32(k)-1.0+clamp((6.0-before)/max(rise-before,.001),0.0,1.0));}
                before=rise;
            }
            // The foot's debris is the rock that stands over it: the beds at the reach's end, weighed lightly beside a rockfall's own. It lies out
            // as far as that rock falls.
            let q=p+dir*reach;let bed=flowAt(sourceBeds,vec2i(floor((q-u.rockWeatherGrid.xy)/FLOW_STEP)));
            let src=u32(bed.z*.125)&rockMask;let bedSlot=bed.z-8.0*f32(src);
            let near=select(0.0,max(0.0,1.0-way/(u.rock[src & rockMask].debrisReach*wobble))*smoothstep(12.0,30.0,top)*smoothstep(.6,.9,steep),way>=0.0);
            if(near>0.0){
                let size=clamp(sqrt(max(1.0,u.rock[src & rockMask].faceBlockSize*bed.w))*.09*mix(.65,1.3,bed.x),.35,2.4);
                provenance+=vec4f(u.strataColors[clamp(i32(bedSlot+.5),0,4)].rgb,size)*near*.05;footMass+=near*.05;
                if(near>footNear){footNear=near;footFrom=src;}
            }
            foot=max(foot,near);
        }
        let ragged=.5+.3*valueNoise(p/22.0+vec2f(53,7))+.2*valueNoise(p/7.0+vec2f(3,41));   // 0 to 1
        foot=(.5+.5*foot)*smoothstep(ragged*.55,ragged*.55+.45,foot)*(1.0-smoothstep(.15,.45,slope));
    }
    let apron=.7*foot;
    if(domWeight<=0.0){dom=footFrom;}   // no rockfall reaches here: the foot's rock
    let debris=clamp(u.rock[dom & rockMask].debrisAmount*((catchment*3.5+mass*.22)*(1.0+.5*clamp(runoff,0.0,1.0)*shelf)+apron)*shelf*pocket*depositsAt(p)*dry*route,0.0,1.5);
    // Fines: further from the source is finer, and the foot zone's outer part is the finest (wash), its inner part mixed.
    let fines=clamp(mix(.08+.75*(travel/max(mass,.001)),.9-.5*foot,apron/max(apron+catchment*3.5+mass*.22,.001))+.35*clamp(runoff,0.0,1.0)*shelf,0.0,1.0);
    textureStore(flowOut,vec2i(id.xy),vec4f(channel,debris,fines,clamp(runoff,0.0,1.0)*dry*route));
    textureStore(sourceOut,vec2i(id.xy),select(vec4f(0,0,0,1),provenance/max(mass+footMass,.0001),mass+footMass>.0001));
    // Bare rock at a rim (rimRockAt): on level dry ground (a slope under .08 a px wholly, none over .25: a hill's side has no rim), how near the
    // nearest drop is. Eight ways out, six steps each to the reach: the way to the drop is where the ground has fallen 8 units, read between two
    // steps so it changes evenly as the point moves. It counts when the fall there is a cliff's (.9 to 1.6 units a px: no hill is that steep, and
    // a debris slope rests at .84) and lands on dry ground: a bank into water keeps its cover, as a world's shore is its own matter. The reach
    // itself swells and thins along the rim.
    var rim=0.0;
    if(u.rimReach>0.0){
        let reach=u.rimReach*(.6+.6*valueNoise(p/56.0+vec2f(71,23)));let stride=reach/6.0;
        for(var j=0;j<8;j++){
            let dir=normalize(vec2f(FLOW_DIRS[j]));var before=0.0;
            for(var k=1;k<=6;k++){
                let fall=h-baseHeight(p+dir*stride*f32(k));
                if(fall>=8.0){
                    let way=stride*(f32(k)-1.0+clamp((8.0-before)/max(fall-before,.001),0.0,1.0));
                    rim=max(rim,max(0.0,1.0-way/reach)*smoothstep(.9,1.6,(fall-before)/stride)*smoothstep(u.sea+1.0,u.sea+3.0,h-fall));break;
                }
                before=fall;
            }
        }
        rim=pow(rim,.45)*(1.0-smoothstep(.08,.25,slope))*dry*route;   // bare for the first part of the way in, then thinning
    }
    // Rock at a shore (shoreRockAt): how near the waterline is, from either side. Eight ways out, six steps each to the reach: the way to the
    // waterline is where the ground crosses sea level, read between two steps so it changes evenly as the point moves. On land the reach is
    // Rock at shores, on the bed Rock shelf under water; each swells and thins along the shore, and the rock ends raggedly, in tongues and
    // gaps, where the reach does. A route keeps its cover on land, and water whose stroke is set to Soft bank (an inland lake) has none.
    var shore=0.0;var bank=0.0;
    let under=h<u.sea;let span=select(u.shoreRock,u.shoreShelf,under);
    if(span>0.0){
        let reach=span*(.85+.15*valueNoise(p/72.0+vec2f(31,57)));let stride=reach/6.0;   // .7 to 1 of the control
        for(var j=0;j<8;j++){
            let dir=normalize(vec2f(FLOW_DIRS[j]));var before=h-u.sea;
            for(var k=1;k<=6;k++){
                let level=baseHeight(p+dir*stride*f32(k))-u.sea;
                if((level<0.0)!=under){
                    // The water's own choice, read a little way into the water it belongs to: a stroke set to Soft bank has no shore rock.
                    let way=stride*(f32(k)-1.0+clamp(before/(before-level),0.0,1.0));
                    let soft=textureSampleLevel(masksTex,linearClamp,maskUv(p+dir*max(0.0,way+select(8.0,-8.0,under))),2,0.0).g;
                    let lake=smoothstep(.25,.75,soft);shore=max(shore,(1.0-way/reach)*(1.0-lake));bank=max(bank,(1.0-way/reach)*lake);break;
                }
                before=level;
            }
        }
        let ragged=.5+.3*valueNoise(p/22.0+vec2f(53,7))+.2*valueNoise(p/7.0+vec2f(3,41));   // 0 to 1
        shore=smoothstep(ragged*.25,ragged*.25+.15,shore)*select(route,1.0,under);   // whole for about three quarters of the reach
    }
    // A soft bank (softBankAt): within the same reach of a Soft bank stroke's water the ground is soil, not a rock face, however steep.
    textureStore(rimOut,vec2i(id.xy),vec4f(rim,shore,smoothstep(0.0,.3,bank),f32(dom)));   // w: the debris's rock (debrisSlotAt)
}
