// Authored fixtures for offline hover previews. Only source data is committed;
// repro/ui-previews.mjs renders the images into the server's own assets root.
export const HELP_TOOLS=['plateau','hill','mountain','ramp','deep','shallow','valleyV','valleyU','valleyT','river','braided','crater','fissure','crystal'];
export const HELP_CONTROLS={
  diameter:{key:'diameter',values:[160,440],step:8,unit:' px'},
  'lf-elevation':{key:'elevation',values:[135,235],step:1,unit:' units'},
  'lf-wander':{key:'wander',values:[0,80],step:2,unit:' px'},
  'lf-width-vary':{key:'widthVary',values:[0,100],step:5,unit:'%'},
  'lf-height-vary':{key:'heightVary',values:[0,40],step:1,unit:' units'},
  'lf-gullies':{key:'gullies',values:[0,100],step:5,unit:'%'},
  'lf-gully-size':{key:'gullySize',base:{gullies:100},values:[20,90],step:5,unit:'%'},
  'lf-talus':{key:'talus',base:{gullies:100,curve:{form:'cliff'}},values:[0,180],step:5,unit:' px'},
  'water-surf':{key:'surf',base:{diameter:600,heightReference:1,elevation:-55,combine:1,lean:100,curve:{form:'lfShore'}},values:[0,100],step:5,unit:'%'},
  'sec-terraces':{key:'terraces',values:[0,6],step:1,unit:' steps'},
  'sec-ledge':{key:'ledge',base:{terraces:4},values:[10,85],step:5,unit:'% flat'},
  lean:{key:'lean',values:[60,300],step:5,divisor:100,unit:' : 1'},
  'spur-count':{key:'spurCount',base:{spurLength:180},values:[0,7],step:1,unit:' spurs'},
  'lf-vary-size':{key:'varySize',base:{wander:55,widthVary:70,heightVary:30},values:[40,350],step:10,unit:' px'},
};
export const HELP_CARD={diameter:300,elevation:200,combine:0,wander:0,widthVary:0,heightVary:0,gullies:0,terraces:0,cracks:0,curve:{form:'lfHill'}};
export const HELP_PATH=[[430,520],[620,420],[800,510]];
// Bump when renderer or preset changes require fresh authored examples.
export const HELP_VERSION=3;
export const HELP_FRAME={width:260,height:190,ms:160};
export function helpFrames(example){
  const [lo,hi]=example.values,step=example.step;
  const values=[...new Set(Array.from({length:11},(_,i)=>Math.max(lo,Math.min(hi,Math.round((lo+(hi-lo)*i/10)/step)*step))))];
  return values.map(value=>({value,label:`${Number((value/(example.divisor||1)).toFixed(2))}${example.unit}`}));
}
// Hold each endpoint for three ticks, without jumping from high back to low.
export function helpTimeline(count){
  if(count<2)return count?[0]:[];
  const middle=Array.from({length:count-2},(_,i)=>i+1);
  return [0,0,0,...middle,count-1,count-1,count-1,...middle.toReversed()];
}
