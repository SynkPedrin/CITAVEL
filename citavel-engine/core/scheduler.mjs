import fs from 'node:fs/promises';import path from 'node:path';
import {ROOT,loadState,saveState,loadConfig,withClientLock,redactError} from './store.mjs';
import {executePipeline} from './engine.mjs';
const TZ='America/Sao_Paulo';
function spParts(date){return Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));}
const DOW={Mon:0,Tue:1,Wed:2,Thu:3,Fri:4,Sat:5,Sun:6};
// Segunda-feira (YYYY-MM-DD) da semana corrente no fuso de São Paulo — chave do lote semanal.
export function spWeekKey(date=new Date()){const p=spParts(date);const d=new Date(Date.UTC(+p.year,+p.month-1,+p.day));d.setUTCDate(d.getUTCDate()-DOW[p.weekday]);return d.toISOString().slice(0,10);}
// Instante (UTC) de segunda 09:00 em São Paulo da semana corrente.
function mondayNine(date){return new Date(spWeekKey(date)+'T12:00:00Z');}
// Janela original (segunda 09h). Mantida para compatibilidade.
export function weeklyWindow(date=new Date()){const p=spParts(date);return p.weekday==='Mon'&&p.hour==='09';}
// O ciclo da semana é devido a partir de segunda 09h (SP) até o fim da semana: se o computador/Docker
// estava desligado na segunda, o ciclo pendente roda assim que o serviço voltar (catch-up).
export function weeklyDue(date=new Date()){return date.getTime()>=mondayNine(date).getTime();}
const RETRY_MS=60*60*1000,STALE_MS=2*60*60*1000,MAX_ATTEMPTS=3;
// Decide se o cliente precisa do WEEKLY desta semana. Retorna {run, reason, attempts}.
export function weeklyDecision(s,batch,date=new Date()){const sch=s.scheduler||{};const monday=mondayNine(date).getTime();
 if(sch.last_week===batch){
  if(sch.status==='RUNNING'&&date.getTime()-Date.parse(sch.started_at||0)>STALE_MS)return {run:true,reason:'STALE_RUNNING',attempts:(sch.attempts||1)+1};
  if(sch.status==='ERROR'&&(sch.attempts||1)<MAX_ATTEMPTS&&date.getTime()-Date.parse(sch.finished_at||sch.started_at||0)>RETRY_MS)return {run:true,reason:'RETRY_AFTER_ERROR',attempts:(sch.attempts||1)+1};
  return {run:false,reason:'ALREADY_DONE'};}
 // Onboarding/baseline executado nesta mesma semana já cobre o ciclo: não duplica testes LAB.
 if((s.ai_runs||[]).some(r=>r.batch_id==='baseline-v1'&&Date.parse(r.timestamp)>=monday))return {run:false,reason:'COVERED_BY_BASELINE'};
 return {run:true,reason:sch.last_week?'WEEKLY_DUE':'FIRST_WEEKLY',attempts:1};}
let ticking=false;
export async function schedulerTick(date=new Date()){if(ticking||!weeklyDue(date))return [];ticking=true;const results=[];try{const batch=spWeekKey(date);const dirs=await fs.readdir(path.join(ROOT,'clients'),{withFileTypes:true});for(const d of dirs){if(!d.isDirectory()||d.name.startsWith('_')||d.name.startsWith('.'))continue;let c;try{c=await loadConfig(d.name);}catch{continue;}if(c.automation?.weekly_monitoring!==true)continue;
 const claim=await withClientLock(c.client_id,async()=>{const s=await loadState(c.client_id);const decision=weeklyDecision(s,batch,date);if(!decision.run){if(decision.reason==='COVERED_BY_BASELINE'){s.scheduler={last_week:batch,status:'COVERED_BY_BASELINE',started_at:date.toISOString(),finished_at:date.toISOString(),attempts:0};await saveState(c.client_id,s);}return null;}s.scheduler={last_week:batch,status:'RUNNING',started_at:new Date().toISOString(),attempts:decision.attempts,trigger:decision.reason};await saveState(c.client_id,s);return decision;});
 if(!claim)continue;let result;try{result=await executePipeline({client_id:c.client_id,mode:'WEEKLY',batch_id:batch});}catch(e){result={status:'ERROR',error:redactError(e)};}
 await withClientLock(c.client_id,async()=>{const s=await loadState(c.client_id);s.scheduler={...s.scheduler,status:result.status==='ERROR'?'ERROR':result.status,error:result.error||null,finished_at:new Date().toISOString()};await saveState(c.client_id,s);});results.push({client_id:c.client_id,status:result.status,trigger:claim.reason});}}finally{ticking=false;}return results;}
export function startScheduler(){const tick=()=>schedulerTick().catch(()=>{});setTimeout(tick,15000).unref();const timer=setInterval(tick,60000);timer.unref();return timer;}
