import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
process.env.CITAVEL_ROOT=await fs.mkdtemp(path.join(os.tmpdir(),'citavel-action-'));
const {createClient,loadState,saveState,clientDir,atomicWrite}=await import('../core/store.mjs');
const {decideAction,executeAction,publishAction,measureActions,transition}=await import('../core/action-engine.mjs');
const {ADAPTERS}=await import('../core/publish.mjs');
const {generateActions}=await import('../core/intelligence.mjs');
const {executeStage}=await import('../core/engine.mjs');
const git=promisify(execFile);
const iso=ms=>new Date(ms).toISOString();

async function seed(id,options={}){await createClient(id,{brand:'Fixture',domain:'https://fixture.example/',...options});const s=await loadState(id);s.prompts=[{prompt_id:'p-buy',prompt:'Qual empresa contratar?',cluster:'PURCHASE',intent:'PURCHASE',commercial_score:5,active:true},{prompt_id:'p-learn',prompt:'O que avaliar?',cluster:'INFORMATIONAL',intent:'INFORMATIONAL',commercial_score:1,active:true}];await saveState(id,s);return s;}
function makeAction(state,overrides={}){const gap={gap_id:'gap-1',client_id:state.client.client_id,run_type:'GOLDEN',prompt_id:'p-buy',gap_type:'EVIDENCE_GAP',severity:'HIGH',confidence:0.8,commercial_score:5,source_run_ids:['r1'],created_at:'2026-09-01T00:00:00.000Z',needs_validation:false};return {...generateActions([gap],state.prompts,[])[0],...overrides};}
async function putAction(id,action,extra={}){const s=await loadState(id);s.actions=[action];Object.assign(s,extra);await saveState(id,s);return action;}
const run=(id,over)=> ({run_id:over.run_id,client_id:id,prompt_id:'p-buy',run_type:over.run_type||'GOLDEN',valid:true,timestamp:over.timestamp,platform:'ChatGPT',brand_mentioned:!!over.mentioned,brand_recommended:!!over.recommended,approx_position:null,citations:[],competitors:[],owned_domain_cited:false});

test('new actions carry contract fields and transitions are enforced and recorded',async()=>{const s=await seed('qa-decide');const action=makeAction(s);
 assert.equal(action.action_type,'CONTENT');assert.equal(action.automation_level,'APPROVAL_REQUIRED');assert.equal(action.approval_required,true);assert.equal(action.risk,'LOW');
 assert.deepEqual(action.affected_prompts,['p-buy']);assert.equal(action.preview,null);assert.equal(action.execution,null);assert.equal(action.deployment,null);
 assert.equal(action.lifecycle.length,1);assert.equal(action.lifecycle[0].status,'PROPOSED');
 await putAction('qa-decide',action);
 assert.throws(()=>transition({status:'PROPOSED',lifecycle:[]},'PUBLISHED'),/INVALID_TRANSITION/);
 const rejected=await decideAction('qa-decide',action.action_id,{decision:'REJECT',actor:'qa',note:'Fora de escopo.'});
 assert.equal(rejected.action.status,'REJECTED');assert.equal(rejected.action.lifecycle.at(-1).note,'Fora de escopo.');assert.equal(rejected.action.lifecycle.at(-1).actor,'qa');
 await assert.rejects(decideAction('qa-decide',action.action_id,{decision:'APPROVE'}),/INVALID_TRANSITION/);
 await assert.rejects(decideAction('qa-decide',action.action_id,{decision:'MAYBE'}),/DECISION_INVALID/);
 const persisted=(await loadState('qa-decide')).actions[0];assert.equal(persisted.status,'REJECTED');assert.equal(persisted.lifecycle.length,2);});

