import test from 'node:test';
import assert from 'node:assert/strict';
import {landformElevation} from '../sculpt-shape-presets.js';
import {prepareNode} from '../sculpt-gpu-fields.js';

test('sea-relative height follows the map sea while fixed elevation stays fixed',()=>{
  for(const sea of [0,23,75,255]){
    const params=new Proxy({radius:80,amount:70,rough:0,softness:.5,lean:1,elevation:-55,heightReference:1,curve:{form:'lfHill'}},{get:(p,k)=>p[k]??0});
    const node={kind:'landform',seed:2701,points:[{x:100,y:100},{x:160,y:100}],params};
    const context={seed:2701,baseHeight:sea+24,sea,params:n=>n.params};
    assert.equal(landformElevation(params,sea),sea-55);
    assert.equal(prepareNode(node,{grid:256,spacing:1},context).u.elev,sea-55);
    params.heightReference=0;
    assert.equal(prepareNode(node,{grid:256,spacing:1},context).u.elev,-55);
  }
});
