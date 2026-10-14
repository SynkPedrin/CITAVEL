import {spawnSync} from 'node:child_process';import path from 'node:path';import fs from 'node:fs';import {ROOT} from '../core/store.mjs';
// Instala os workflows V2 no container n8n: importa all.json, publica os CORE V2 (subworkflows precisam estar publicados no n8n 2.x)
// e despublica os CORE V1 antigos para não haver duas cadeias concorrentes.
const docker=process.env.DOCKER||'/Applications/Docker.app/Contents/Resources/bin/docker';const container=process.env.N8N_CONTAINER||'n8n';
function run(args,{optional=false}={}){const r=spawnSync(docker,args,{stdio:'inherit'});if(r.status!==0&&!optional)process.exit(r.status||1);return r.status===0;}
const all=JSON.parse(fs.readFileSync(path.join(ROOT,'workflows/all.json'),'utf8'));
run(['cp',path.join(ROOT,'workflows/all.json'),container+':/tmp/citavel-workflows-v2.json']);
run(['exec',container,'n8n','import:workflow','--input=/tmp/citavel-workflows-v2.json']);
for(const w of all.filter(w=>/^citavelCore\d\dV2$/.test(w.id)))run(['exec',container,'n8n','publish:workflow','--id='+w.id]);
const legacy=[];for(let i=0;i<=9;i++)legacy.push('citavelCore'+String(i).padStart(2,'0')+'V1');
for(const id of legacy)run(['exec',container,'n8n','unpublish:workflow','--id='+id],{optional:true});
console.log('Instalados '+all.length+' workflows V2. CORE V1 legados despublicados (se existiam). Reinicie o n8n se o CLI pedir: docker restart '+container);
