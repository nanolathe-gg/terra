// Flow planes stay in the v5 recipe for sketch files. Server documents keep
// their encoded bytes in independently replaced chunks, so one bake cannot
// overflow the small metadata endpoint or rewrite an unchanged bake. Content
// keys are immutable: a failed new save leaves the previous recipe intact.
const CHUNK_BYTES=4*1024*1024;
export async function storeDocumentBakes(sketch,write){
  const nodes=[];
  for(const node of sketch.nodes??[]){
    if(node.kind!=='flowbake'||!node.result?.planes){nodes.push(node);continue;}
    const {planes,...result}=node.result,planeChunks=[];
    for(const text of planes){
      const refs=[];for(let offset=0;offset<text.length;offset+=CHUNK_BYTES){const bytes=new TextEncoder().encode(text.slice(offset,offset+CHUNK_BYTES)),digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),key='flow_'+Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');await write(key,bytes);refs.push(key);}planeChunks.push(refs);
    }nodes.push({...node,result:{...result,planeChunks}});
  }return{...sketch,nodes};
}
export async function loadDocumentBakes(sketch,read){
  const nodes=[];
  for(const node of sketch.nodes??[]){
    if(node.kind!=='flowbake'||!node.result?.planeChunks){nodes.push(node);continue;}
    const {planeChunks,...result}=node.result;
    if(planeChunks.length!==5||planeChunks.some(keys=>!Array.isArray(keys)||keys.some(key=>typeof key!=='string')))throw new Error('The server document has invalid flow plane references.');
    const planes=[];for(const keys of planeChunks){const pieces=[];for(const key of keys)pieces.push(await read(key));planes.push(pieces.join(''));}nodes.push({...node,result:{...result,planes}});
  }return{...sketch,nodes};
}
