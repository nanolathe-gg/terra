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
    return baseHeight(p)+(valueNoise(p/max(u.runoffScale,8.0)+vec2f(37,91))-.5)*1.4;
}
@compute @workgroup_size(8,8)
fn rockTerrain(@builtin(global_invocation_id) id:vec3u){
    if(!flowInBounds(id.xy)){return;}let p=flowPoint(id.xy);let h=flowHeight(p);
    let g=vec2f(flowHeight(p+vec2f(4,0))-flowHeight(p-vec2f(4,0)),flowHeight(p+vec2f(0,4))-flowHeight(p-vec2f(0,4)))/8.0;
    let tm=timeMapsAt(p);let rain=(.15+pow(valueNoise(p/max(u.runoffScale,8.0)+vec2f(5,17)),3.0)*2.5)*(1.0+tm.flow*2.0);
    textureStore(flowOut,vec2i(id.xy),vec4f(h,-g,rain*smoothstep(u.sea,u.sea+2.0,h)*(1.0-routeProtection(p))));
    // Cache source geology once per 4px cell. Deposit gathering uses the same
    // folded beds and fracture identities as the solid, with no CPU readback.
    let point=vec3f(p,baseHeight(p));var hard=.55;var slot=0.0;var thick=u.faceBed;
    if(u.columnSectionCount>0){let bed=voxelBed(point);hard=bed.hardness;slot=bed.slot;thick=bed.thick*u.faceBed/5.5;}
    var released=0.0;
    if(u.faceBreak>0.0){let block=voxelBlocks(voxelRockSpace(point),max(24.0,u.faceBlockSize*2.5));released=voxelRelease(block,hard);}
    textureStore(sourceOut,vec2i(id.xy),vec4f(hard,released,slot,thick));
}
fn flowLobe(fall:vec2f,dir:vec2f)->f32 {
    let n=fall/max(length(fall),.001);
    return pow(max(0.0,dot(n,normalize(dir))),mix(1.0,8.0,u.runoffConcentration));
}
fn flowTotal(fall:vec2f)->f32 {
    var total=0.0;for(var j=0;j<8;j++){total+=flowLobe(fall,vec2f(FLOW_DIRS[j]));}
    return max(total,.001);
}
@compute @workgroup_size(8,8)
fn rockRain(@builtin(global_invocation_id) id:vec3u){
    if(!flowInBounds(id.xy)){return;}let t=flowAt(flowTerrain,vec2i(id.xy));let total=flowTotal(t.yz);
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
        incoming+=flowAt(flowPrevious,at).x*flowLobe(q.yz,-vec2f(FLOW_DIRS[j]))*down;
    }
    let total=flowAt(flowPrevious,i).y;
    textureStore(flowOut,i,vec4f((t.w+incoming*.96)/total,total,0,0));
}
@compute @workgroup_size(8,8)
fn rockDeposit(@builtin(global_invocation_id) id:vec3u){
    if(!flowInBounds(id.xy)){return;}let p=flowPoint(id.xy);let t=flowAt(flowTerrain,vec2i(id.xy));
    let h=baseHeight(p);
    let slope=length(vec2f(baseHeight(p+vec2f(4,0))-baseHeight(p-vec2f(4,0)),baseHeight(p+vec2f(0,4))-baseHeight(p-vec2f(0,4))))/8.0;let dry=smoothstep(u.sea+1.0,u.sea+3.0,h);let route=1.0-routeProtection(p);
    let transported=flowAt(flowPrevious,vec2i(id.xy));let flow=transported.x*transported.y;
    // Wide damp ribbons surround narrower incised threads. Both read the
    // transported discharge, so a stain cannot drift away from its groove.
    let runoff=u.runoff*max(0.0,flow-1.0)/8.0;
    let channel=clamp(pow(max(0.0,runoff),mix(.7,1.7,u.runoffConcentration)),0.0,1.5)*dry*route;
    var catchment=0.0;var travel=0.0;var mass=0.0;var provenance=vec4f(0);
    // Rockfall envelopes from actual higher ground. Angle of repose prevents
    // gravel coating vertical faces; fractured sources produce separate fans.
    for(var j=0;j<8;j++){
        let dir=normalize(vec2f(FLOW_DIRS[j]));
        for(var k=1;k<=4;k++){
            let distance=u.debrisReach*f32(k)/4.0;let q=p+dir*distance;let rise=baseHeight(q)-h;
            let source=smoothstep(5.0,24.0,rise)*smoothstep(.2,.8,rise/max(distance,1.0));
            let fracture=.25+.75*valueNoise(q/max(12.0,u.faceBlockSize*1.8)+vec2f(11,63));
            let sourceCell=vec2i(floor((q-u.rockWeatherGrid.xy)/FLOW_STEP));let bed=flowAt(sourceBeds,sourceCell);
            let weight=source*fracture*(1.0+bed.y*5.0)*exp(-distance/max(4.0,u.debrisReach*.7));
            let color=u.strataColors[clamp(i32(bed.z+.5),0,4)].rgb;
            let size=clamp(sqrt(max(1.0,u.faceBlockSize*bed.w))*.09*mix(.65,1.3,bed.x),.35,2.4);
            provenance+=vec4f(color,size)*weight;
            catchment=max(catchment,weight);travel+=weight*distance/max(u.debrisReach,1.0);mass+=weight;
        }
    }
    let shelf=1.0-smoothstep(.45,1.0,slope);
    let pocket=clamp(.65+(baseHeight(p+vec2f(8,0))+baseHeight(p-vec2f(8,0))+baseHeight(p+vec2f(0,8))+baseHeight(p-vec2f(0,8))-4.0*h)*.04,.35,1.4);
    // The foot zone. The envelopes above need the ground to rise steeply all the way from the point, so they end where a debris slope does, and
    // the plain beyond was one tone to the slope's toe. Debris also lies out from the toe of rising ground, thinning to nothing at Rockfall
    // reach. Eight ways out, six steps each: the toe is where the ground has risen 6 units, read between two steps so it changes evenly as the
    // point moves, and it counts by how high the ground goes on within the reach (12 units barely, 30 wholly: a wall or a hill, not a hummock).
    // Only gentle ground is a foot (a slope under .15 a px wholly, none over .45). The far edge is ragged: tongues and gaps, not a contour.
    var foot=0.0;var footMass=0.0;
    if(u.debrisAmount>0.0){
        let reach=u.debrisReach*(.7+.3*valueNoise(p/64.0+vec2f(19,83)));let stride=reach/6.0;   // .4 to 1 of Rockfall reach
        for(var j=0;j<8;j++){
            let dir=normalize(vec2f(FLOW_DIRS[j]));var before=0.0;var way=-1.0;var top=0.0;
            for(var k=1;k<=6;k++){
                let rise=baseHeight(p+dir*stride*f32(k))-h;top=max(top,rise);
                if(way<0.0&&rise>=6.0){way=stride*(f32(k)-1.0+clamp((6.0-before)/max(rise-before,.001),0.0,1.0));}
                before=rise;
            }
            let near=select(0.0,max(0.0,1.0-way/reach)*smoothstep(12.0,30.0,top),way>=0.0);
            if(near>0.0){
                // The foot's debris is the rock that stands over it: the beds at the reach's end, weighed lightly beside a rockfall's own.
                let q=p+dir*reach;let bed=flowAt(sourceBeds,vec2i(floor((q-u.rockWeatherGrid.xy)/FLOW_STEP)));
                let size=clamp(sqrt(max(1.0,u.faceBlockSize*bed.w))*.09*mix(.65,1.3,bed.x),.35,2.4);
                provenance+=vec4f(u.strataColors[clamp(i32(bed.z+.5),0,4)].rgb,size)*near*.05;footMass+=near*.05;
            }
            foot=max(foot,near);
        }
        let ragged=.5+.3*valueNoise(p/22.0+vec2f(53,7))+.2*valueNoise(p/7.0+vec2f(3,41));   // 0 to 1
        foot=(.5+.5*foot)*smoothstep(ragged*.55,ragged*.55+.45,foot)*(1.0-smoothstep(.15,.45,slope));
    }
    let apron=.7*foot;
    let debris=clamp(u.debrisAmount*((catchment*3.5+mass*.22)*(1.0+.5*clamp(runoff,0.0,1.0)*shelf)+apron)*shelf*pocket*depositsAt(p)*dry*route,0.0,1.5);
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
    textureStore(rimOut,vec2i(id.xy),vec4f(rim,0,0,0));
}
