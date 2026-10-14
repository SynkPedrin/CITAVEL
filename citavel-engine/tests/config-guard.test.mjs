import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
process.env.CITAVEL_ROOT=await fs.mkdtemp(path.join(os.tmpdir(),'citavel-guard-'));
const {createClient,loadState,saveState}=await import('../core/store.mjs');const eng=await import('../core/engine.mjs');
test('engine bloqueia DEMAND sem market/serviços e desativa perguntas placeholder',async()=>{
 await createClient('guard-x',{brand:'X',domain:'https://example.com/',market:'',locations:[],priority_services:[],competitors:[]});const s=await loadState('guard-x');s.prompts=[{prompt_id:'p1',prompt:'O que avaliar em [SERVIÇO A DEFINIR] em [LOCALIDADE A DEFINIR]?',active:true}];await saveState('guard-x',s);
 const r=await eng.executeStage({client_id:'guard-x',mode:'ONBOARDING',stage:'DEMAND'});assert.equal(r.status,'PARTIAL');assert.equal(r.error,'CONFIG_REQUIRED');const after=await loadState('guard-x');assert.equal(after.prompts[0].active,false);assert.equal(after.prompts[0].deactivated_reason,'placeholder_config_required');
 const r2=await eng.executeStage({client_id:'guard-x',mode:'ONBOARDING',stage:'INTELLIGENCE'});assert.equal(r2.error,'CONFIG_REQUIRED');assert.equal((await loadState('guard-x')).ai_runs.length,0);});