test('legacy OPEN actions migrate to PROPOSED on read and gain contract defaults',async()=>{const s=await seed('qa-open');const action=makeAction(s);
 delete action.lifecycle;delete action.action_type;delete action.automation_level;delete action.approval_required;delete action.risk;delete action.preview;delete action.execution;delete action.deployment;
 action.status='OPEN';await putAction('qa-open',action);
 const {action:updated}=await decideAction('qa-open',action.action_id,{decision:'APPROVE',actor:'qa'});
 assert.equal(updated.status,'APPROVED');assert.equal(updated.automation_level,'APPROVAL_REQUIRED');
 assert.match(updated.lifecycle[0].note,/Migra/);assert.equal(updated.lifecycle.at(-1).status,'APPROVED');});

test('CONTENT execute: draft is evidence-locked, human fill reaches READY_TO_PUBLISH, rerun is idempotent',async()=>{const s=await seed('qa-exec');
 const evidence=[{evidence_id:'ev1',claim:'Fato público',value:'Confirmado por teste',source_url:'https://fixture.example/doc',verified:true,public_allowed:true}];
 const action=makeAction(s);await putAction('qa-exec',action,{evidence});
 await decideAction('qa-exec',action.action_id,{decision:'APPROVE',actor:'qa'});
 const first=await executeAction('qa-exec',action.action_id,{actor:'qa'});
 assert.equal(first.action.status,'NEEDS_INFORMATION');assert.equal(first.validation.evidence_ok,false);assert.ok(first.validation.missing.length>0);
 assert.ok(first.validation.links_ok);assert.ok(first.validation.schema_ok);
 const pageId=first.action.execution.page_id;assert.ok(pageId);assert.equal(first.action.preview.missing_information,true);
 const state=await loadState('qa-exec');const page=state.pages.find(p=>p.page_id===pageId);assert.ok(page?.slug);
 const file=path.join(clientDir('qa-exec'),'pages/drafts',page.slug+'.html');
 const filled=(await fs.readFile(file,'utf8')).replaceAll('[INFORMAÇÃO NECESSÁRIA]','informação preenchida pelo revisor');await atomicWrite(file,filled);
 const second=await executeAction('qa-exec',action.action_id,{actor:'qa'});
 assert.equal(second.action.status,'READY_TO_PUBLISH');assert.equal(second.validation.evidence_ok,true);assert.deepEqual(second.validation.missing,[]);
 assert.equal(second.action.execution.page_id,pageId);assert.equal(second.action.preview.missing_information,false);
 assert.equal(second.action.preview.slug,page.slug);assert.ok(second.action.preview.title);assert.ok(second.action.preview.meta_description);assert.ok(second.action.preview.h1);
 assert.equal(second.action.preview.faq_count,3);assert.deepEqual(second.action.preview.evidence_ids,['ev1']);assert.deepEqual(second.action.preview.schema_types,['WebPage']);
 assert.ok(second.action.preview.url_desired.startsWith('https://fixture.example/'));
 assert.ok(second.action.execution.log.some(e=>e.step==='draft'&&e.status==='REUSED'));
 const third=await executeAction('qa-exec',action.action_id,{actor:'qa'});
 assert.equal(third.idempotent,true);assert.equal(third.action.status,'READY_TO_PUBLISH');assert.equal(third.action.execution.page_id,pageId);
 assert.equal((await loadState('qa-exec')).pages.filter(p=>p.action_id===action.action_id).length,1);});

test('CONTENT execute without usable evidence reports NEEDS_INFORMATION with explicit gaps',async()=>{const s=await seed('qa-miss');
 const action=makeAction(s);action.status='APPROVED';action.lifecycle=[{status:'PROPOSED',at:iso(Date.now()),actor:'engine',note:''},{status:'APPROVED',at:iso(Date.now()),actor:'qa',note:''}];
 await putAction('qa-miss',action);
 const {action:updated,validation}=await executeAction('qa-miss',action.action_id,{actor:'qa'});
 assert.equal(updated.status,'NEEDS_INFORMATION');assert.equal(validation.evidence_ok,false);
 assert.ok(validation.missing.some(m=>/Disponibilidade/.test(m)));assert.deepEqual((await loadState('qa-miss')).pages[0].status,'DRAFT');});

