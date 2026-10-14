import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const testRoot=await fs.mkdtemp(path.join(os.tmpdir(),'citavel-sheets-'));
process.env.CITAVEL_ROOT=testRoot;
const {createClient,loadState,saveState,stableId}=await import('../core/store.mjs');
const {SHEETS_SCHEMA}=await import('../core/google.mjs');
const {importSheetRows}=await import('../core/sheets-input.mjs');

function sheetRange(tab,rows){
  const columns=SHEETS_SCHEMA[tab].columns;
  return {range:`'${tab}'!A1:Z1000`,values:[columns,...rows.map(row=>columns.map(column=>row[column]??''))]};
}

async function fixture(id,{authorized=true,runs=[]}={}){
  await createClient(id,{brand:'Fixture',domain:'https://example.com/',automation:{auto_publish:false,google_sheets_enabled:authorized}});
  const state=await loadState(id);
  state.prompts=[{prompt_id:'fixture-prompt',prompt:'Quem oferece o serviço?',active:true,commercial_score:5}];
  state.ai_runs=runs;
  await saveState(id,state);
  return state;
}

const goldenRow={run_id:'golden-manual-1',timestamp:'2026-10-01T12:00:00Z',platform:'ChatGPT',model:'manual',prompt_id:'fixture-prompt',response:'Recomendo Fixture: https://example.com/',run_type:'GOLDEN'};

test('Sheets import rejects unauthorized clients without changing their state',async()=>{
  const before=await fixture('qa-sheets-unauthorized',{authorized:false});
  await assert.rejects(importSheetRows('qa-sheets-unauthorized',[sheetRange('04_AI_RUNS',[goldenRow])]),/SHEETS_NOT_AUTHORIZED/);
  assert.deepEqual(await loadState('qa-sheets-unauthorized'),before);
});

test('editing the exported LAB row to GOLDEN cannot replace its original observation',async()=>{
  const lab={...goldenRow,run_id:'lab-existing-1',run_type:'LAB',capture_method:'API',response:'Original LAB observation',raw_response:'Original LAB observation'};
  await fixture('qa-sheets-lab',{runs:[lab]});
  const result=await importSheetRows('qa-sheets-lab',[sheetRange('04_AI_RUNS',[{...goldenRow,run_id:lab.run_id}])]);
  assert.equal(result.imported,0);
  assert.deepEqual((await loadState('qa-sheets-lab')).ai_runs,[lab]);
});

test('generated GOLDEN IDs also cannot overwrite an existing non-GOLDEN record',async()=>{
  const id='qa-sheets-generated';
  const row={...goldenRow,run_id:''};
  const runId=stableId('golden',[id,row.platform,row.prompt_id,row.timestamp,row.response]);
  const legacy={run_id:runId,response:'Legacy observation without classification'};
  await fixture(id,{runs:[legacy]});
  assert.equal((await importSheetRows(id,[sheetRange('04_AI_RUNS',[row])])).imported,0);
  assert.deepEqual((await loadState(id)).ai_runs,[legacy]);
});

test('valid repeated GOLDEN imports remain idempotent and recompute observed claims',async()=>{
  await fixture('qa-sheets-golden');
  const range=sheetRange('04_AI_RUNS',[{...goldenRow,brand_mentioned:false,brand_recommended:false}]);
  assert.equal((await importSheetRows('qa-sheets-golden',[range])).imported,1);
  const first=(await loadState('qa-sheets-golden')).ai_runs;
  assert.equal(first.length,1);
  assert.equal(first[0].run_type,'GOLDEN');
  assert.equal(first[0].capture_method,'MANUAL_SHEETS');
  assert.equal(first[0].brand_mentioned,true);
  assert.equal(first[0].brand_recommended,true);
  assert.equal((await importSheetRows('qa-sheets-golden',[range])).imported,1);
  assert.deepEqual((await loadState('qa-sheets-golden')).ai_runs,first);
});

test('GOLDEN imports without IDs remain idempotent across repeated ranges',async()=>{
  await fixture('qa-sheets-no-id');
  const range=sheetRange('04_AI_RUNS',[{...goldenRow,run_id:''}]);
  await importSheetRows('qa-sheets-no-id',[range,range]);
  await importSheetRows('qa-sheets-no-id',[range]);
  assert.equal((await loadState('qa-sheets-no-id')).ai_runs.length,1);
});

test('unverified or unsourced evidence cannot become publicly allowed through Sheets',async()=>{
  await fixture('qa-sheets-evidence');
  const evidence=[
    {evidence_id:'unverified',claim:'Claim awaiting verification',source_url:'https://example.com/',verified:'FALSE',public_allowed:'TRUE'},
    {evidence_id:'no-source',claim:'Claim without a source',verified:'TRUE',public_allowed:'TRUE'},
    {evidence_id:'invalid-source',claim:'Claim with an invalid source',source_url:'javascript:alert(1)',verified:true,public_allowed:true},
    {evidence_id:'verified',claim:'Verified claim',source_url:'https://example.com/',verified:'TRUE',public_allowed:'TRUE'},
  ];
  await importSheetRows('qa-sheets-evidence',[sheetRange('01_EVIDENCE',evidence)]);
  let actual=(await loadState('qa-sheets-evidence')).evidence;
  for(const id of ['unverified','no-source','invalid-source']){
    const row=actual.find(row=>row.evidence_id===id);
    assert.equal(row.verified,false);
    assert.equal(row.public_allowed,false);
  }
  assert.equal(actual.find(row=>row.evidence_id==='verified').public_allowed,true);
  assert.equal(actual.find(row=>row.evidence_id==='unverified').verification_status,'SOURCE_PRESENT_UNVERIFIED');
  assert.equal(actual.find(row=>row.evidence_id==='no-source').verification_status,'SOURCE_MISSING');
  await importSheetRows('qa-sheets-evidence',[sheetRange('01_EVIDENCE',[{...evidence[3],verified:'FALSE'}])]);
  actual=(await loadState('qa-sheets-evidence')).evidence;
  assert.equal(actual.find(row=>row.evidence_id==='verified').public_allowed,false);
});

test.after(async()=>{await fs.rm(testRoot,{recursive:true,force:true});});
