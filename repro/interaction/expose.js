localStorage.removeItem(WORLD_STORE); // Dedicated benchmark origin; never injected by the normal server.
window.interactionEditor={
 ready:()=>ready&&Boolean(mapCanvas),scene:scriptedScene,
 get canvas(){return mapCanvas;},get region(){return sculptRegion;},get renderer(){return renderer;},get nodes(){return nodes;},get config(){return config;},
 weather:()=>weatherState,refine:queueWeather,select:selectNode,knob:setKnob,
 async settle(){const start=performance.now();while(!ready||weatherState==='pending'){if(performance.now()-start>120000)throw Error('Refinement timeout');await new Promise(r=>setTimeout(r,30));}await Promise.race([mapCanvas.idle(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Canvas idle timeout; weather='+weatherState)),30000))]);await renderer.device.queue.onSubmittedWorkDone();},
 async capture(rect={x:0,y:0,width:1024,height:1024},scale=1){await this.settle();const bitmap=await mapCanvas.debugBake(rect,scale),c=new OffscreenCanvas(bitmap.width,bitmap.height);c.getContext('2d').drawImage(bitmap,0,0);bitmap.close();return c;},
 async heights(){await regionalFields.ready();return Array.from({length:128*128},(_,i)=>regionalFields.sample((i%128)*8,Math.floor(i/128)*8));}
};
