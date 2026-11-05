// Authored fixtures for offline hover previews. Only source data is committed;
// repro/ui-previews.mjs renders the images into the server's own assets root.
export const HELP_TOOLS=['plateau','hill','mountain','ramp','deep','shallow','valleyV','valleyU','valleyT','river','braided','crater','fissure','crystal'];
export const HELP_CONTROLS={
  diameter:{key:'diameter',values:[160,440],labels:['160 px','440 px']},
  'lf-elevation':{key:'elevation',values:[135,235],labels:['135 units','235 units']},
  'lf-wander':{key:'wander',values:[0,80],labels:['0 px','80 px']},
  'lf-width-vary':{key:'widthVary',values:[0,90],labels:['0%','90%']},
  'lf-height-vary':{key:'heightVary',values:[0,40],labels:['0 units','40 units']},
  'lf-gullies':{key:'gullies',values:[0,100],labels:['0%','100%']},
  'lf-gully-size':{key:'gullySize',base:{gullies:100},values:[20,90],labels:['20%','90%']},
  'lf-talus':{key:'talus',base:{gullies:100,curve:{form:'cliff'}},values:[0,180],labels:['0 px','180 px']},
  'sec-terraces':{key:'terraces',values:[0,6],labels:['0 steps','6 steps']},
  'sec-ledge':{key:'ledge',base:{terraces:4},values:[10,85],labels:['10% flat','85% flat']},
  lean:{key:'lean',values:[60,300],labels:['0.6 : 1','3 : 1']},
  'spur-count':{key:'spurCount',base:{spurLength:180},values:[0,7],labels:['0 spurs','7 spurs']},
  'lf-vary-size':{key:'varySize',base:{wander:55,widthVary:70,heightVary:30},values:[40,350],labels:['40 px','350 px']},
};
export const HELP_CARD={diameter:300,elevation:200,combine:0,wander:0,widthVary:0,heightVary:0,gullies:0,terraces:0,cracks:0,curve:{form:'lfHill'}};
export const HELP_PATH=[[430,520],[620,420],[800,510]];
