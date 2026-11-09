// Geological starting points are ordinary artist settings and Rock column beds.
// No preset name reaches the renderer; the edited numbers are the saved result.
import {KNOBS} from './sculpt-knobs.js';
const base={stoneRound:.15,stoneSlab:.25,faceJointTilt:12,faceScaleVary:.55,faceFold:0,faceSpall:.65,faceClast:0,faceClastSize:12,faceMineral:.3,runoff:.65,runoffScale:24,runoffConcentration:.65,runoffCut:2,runoffStain:.35,debrisAmount:1.1,debrisReach:80,debrisDepth:5,looseSize:7,stoneSort:.7,rockFace:2,faceRock:1,rockFaceFrom:.2,faceBed:5.5,faceLedge:2,faceRun:120,faceBlock:3,faceBlockSize:18,faceLean:0,faceWear:.25,faceCrease:.5,faceCreaseSize:6,faceScratch:.6,faceScratchSize:6,faceShade:.7,faceGrit:.15,faceGrass:.25,faceLayers:.3,faceMass:1,faceTone:.12,faceStrata:.08,faceWet:.2,
 faceStretch:1,faceBlockHeight:1,faceRound:0,faceJoint:.5,faceExtrude:0,faceLamina:0,faceLaminaSize:3,faceScratchLength:50,faceScratchAngle:0,faceGritSize:1.3,
 bedDip:0,bedDipDir:90,shineRock:.25,shineRockSharp:12,shineRockRough:.25,shineRockScale:3};
const preset=(label,knobs,beds)=>({label,knobs:{...base,...knobs},sections:[{start:0,beds}]});
export const ROCK_PRESETS={
 sandstone:preset('Layered sandstone',{rockFace:3,faceStretch:2.4,faceBlockHeight:1.6,faceBlock:5.2,faceBlockSize:26,faceBed:9,faceLedge:3.5,faceSpall:1.3,faceJoint:.65,faceExtrude:.3,faceLamina:.45,faceLaminaSize:5,faceWear:.3,faceScratch:1.2,faceStrata:.18},[[7,.85,0],[3,.28,1],[4,.65,2]]),
 shale:preset('Thin shale',{stoneSlab:.85,stoneRound:.05,faceStretch:3.2,faceBlockHeight:.4,faceBlockSize:24,faceBed:3,faceLedge:3.2,faceJoint:.9,faceLamina:.65,faceLaminaSize:3,faceExtrude:.2,faceWear:.1,faceScratch:.3,faceStrata:.22,shineRock:.18},[[2,.85,0],[1,.2,1],[3,.7,2],[1,.3,1]]),
 granite:preset('Rounded granite',{stoneRound:.8,stoneSlab:.1,faceSpall:.15,faceMineral:.8,faceScaleVary:.8,faceBlockSize:34,faceBlockHeight:4,faceRound:.85,faceBlock:4,faceBed:7,faceLedge:0,faceJoint:1.1,faceWear:.65,faceExtrude:.15,faceLayers:0,faceMass:1.8,faceCrease:.35,faceGrit:.6,faceGritSize:2,faceScratch:.2,faceStrata:0,shineRock:.4,shineRockSharp:34,shineRockRough:.5},[[12,.8,0]]),
 basalt:preset('Jointed basalt',{faceBlockSize:14,faceBlockHeight:5,faceBed:7,faceBlock:3.5,faceLedge:.2,faceJoint:1.3,faceWear:.12,faceExtrude:.1,faceLayers:0,faceScratch:1.6,faceScratchLength:120,faceCrease:.2,faceGrit:.3,faceStrata:0,shineRock:.3,shineRockSharp:28},[[12,.9,0]]),
 limestone:preset('Pitted limestone',{faceBlockSize:24,faceBlockHeight:1.8,faceRound:.55,faceBed:7,faceLedge:1.7,faceJoint:.8,faceWear:.8,faceCrease:3.5,faceCreaseSize:10,faceGrit:.25,faceScratch:1.8,faceScratchLength:90,faceLamina:.3,faceWet:.2,shineRock:.15,shineRockSharp:8},[[8,.75,0],[3,.4,1]]),
 gneiss:preset('Folded gneiss',{faceFold:22,faceRun:190,bedDipDir:25,faceBlockSize:32,faceBlockHeight:3,faceRound:.65,faceBlock:4.5,faceLedge:1.8,faceBed:8,faceLamina:.65,faceLaminaSize:4,faceStrata:.4,faceSpall:.35,faceJointTilt:30,faceGrit:.2,faceCrease:.2,faceMineral:.55,shineRock:.35},[[9,.9,0],[3,.3,1],[5,.75,2]]),
 schist:preset('Flaky schist',{stoneSlab:.9,stoneRound:.05,bedDip:.35,bedDipDir:20,faceFold:5,faceRun:110,faceStretch:3.5,faceBlockHeight:.5,faceBlockSize:24,faceBed:4,faceLedge:2.8,faceSpall:2.2,faceJointTilt:-32,faceJoint:1.1,faceRound:.1,faceLamina:.4,faceLaminaSize:3,faceMineral:.7,faceStrata:.3,shineRock:.5,shineRockSharp:40,shineRockRough:.3},[[3,.9,0],[2,.2,1],[2,.6,2]]),
 conglomerate:preset('Rounded conglomerate',{stoneRound:.95,stoneSlab:.05,faceClast:2.2,faceClastSize:14,faceRound:.95,faceBlock:1.3,faceBlockSize:32,faceBlockHeight:3,faceLedge:.4,faceLamina:0,faceJoint:.25,faceSpall:.25,faceMineral:.8,faceCrease:.35,faceBed:12,faceWear:.55,faceGrit:.15},[[14,.55,0],[5,.4,1]]),
 breccia:preset('Angular breccia',{stoneRound:.05,stoneSlab:.35,faceClast:3.5,faceClastSize:22,faceRound:.05,faceBlock:2.7,faceBlockSize:36,faceBlockHeight:3,faceLedge:.3,faceLamina:0,faceJoint:.8,faceSpall:.8,faceMineral:.75,faceCrease:.3,faceBed:14,faceWear:.15,faceGrit:.25,looseSize:10},[[16,.7,0]])
};
export const ROCK_KEYS=Object.keys(base);
const ranges=new Map(KNOBS.flatMap(([,rows])=>rows.map(([key,,lo,hi])=>[key,[lo,hi]])));
// Validate the entire recipe before changing the open scene. Unknown, removed
// fields are ignored, like the editor's other saved controls.
export function copyRockSettings(value){
 if(value==null)return null;
 if(typeof value!=='object'||Array.isArray(value))throw Error('Invalid rock settings.');
 const result={};
 for(const key of ROCK_KEYS)if(Object.hasOwn(value,key)){
  const n=value[key],[lo,hi]=ranges.get(key);
  if(typeof n!=='number'||!Number.isFinite(n)||n<lo||n>hi)throw Error(`Invalid rock setting: ${key}.`);
  result[key]=n;
 }
 return result;
}
export function rockPresetFor(values,column){
 return Object.entries(ROCK_PRESETS).find(([,p])=>ROCK_KEYS.every(k=>Math.abs(Number(values[k])-p.knobs[k])<1e-6)&&JSON.stringify(column?.sections)===JSON.stringify(p.sections))?.[0]||'';
}
