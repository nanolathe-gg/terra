import {HELP_TOOLS,HELP_CONTROLS,HELP_FRAME,helpFrames,helpTimeline,helpImage} from './sculpt-help-examples.js';
const element=(tag,cls,html='')=>{const e=document.createElement(tag);e.className=cls;e.innerHTML=html;return e;};
const controlHelp={
  'knob-plainRelief':'Fine bumps across level ground. These change the rendered surface, not the map heights used by units.',
  'knob-plantRelief':'Scales the height of grass tufts, moss cushions and shrubs in the art, wherever a surface layer grows them. Zero lays them flat.',
  'knob-sunTilt':'Moves the light north or south of due west. Zero is west; positive values move it south.',
  'knob-sunHeight':'How high the sun stands above the horizon. A low sun lights the faces turned to it, darkens the others and casts long shadows; a wall casts a shadow its height divided by the tangent of this angle. Set Cast shadow on level ground to let the shadows reach level ground.',
  'knob-ambient':'Sets the share of light that reaches faces pointing away from the sun.',
  'knob-absorbDepth':'For translucent rock such as ice or crystal: where the rock is thick, its color deepens toward its Absorption color (Rock types › Colors & recipe); thin edges keep their own color. Zero leaves the color as it is. It tints everything the shape covers, grass on its ledges included, and counts raised ground under the shape as part of the rock.',
  'knob-shadowTint':'How much sunlight the rock lets into the shadow it casts, in its Absorption color: a thick rock\u2019s shadow stays dim and tinted, a thin one\u2019s is lighter. Zero is an ordinary shadow. On level ground it shows only where Cast shadow on level ground is on.',
  'knob-lushness':'Changes how much vegetation the ground supports. On materials with flowers, richer ground can grow more flower patches.',
};

const toolHelp={landform:'A landform from the model\'s own starting numbers. Every landform setting is yours to shape.',plateau:'A broad, level top with steep sides. Draw its footprint, then shape the section below.',hill:'A rounded ridge with a gentle crest. The section sets its silhouette.',mountain:'A narrow, pointed crest. Draw a path to make a mountain range.',ramp:'An incline along a path. Edit length vs. height to control the climb.',deep:'Cut below sea level to make deep water.',shallow:'Cut a shallow shelf beneath the water.',valleyV:'A narrow, V-shaped cut into the terrain.',valleyU:'A broad valley with a rounded floor.',valleyT:'A valley with steps along its sides.',river:'A water channel following the path you draw. Bends build sand bars along their inside banks.',braided:'A mostly dry gravel bed with thin threads of water that split and rejoin around its bars.',crater:'A bowl with a raised rim.',fissure:'A narrow fracture cut into the ground.',crystal:'Clusters of faceted crystals, columns or blocks.',smooth:'Soften changes in height beneath the brush.',erase:'Bring terrain back toward the base ground.',sand:'Paint sand coverage onto the terrain.',grass:'Restore ground cover beneath the brush.',paint:'Paint materials and local surface effects with a dedicated brush.',move:'Select a shape to edit its curves, settings, paths or transform.',features:'Place metal deposits, vents, trees, shrubs, rocks and scars on the map.',starts:'Add, move and remove the players\u2019 start positions.'};

// Schematic illustrations stay available without downloaded preview assets.
// They explain silhouettes; they do not simulate or replace the GPU renderer.
function illustration(kind){
  let h=[0,2,13,29,42,48,42,29,13,2,0];
  if(['plateau','terraces','ledge'].includes(kind))h=[0,0,9,43,44,44,44,43,9,0,0];
  if(kind==='mountain')h=[0,1,6,20,38,65,38,20,6,1,0];
  if(kind==='ramp')h=[0,2,8,14,21,28,35,42,49,56,0];
  if(['deep','shallow','valleyV','valleyU','valleyT','river','braided','fissure','crater'].includes(kind))h=kind==='crater'?[0,8,22,2,-12,-18,-12,2,22,8,0]:[0,-2,-10,-23,-30,-32,-30,-23,-10,-2,0];
  if(kind==='crystal')h=[0,30,15,55,20,65,20,45,18,30,0];
  if(kind==='erase')h=h.map(v=>v*.1);
  const width=1;
  const pts=h.map((v,i)=>[130+(i-5)*18*width,100-v]);
  const back=pts.map(([x,y])=>[x+32,y-26]);
  const poly=p=>p.map(v=>v.join(',')).join(' '),water=['deep','shallow','river','braided'].includes(kind);
  return `<svg viewBox="0 0 300 160" aria-hidden="true"><path d="M12 132L220 132 282 78 74 78Z" fill="#1b302c" stroke="#38564a"/><polygon points="${poly([...pts,...back.slice().reverse()])}" fill="${water?'#487b98':'#739b79'}" stroke="#bdd6ae" stroke-width="1.5"/><polygon points="${poly([...pts,[pts.at(-1)[0],130],[pts[0][0],130]])}" fill="#334d40" stroke="#65846b"/><path d="M40 143h180" stroke="#577365" stroke-dasharray="3 5"/></svg>`;
}