test('HUMAN_ACTION actions never execute: approval prepares a human package',async()=>{const s=await seed('qa-human');
 const action=makeAction(s,{action_type:'SOURCE',automation_level:'HUMAN_ACTION',type:'AUTHORITY'});await putAction('qa-human',action);
 const {action:decided}=await decideAction('qa-human',action.action_id,{decision:'APPROVE',actor:'qa'});
 assert.equal(decided.status,'NEEDS_HUMAN_ACTION');
 assert.deepEqual(decided.lifecycle.map(e=>e.status),['PROPOSED','WAITING_APPROVAL','NEEDS_HUMAN_ACTION']);
 assert.ok(decided.execution.package.brief);assert.ok(decided.execution.package.pitch);assert.equal(decided.preview,null);
 const again=await executeAction('qa-human',action.action_id,{actor:'qa'});
 assert.equal(again.action.status,'NEEDS_HUMAN_ACTION');assert.equal((await loadState('qa-human')).pages.length,0);});

test('publish without adapter keeps READY_TO_PUBLISH with BLOCKED_NO_ACCESS and never fakes it',async()=>{const s=await seed('qa-blocked');
 const action=makeAction(s,{status:'READY_TO_PUBLISH',execution:{page_id:'pg1',status:'READY',log:[]}});
 await putAction('qa-blocked',action);
 const {action:updated,deployment}=await publishAction('qa-blocked',action.action_id,{actor:'qa'});
 assert.equal(updated.status,'READY_TO_PUBLISH');assert.equal(deployment.status,'BLOCKED_NO_ACCESS');assert.match(deployment.note,/config\.publishing/);assert.ok(!deployment.commit);});

async function gitRepo(){const repo=await fs.mkdtemp(path.join(os.tmpdir(),'citavel-repo-'));const g=(...a)=>git('git',['-C',repo,...a]);await g('init','-b','main');await g('config','user.email','qa@example.com');await g('config','user.name','QA');await fs.writeFile(path.join(repo,'README.md'),'fixture');await g('add','.');await g('commit','-m','init');return {repo,g};}

test('git_static writes file+commit on citavel branch, never main, and validation gates PUBLISHED',async()=>{const {repo,g}=await gitRepo();
 const publishing={adapter:'git_static',repo_path:repo,base_path:'public/p',url_base:'https://fixture.example/p',branch_prefix:'citavel/',auto_push:false};
 const s=await seed('qa-git',{publishing});
 const action=makeAction(s,{status:'READY_TO_PUBLISH',execution:{page_id:'pg1',status:'READY',log:[]}});
 const page={page_id:'pg1',slug:'guia-teste',title:'Guia Teste',action_id:action.action_id,status:'DRAFT'};
 const runs=[run('qa-git',{run_id:'g1',timestamp:iso(Date.now()-20*864e5)}),run('qa-git',{run_id:'g2',timestamp:iso(Date.now()-15*864e5),mentioned:true})];
 await putAction('qa-git',action,{pages:[page],ai_runs:runs});
 await atomicWrite(path.join(clientDir('qa-git'),'pages/drafts/guia-teste.html'),'<!doctype html><title>Guia Teste</title><h1>Guia Teste</h1><p>conteúdo completo</p>');
 const notFound=async()=>({status:404,text:'not found'});
 const pending=await publishAction('qa-git',action.action_id,{actor:'qa',fetch:notFound});
 assert.equal(pending.action.status,'READY_TO_PUBLISH');assert.equal(pending.deployment.status,'DEPLOY_PENDING_VALIDATION');
 assert.match(pending.deployment.branch,/^citavel\/qa-git-/);assert.ok(pending.deployment.commit);assert.equal(pending.deployment.pushed,false);
 const branch=pending.deployment.branch;const commit1=pending.deployment.commit;
 const files=await fs.readFile(path.join(repo,'public/p/guia-teste.html'),'utf8');assert.match(files,/Guia Teste/);
 assert.match((await g('log','-1','--format=%s',branch)).stdout.trim(),new RegExp('^\\[CITAVEL-'+action.action_id+'\\]'));
 assert.equal((await g('rev-list','--count','main')).stdout.trim(),'1');
 assert.deepEqual(pending.deployment.baseline_snapshot.GOLDEN.runs,2);
 const serving=async()=>({status:200,text:'<!doctype html><title>Guia Teste</title><h1>Guia Teste</h1>'});
 const published=await publishAction('qa-git',action.action_id,{actor:'qa',fetch:serving});
 assert.equal(published.action.status,'PUBLISHED');assert.equal(published.deployment.status,'PUBLISHED');assert.ok(published.deployment.published_at);
 assert.equal(published.deployment.commit,commit1,'publish repetido não duplica commit');
 const after=await loadState('qa-git');
 assert.equal(after.pages[0].status,'PUBLISHED');assert.equal(after.pages[0].url,'https://fixture.example/p/guia-teste.html');
 await fs.access(path.join(clientDir('qa-git'),'pages/published/guia-teste.html'));
 const third=await publishAction('qa-git',action.action_id,{actor:'qa',fetch:serving});
 assert.equal(third.idempotent,true);
 assert.equal((await g('rev-list','--count',branch)).stdout.trim(),'2');});

