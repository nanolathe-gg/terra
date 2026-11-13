localStorage.removeItem(WORLD_STORE); // Isolated audit origin only; compare preset defaults.
// Injected only by the Go audit host on ?audit pages. No production entry point.
const tickAudit=()=>new Promise(r=>setTimeout(r,40));
window.terraformAudit={
 async ready(){const t=performance.now();while(!ready||!mapCanvas){if(performance.now()-t>90000)throw Error('Editor boot timeout');await tickAudit();}mapCanvas.setBusy(true);},
 async idle(){const t=performance.now();while(weatherState!=='ready'&&weatherOn()){if(performance.now()-t>90000)throw Error('Refinement timeout '+weatherState);await tickAudit();}document.body.dataset.auditPhase='canvas';await mapCanvas.idle();document.body.dataset.auditPhase='GPU';await renderer.device.queue.onSubmittedWorkDone();document.body.dataset.auditPhase='idle';},
 scene:scriptedScene,
 async select(i){selectNode(i);await this.idle();},
 async edit(i,values){selectNode(i);changeSelected(n=>{n.params={...n.params,...values};});await this.idle();},
 async exportPreview(){mapCanvas.setBusy(false);mapCanvas.zoom('overview');await this.idle();},defaults:toolDefaults,params:strokeParams,fields:SHAPE_FIELDS,knobs:KNOBS,
 panelValues:worldPanelValues,get features(){return mapFeatures;},get metadata(){return mapMetadata;},setBusy:on=>mapCanvas.setBusy(on),get config(){return config;},get device(){return renderer.device;},get renderer(){return renderer;},get nodes(){return nodes;},
 async control(id,value){const e=$(id);if(e.type==='checkbox')e.checked=Boolean(value);else e.value=String(value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));await this.idle();},
 async knob(key,value){setKnob(key,value);if(['erosion','erosionAge','erosionRain','erosionEnvelope'].includes(key)){cancelWeather();queueWeather();}await this.idle();},
 async capture(rect={x:0,y:0,width:1024,height:1024},level=1){await this.idle();const t=performance.now(),bitmap=await mapCanvas.debugBake(rect,level);await renderer.device.queue.onSubmittedWorkDone();const ms=performance.now()-t,c=new OffscreenCanvas(rect.width,rect.height),g=c.getContext('2d');g.drawImage(bitmap,0,0,rect.width,rect.height);return {canvas:c,ms};},
 async heights(rect={x:0,y:0,width:1024,height:1024}){await this.idle();await gpuWeatherCpu(false);const out=[];for(let y=rect.y;y<rect.y+rect.height;y+=2)for(let x=rect.x;x<rect.x+rect.width;x+=2)out.push(sampleRegional(x,y));return {grid:rect.width/2,sea:config.seaLevel,heights:out};},
 async view(){mapCanvas.zoom(.5);mapCanvas.resize();await this.idle();},
 stats:()=>({weatherState,gpuErosionMs,canvas:mapCanvas.stats(),shape:regionalFields.stats()}),
 async comparePages(){return window.sculptDebug.pagedShapeCompare({x0:0,y0:0,x1:255,y1:255});}
};

if(experiment.has('auditScene'))(async()=>{
 await window.terraformAudit.ready();
 const scenes=await (await fetch('/audit/scenes.json')).json(),scene=scenes[experiment.get('auditScene')];
 if(!scene)throw Error('Unknown audit review scene');
 scriptedScene(scene.strokes,{ground:scene.ground!==false});await window.terraformAudit.idle();
 mapCanvas.setBusy(false);mapCanvas.zoom(1);$('viewport').scrollLeft=0;$('viewport').scrollTop=0;mapCanvas.schedule();
 document.body.dataset.auditReview='ready';
})().catch(e=>error(e.message));