export function mountHelp(){
  const tip=element('aside','visual-help');tip.id='visual-help';tip.hidden=true;tip.setAttribute('role','tooltip');document.body.append(tip);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const previews=fetch('ui-previews/manifest.json').then(r=>r.ok?r.json():null).catch(()=>null);
  let hoverTimer,frameTimer,owner,revision=0;
  const hide=()=>{clearTimeout(hoverTimer);clearTimeout(frameTimer);revision++;owner?.removeAttribute('aria-describedby');owner=null;tip.hidden=true;tip.replaceChildren();};
  const position=target=>{const r=target.getBoundingClientRect();tip.style.left=Math.max(8,Math.min(innerWidth-tip.offsetWidth-8,r.left<innerWidth/2?r.right+10:r.left-tip.offsetWidth-10))+'px';tip.style.top=Math.max(8,Math.min(innerHeight-tip.offsetHeight-8,r.top))+'px';};
  const show=target=>{
    clearTimeout(frameTimer);
    owner?.removeAttribute('aria-describedby');owner=target;const token=++revision;
    if(!target.isConnected||!target.getClientRects().length||document.hidden){hide();return;}
    // A shape tool's picture and words are its shape's (data-shape: a world's tool draws a shape of the library).
    // A map's own tool (Save as tool) shows its shape's sketch and says what it is: no rendered example draws its numbers.
    const tool=target.dataset.tool||target.dataset.icon,shape=target.dataset.shape||tool,own=target.dataset.mapTool!==undefined,control=target.closest('.control'),source=control?.querySelector('input[type=range],select'),key=source?.id;
    const label=tool?target.getAttribute('aria-label'):control?.querySelector('label')?.cloneNode(true);if(label instanceof Element)label.querySelector('output')?.remove();
    const name=typeof label==='string'?label:label?.textContent?.trim();if(!name){hide();return;}
    // A row's unit, or what it measures, is said here and not on the row (data-note).
    tip.replaceChildren(element('strong',''));tip.firstChild.textContent=name+(control?.dataset.note?` (${control.dataset.note})`:'');
    const example=HELP_CONTROLS[key],valid=()=>owner===target&&revision===token&&!tip.hidden&&target.isConnected&&target.getClientRects().length>0;
    if(tool||example){
      const art=element('div','help-art',tool?illustration(shape):''),caption=element('small','help-caption','Illustration');tip.append(art,caption);
      if(!tool){art.textContent='Loading preview…';caption.textContent='Same shape and seed throughout';}
      previews.then(index=>{
        if(!valid())return;
        const frames=example?helpFrames(example):null;
        const available=Boolean(index)&&(tool?!own&&HELP_TOOLS.includes(shape)&&index.tools?.includes(shape):frames?.every((f,i)=>index.controls?.[key]?.[i]?.value===f.value)&&index.controls[key].length===frames.length);
        const fallback=()=>{if(!valid())return;if(tool){art.innerHTML=illustration(shape);caption.textContent='Illustration';}else{art.remove();caption.remove();}position(target);};
        if(!available){fallback();return;}
        const url='ui-previews/'+helpImage(tool?{tool:shape}:{control:key}),image=new Image();
        image.alt=tool?name+' terrain example':'';
        image.onload=()=>{
          if(!valid())return;
          if(tool){art.replaceChildren(image);caption.textContent='Rendered example · Green Planet';return;}
          if(image.naturalWidth!==frames.length*HELP_FRAME.width||image.naturalHeight!==HELP_FRAME.height){fallback();return;}
          art.replaceChildren();art.setAttribute('role','img');art.setAttribute('aria-label',name+', from '+frames[0].label+' to '+frames.at(-1).label);
          caption.textContent=frames[0].label+' ↔ '+frames.at(-1).label+' · same seed';
          const sprite=()=>{const s=element('div','help-sprite'),value=element('span','help-frame-label');value.setAttribute('aria-hidden','true');s.append(value);s.style.backgroundImage='url("'+url+'")';s.style.backgroundSize=(frames.length*100)+'% 100%';return s;};
          const paint=(s,i)=>{s.style.backgroundPositionX=(100*i/(frames.length-1))+'%';s.dataset.frame=String(i);s.firstChild.textContent=frames[i].label;};
          if(reduced.matches){
            art.classList.add('help-pair');for(const i of [0,frames.length-1]){const s=sprite();paint(s,i);art.append(s);}
          }else{
            const s=sprite(),timeline=helpTimeline(frames.length);let tick=0;art.append(s);
            const advance=()=>{if(!valid()||document.hidden)return;paint(s,timeline[tick++%timeline.length]);frameTimer=setTimeout(advance,HELP_FRAME.ms);};advance();
          }
          position(target);
        };
        image.onerror=fallback;image.src=url;
      });
    }
    const help=element('p','');
    help.textContent=(own?'A tool saved in this map. It draws new shapes with the settings, curves and rock of the shape it was saved from.':target.dataset.help||toolHelp[shape])||(source?.disabled&&(control?.querySelector('.control-requirement')?.textContent||source.title))||controlHelp[key]||control?.querySelector('p.small')?.textContent||'Adjust this setting to change the terrain.';
    tip.append(help);
    if(!tool&&!source?.disabled)tip.append(element('small','','Click: set · Double-click: type · Drag: adjust · Shift: fine'));
    target.setAttribute('aria-describedby',tip.id);tip.hidden=false;position(target);
  };
  const target=e=>e.target instanceof Element&&!e.target.matches('.scrub-entry')?e.target.closest('.tool-palette button:not(.rail-button),.scrub,.control > select'):null;
  document.addEventListener('pointerover',e=>{const t=target(e);if(!t||e.buttons||t.contains(e.relatedTarget))return;hide();hoverTimer=setTimeout(()=>show(t),500);});
  document.addEventListener('pointerout',e=>{const t=target(e);if(t&&!t.contains(e.relatedTarget))hide();});
  document.addEventListener('focusin',e=>{const t=target(e);if(t){hide();hoverTimer=setTimeout(()=>show(t),500);}});document.addEventListener('focusout',hide);
  document.addEventListener('pointerdown',hide);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!tip.hidden){e.preventDefault();e.stopPropagation();hide();}});
  document.addEventListener('scroll',hide,true);document.addEventListener('visibilitychange',()=>{if(document.hidden)hide();});
  reduced.addEventListener('change',()=>{if(owner)show(owner);});
}