test('git_static refuses foreign url_base, non-repo path and dirty working tree',async()=>{const {repo,g}=await gitRepo();
 const base={adapter:'git_static',repo_path:repo,base_path:'public/p',url_base:'https://fixture.example/p',branch_prefix:'citavel/'};
 const client={client_id:'qa-sec',domain:'https://fixture.example/',publishing:base};
 assert.equal((await ADAPTERS.git_static.check(client)).ok,true);
 assert.match((await ADAPTERS.git_static.check({...client,publishing:{...base,url_base:'https://evil.example/p'}})).detail,/CLIENT_DOMAIN/);
 assert.match((await ADAPTERS.git_static.check({...client,publishing:{...base,repo_path:path.join(repo,'nope')}})).detail,/GIT_REPO|DIRECTORY/);
 assert.match((await ADAPTERS.git_static.check({...client,publishing:{...base,base_path:'../escape'}})).detail,/BASE_PATH/);
 await fs.writeFile(path.join(repo,'dirty.txt'),'uncommitted');
 await assert.rejects(ADAPTERS.git_static.publish({page:{slug:'x'},html:'<p>x</p>',action:{action_id:'act_1',title:'t'},config:client}),/DIRTY/);
 await fs.rm(path.join(repo,'dirty.txt'));
 await assert.rejects(ADAPTERS.git_static.publish({page:{slug:'../escape'},html:'<p>x</p>',action:{action_id:'act_1',title:'t'},config:client}),/SLUG_INVALID/);
 const result=await ADAPTERS.git_static.publish({page:{slug:'ok-page'},html:'<p>ok</p>',action:{action_id:'act_abc123',title:'Teste'},config:client});
 assert.match(result.branch,/^citavel\//);assert.notEqual(await g('-C',repo,'branch','--show-current').then(r=>r.stdout.trim()).catch(()=>''),'main');
 assert.deepEqual(result.rollback,{strategy:'git_revert',commit:result.commit});});

test('ActionResult: TOO_EARLY, INSUFFICIENT_DATA, POSITIVE_SIGNAL→MEASURED, LAB never pools into GOLDEN',async()=>{const s=await seed('qa-mon');
 const baseline={mention:0,recommendation:0,citation:0,runs:2};
 const action=makeAction(s,{status:'PUBLISHED',run_type:'GOLDEN',lifecycle:[{status:'PUBLISHED',at:iso(Date.now()),actor:'qa',note:''}],
  deployment:{adapter:'git_static',status:'PUBLISHED',published_at:iso(Date.now()),url:'https://fixture.example/p/x.html',baseline_snapshot:{GOLDEN:baseline,LAB:baseline}}});
 const state=await putAction('qa-mon',action).then(()=>loadState('qa-mon'));
 let measured=measureActions(state,new Date());
 assert.equal(measured,1);assert.equal(state.actions[0].status,'MONITORING');
 assert.equal(state.action_results.length,1);assert.equal(state.action_results[0].result_status,'TOO_EARLY');assert.equal(state.action_results[0].window,'D1');
 const sameDay=measureActions(state,new Date());assert.equal(state.action_results.length,1,'re-MONITOR no mesmo dia é idempotente');
 state.actions[0].deployment.published_at=iso(Date.now()-10*864e5);
 state.ai_runs=[run('qa-mon',{run_id:'n1',timestamp:iso(Date.now()-2*864e5),recommended:true}),run('qa-mon',{run_id:'lab1',run_type:'LAB',timestamp:iso(Date.now()-2*864e5),recommended:true})];
 measureActions(state,new Date());
 let latest=state.action_results.at(-1);
 assert.equal(latest.result_status,'INSUFFICIENT_DATA');assert.equal(latest.window,'D7');assert.equal(latest.current.runs,1,'run LAB não entra na medição GOLDEN');
 state.ai_runs.push(run('qa-mon',{run_id:'n2',timestamp:iso(Date.now()-1*864e5),recommended:true,mentioned:true}));
 measureActions(state,new Date());
 latest=state.action_results.at(-1);
 assert.equal(latest.result_status,'POSITIVE_SIGNAL');assert.equal(latest.current.runs,2);assert.equal(latest.deltas.recommendation,1);
 assert.equal(state.actions[0].status,'MEASURED');
 measureActions(state,new Date());assert.equal(state.action_results.length,2,'mesma janela no mesmo dia substitui o resultado, sem duplicar');});

test('MONITOR stage measures published actions and REPORT renders IMPLEMENTAÇÕES REALIZADAS',async()=>{const s=await seed('qa-stage');
 const today=iso(Date.now());
 const action=makeAction(s,{status:'PUBLISHED',run_type:'GOLDEN',
  lifecycle:[{status:'PROPOSED',at:today,actor:'engine',note:''},{status:'APPROVED',at:today,actor:'qa',note:''},{status:'PUBLISHED',at:today,actor:'qa',note:''}],
  deployment:{adapter:'git_static',status:'PUBLISHED',published_at:iso(Date.now()-3*864e5),url:'https://fixture.example/p/guia.html',baseline_snapshot:{GOLDEN:{mention:0,recommendation:0,citation:0,runs:0},LAB:{mention:null,recommendation:null,citation:null,runs:0}}}});
 await putAction('qa-stage',action);
 const monitor=await executeStage({client_id:'qa-stage',mode:'MONITOR',stage:'MONITOR'});
 assert.equal(monitor.status,'SUCCESS');
 let state=await loadState('qa-stage');
 assert.equal(state.actions[0].status,'MONITORING');assert.equal(state.action_results.length,1);assert.equal(state.action_results[0].result_status,'INSUFFICIENT_DATA');
 const report=await executeStage({client_id:'qa-stage',mode:'MONITOR',stage:'REPORT'});
 assert.equal(report.status,'SUCCESS');
 const markdown=await fs.readFile(path.join(clientDir('qa-stage'),'reports/latest.md'),'utf8');
 assert.match(markdown,/## IMPLEMENTAÇÕES REALIZADAS/);assert.match(markdown,/decisão: APPROVED/);assert.match(markdown,/https:\/\/fixture\.example\/p\/guia\.html/);assert.match(markdown,/INSUFFICIENT_DATA/);
 const html=await fs.readFile(path.join(clientDir('qa-stage'),'reports/latest.html'),'utf8');assert.match(html,/Implementações realizadas/);});

test('report keeps the implementations section with the empty message when nothing was approved',async()=>{await seed('qa-empty');
 const report=await executeStage({client_id:'qa-empty',mode:'REPORT',stage:'REPORT'});
 assert.equal(report.status,'SUCCESS');
 const markdown=await fs.readFile(path.join(clientDir('qa-empty'),'reports/latest.md'),'utf8');
 assert.match(markdown,/## IMPLEMENTAÇÕES REALIZADAS\nNenhuma implementação no período\./);});

test.after(async()=>{await fs.rm(process.env.CITAVEL_ROOT,{recursive:true,force:true});});
