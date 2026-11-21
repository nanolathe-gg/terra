import {WORLD_HELP} from './sculpt-world-help.js';
import {EDITOR_HELP, featureParameterHelp} from './sculpt-editor-help.js';
import {HELP_TOOLS,HELP_FRAME,helpTimeline,helpImage} from './sculpt-help-examples.js';
const element=(tag,cls,html='')=>{const e=document.createElement(tag);e.className=cls;e.innerHTML=html;return e;};
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
  let hoverTimer,frameTimer,owner,trigger,revision=0;
  const describe=(target, add)=>{
    if(!target)return;
    const ids=(target.getAttribute('aria-describedby')||'').split(/\s+/).filter(id=>id&&id!==tip.id);
    if(add)ids.push(tip.id);
    if(ids.length)target.setAttribute('aria-describedby',ids.join(' '));else target.removeAttribute('aria-describedby');
  };
  const hide=()=>{clearTimeout(hoverTimer);clearTimeout(frameTimer);revision++;describe(owner,false);owner=null;trigger=null;tip.hidden=true;tip.replaceChildren();};
  // A tool in a rail flyout takes its card beside the flyout, not over the flyout's other tools.
  const position=target=>{const r=target.getBoundingClientRect(),a=(target.closest('.tool-flyout')||target).getBoundingClientRect();tip.style.left=Math.max(8,Math.min(innerWidth-tip.offsetWidth-8,a.left<innerWidth/2?a.right+10:a.left-tip.offsetWidth-10))+'px';tip.style.top=Math.max(8,Math.min(innerHeight-tip.offsetHeight-8,r.top))+'px';};
  const show=target=>{
    clearTimeout(frameTimer);
    describe(owner,false);owner=target;const token=++revision;
    if(!target.isConnected||!target.getClientRects().length||document.hidden){hide();return;}
    const container=target.closest('dialog:modal')||document.body;
    if(tip.parentElement!==container)container.append(tip);
    const tool=target.dataset.tool||target.dataset.icon,shape=target.dataset.shape||tool,own=target.dataset.mapTool!==undefined;
    const control=target.closest('.control');
    const source=target.matches('.scrub')?document.getElementById(target.dataset.source):target;
    if(!source){hide();return;}
    const key=source.id, knob=control?.dataset.knob;
    const label=(source.labels?.[0]||control?.querySelector('label'))?.cloneNode(true);
    label?.querySelectorAll('output, input, select, textarea, button').forEach(node=>node.remove());
    const name=target.getAttribute('aria-label')||label?.textContent.trim()||target.getAttribute('placeholder')||(target.matches('select')?target.selectedOptions[0]?.textContent:target.textContent.trim())||target.title;
    const inline=control?.querySelector('p.small:not([data-requirement])')?.textContent.trim();
    const feature=featureParameterHelp(source.dataset.paramKind,source.dataset.param);
    const help=own?'Draw with the settings, curves and rock saved from a shape in this map.':
      target.dataset.help||source.dataset.help||WORLD_HELP[knob]||feature||EDITOR_HELP[key]||toolHelp[shape]||inline||target.title||source.labels?.[0]?.title;
    const disabled=target.getAttribute('aria-disabled')==='true'||source.matches(':disabled');
    const reason=disabled&&(control?.querySelector('.control-requirement, [data-requirement]')?.textContent.trim()||source.title);
    if(!name||!(help||reason)){hide();return;}
    // These are examples from authored fixtures, independent of the open map.
    tip.replaceChildren(element('strong',''));tip.firstChild.textContent=name+(control?.dataset.note?` (${control.dataset.note})`:'');
    const example=!tool&&source.matches('input,select');
    const valid=()=>owner===target&&revision===token&&!tip.hidden&&target.isConnected&&target.getClientRects().length>0;
    // A tool's own picture, drawn in this map's world (sculpt-thumbnails.js, on its button once drawn), comes before the shape's Green example.
    const live=tool?target.querySelector('.tool-pic')?.getAttribute('src'):null;
    if(live?.startsWith('data:image/webp;base64,')){
      const art=element('div','help-art'),image=new Image();image.alt=name+' terrain example';image.src=live;art.append(image);
      tip.append(art,element('small','help-caption','Rendered in this map’s world'));
    }
    else if(tool||example){
      const art=element('div','help-art',tool?illustration(shape):''),caption=element('small','help-caption','Illustration');
      if(tool)tip.append(art,caption);
      previews.then(index=>{
        if(!valid())return;
        const frames=index?.controls?.[source.dataset.preview||key];
        const available=tool?!own&&HELP_TOOLS.includes(shape)&&index?.tools?.includes(shape):frames?.length>1;
        const fallback=()=>{if(!valid())return;if(tool){art.innerHTML=illustration(shape);caption.textContent='Illustration';}else{art.remove();caption.remove();}position(target);};
        if(!available){fallback();return;}
        const url='ui-previews/'+helpImage(tool?{tool:shape}:{control:source.dataset.preview||key}),image=new Image();
        image.alt=tool?name+' terrain example':'';
        image.onload=()=>{
          if(!valid())return;
          if(tool){art.replaceChildren(image);caption.textContent='Rendered example · Green Planet';position(target);return;}
          if(image.naturalWidth!==frames.length*HELP_FRAME.width||image.naturalHeight!==HELP_FRAME.height){fallback();return;}
          tip.querySelector('strong').after(art,caption);
          art.replaceChildren();art.setAttribute('role','img');art.setAttribute('aria-label',name+', from '+frames[0].label+' to '+frames.at(-1).label);
          caption.textContent='Same terrain fixture · '+frames[0].label+' ↔ '+frames.at(-1).label;
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
    if(help){const text=element('p','');text.textContent=help;tip.append(text);}
    if(reason&&reason!==help){const text=element('p','help-requirement');text.textContent=reason;tip.append(text);}
    if(target.matches('.scrub')&&!disabled)tip.append(element('small','','Drag to adjust · Shift for fine steps · Enter or double-click to type'));
    describe(target,true);tip.hidden=false;position(target);
  };
  const target=e=>{
    if(!(e.target instanceof Element)||e.target.matches('.scrub-entry'))return null;
    const t=e.target.closest('.scrub, input, select, textarea, button, summary, canvas[id], canvas[title], canvas[data-help], a[data-help]');
    if(!t)return null;
    return t.matches('.tool-palette button:not(.rail-button), .scrub, .control > select, canvas[title], [data-help]')||Object.hasOwn(EDITOR_HELP,t.id)||t.title||t.labels?.[0]?.title?t:null;
  };
  const queue=(t,kind)=>{hide();trigger=kind;hoverTimer=setTimeout(()=>show(t),500);};
  document.addEventListener('pointerover',e=>{const t=target(e);if(t&&!e.buttons&&!t.contains(e.relatedTarget))queue(t,'pointer');});
  document.addEventListener('pointerout',e=>{const t=target(e);if(trigger==='pointer'&&t&&!t.contains(e.relatedTarget))hide();});
  // Keyboard focus only: a click also focuses its button, and the card it opened stayed over the menu that click opened.
  document.addEventListener('focusin',e=>{const t=target(e);if(t&&e.target.matches(':focus-visible'))queue(t,'focus');});
  document.addEventListener('focusout',e=>{if(trigger==='focus'&&target(e))hide();});
  document.addEventListener('pointerdown',hide);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!tip.hidden){e.preventDefault();e.stopPropagation();hide();}},true);
  document.addEventListener('scroll',()=>{if(trigger==='focus'){if(owner)position(owner);}else hide();},true);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)hide();});
  reduced.addEventListener('change',()=>{if(owner)show(owner);});
}
