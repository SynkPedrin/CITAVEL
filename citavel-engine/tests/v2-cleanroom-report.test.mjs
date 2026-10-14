import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
process.env.CITAVEL_ROOT=await fs.mkdtemp(path.join(os.tmpdir(),'citavel-v2-'));
const {createClient,loadState,loadConfig,saveState}=await import('../core/store.mjs');
const {extractIdentity,confirmIdentity,autoFillConfig,IDENTITY_STATUSES}=await import('../core/brand-discovery.mjs');
const {createCleanroom,runDiscover}=await import('../core/engine.mjs');
const {buildSnapshot,saveSnapshot}=await import('../core/report-engine.mjs');
const {renderPdf}=await import('../core/pdf.mjs');

const HOME={url:'https://fixture.com.br/',status_code:200,is_html:true,page_class:'HOME',title:'Fixture',meta_description:'Descrição pública da Fixture.',h1:['Fixture inteligência aplicada'],internal_links:[],external_links:['https://www.instagram.com/fixture.oficial','https://wa.me/5518999001122','https://agenciaalheia.com.br/'],json_ld:[{'@context':'https://schema.org','@type':'Organization',name:'Fixture Oficial LTDA',logo:'https://fixture.com.br/assets/logo.svg',description:'Org description oficial.',alternateName:'Fixture Co'}],identity:{logo_candidates:[{src:'https://fixture.com.br/img/header-logo.png',width:180,height:40}],icon_links:[{href:'https://fixture.com.br/favicon.ico',sizes:'32x32',type:'image/x-icon'}],style_blocks:':root{--primary:#112233;--accent:#c6ff00;--background:#ffffff}',stylesheet_links:[],font_links:['https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap'],cta_links:[{text:'Fale conosco',href:'https://fixture.com.br/contato'}],contact_links:['https://wa.me/5518999001122','mailto:contato@fixture.com.br'],footer_links:['https://www.instagram.com/fixture.oficial'],manifest_url:null,og_image:'https://fixture.com.br/og.jpg'}};
const SERVICE={url:'https://fixture.com.br/servicos/ia/',status_code:200,is_html:true,page_class:'SERVICE',title:'Produção com IA',h1:['Produção com IA aplicada'],internal_links:[],external_links:[],json_ld:[],identity:{icon_links:[],cta_links:[],contact_links:[],footer_links:[]}};
const CRAWL={collected_at:'2026-10-07T00:00:00.000Z',pages:[HOME,SERVICE]};
const CONFIG={brand:'Fixture',domain:'https://fixture.com.br/'};

test('identity extraction: logo priority, palette, fonts, social, contact, provenance',()=>{
  const id=extractIdentity(CRAWL,CONFIG,{});
  assert.equal(id.logos[0].asset_url,'https://fixture.com.br/assets/logo.svg');
  assert.equal(id.logos[0].type,'organization_jsonld');
  assert.ok(id.logos[0].confidence>id.logos.find(l=>l.type==='header').confidence);
  assert.ok(id.logos.some(l=>l.type==='og_image'));
  assert.equal(id.favicon.asset_url,'https://fixture.com.br/favicon.ico');
  const roles=Object.fromEntries(id.palette.map(p=>[p.role,p.hex]));
  assert.equal(roles.primary,'#112233');
  assert.equal(roles.accent,'#c6ff00');
  assert.ok(id.palette.every(p=>p.source&&p.confidence));
  assert.deepEqual(id.fonts.map(f=>f.family),['Inter']);
  assert.deepEqual(id.social_profiles.map(s=>s.platform),['instagram']);
  assert.ok(!id.social_profiles.some(s=>s.url.includes('agenciaalheia')));
  assert.equal(id.contact.whatsapp[0].number,'5518999001122');
  assert.equal(id.contact.emails[0].address,'contato@fixture.com.br');
  assert.equal(id.description.text,'Org description oficial.');
  assert.ok(id.alternate_names.some(n=>n.name==='Fixture Co'));
  assert.ok(id.products_services.some(p=>p.name==='Produção com IA aplicada'));
  assert.equal(id.provenance.ai_used,false);
  assert.equal(id.status,'AUTO_DISCOVERED');
  assert.ok(IDENTITY_STATUSES.includes(id.status));
});

test('identity extraction: empty input degrades to INCOMPLETE with not_found, never invented',()=>{
  const id=extractIdentity({collected_at:'2026-10-07T00:00:00.000Z',pages:[]},CONFIG,{});
  assert.equal(id.status,'INCOMPLETE');
  assert.deepEqual(id.logos,[]);
  assert.equal(id.description,null);
  assert.deepEqual(id.palette,[]);
  assert.ok(id.not_found.includes('logos')&&id.not_found.includes('palette')&&id.not_found.includes('description'));
});

test('clean-room: minimal input creates isolated client, DOMAIN_REQUIRED without domain, no borrowed data',async()=>{
  await createClient('qa-populated',{brand:'Outra Marca',domain:'https://outra.com.br/',market:'imobiliária',locations:['São Paulo'],priority_services:['loteamentos']});
  const s0=await loadState('qa-populated');s0.evidence.push({evidence_id:'ev_x',claim:'segredo do outro cliente'});await saveState('qa-populated',s0);
  const r=await createCleanroom({client_id:'qa-cleanroom',brand_name:'Marca Limpa'});
  assert.equal(r.status,'DOMAIN_REQUIRED');
  const s=await loadState('qa-cleanroom');
  assert.equal(s.evidence.length,0);assert.equal(s.prompts.length,0);assert.equal(s.ai_runs.length,0);
  const c=await loadConfig('qa-cleanroom');
  assert.equal(c.brand,'Marca Limpa');assert.equal(c.market,'');assert.deepEqual(c.priority_services,[]);
  assert.equal(c.clean_room,true);
  const d=await runDiscover('qa-cleanroom');
  assert.equal(d.status,'DOMAIN_REQUIRED');
  await assert.rejects(createCleanroom({client_id:'qa-cleanroom',brand_name:'Duplicado'}),/EEXIST/);
});

test('autoFillConfig fills only empty fields and records provenance',()=>{
  const identity=extractIdentity(CRAWL,CONFIG,{});
  const empty={brand:'Fixture',market:'',priority_services:[]};
  const filled=autoFillConfig(empty,identity);
  assert.ok(filled.includes('market')&&filled.includes('priority_services'));
  assert.equal(empty.market,'Produção com IA aplicada');
  assert.equal(empty.config_provenance.auto_filled_from,'DISCOVER');
  const manual={brand:'Fixture',market:'mercado manual',priority_services:['serviço manual']};
  assert.deepEqual(autoFillConfig(manual,identity),[]);
  assert.equal(manual.market,'mercado manual');
});

test('confirmIdentity: guards, corrections whitelist, confirm and reject',async()=>{
  const s={brand_identity:extractIdentity(CRAWL,CONFIG,{})};
  assert.throws(()=>confirmIdentity(s,{actor:''}),/ACTOR_REQUIRED/);
  assert.throws(()=>confirmIdentity(s,{actor:'ops',corrections:{senha:'x'}}),/CORRECTION_FIELD_INVALID/);
  const ok=confirmIdentity(s,{actor:'ops@citavel',corrections:{tagline:'Tagline corrigida'}});
  assert.equal(ok.status,'VERIFIED_BRAND_IDENTITY');
  assert.equal(ok.tagline,'Tagline corrigida');
  assert.equal(ok.corrections_log[0].corrected_by,'ops@citavel');
  const rej=confirmIdentity({brand_identity:extractIdentity(CRAWL,CONFIG,{})},{actor:'ops',decision:'REJECT'});
  assert.equal(rej.status,'IDENTITY_REJECTED');
});

test('report snapshot: deterministic id, data_sources declare LAB/GOLDEN, upsert per period',async()=>{
  await createClient('qa-snap',{brand:'Snap',domain:'https://snap.com.br/',locations:['Cidade']});
  const s=await loadState('qa-snap');
  const snap=buildSnapshot(s,s.client,{at:'2026-10-07T12:00:00Z'});
  assert.equal(snap.snapshot_id,buildSnapshot(s,s.client,{at:'2026-10-07T12:00:00Z'}).snapshot_id);
  const types=Object.fromEntries(snap.data_sources.map(d=>[d.type,d.status]));
  assert.ok('LAB' in types&&'GOLDEN' in types);
  assert.notEqual(types.GOLDEN,'READY');
  assert.equal(snap.prompts.gained,null);
  saveSnapshot(s,snap);saveSnapshot(s,snap);
  assert.equal(s.report_snapshots.length,1);
});

test('pdf: renders %PDF when a chromium is available, honest PDF_UNAVAILABLE otherwise',async()=>{
  const out=path.join(process.env.CITAVEL_ROOT,'test.pdf');
  const r=await renderPdf('<!doctype html><title>t</title><h1>CITÁVEL</h1>',out,{timeoutMs:30000});
  if(r.status==='PDF_RENDERED'){
    const bytes=await fs.readFile(out);
    assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  }else{
    assert.equal(r.status,'PDF_UNAVAILABLE');
    assert.ok(r.note.length>10);
  }
});

test.after(async()=>{await fs.rm(process.env.CITAVEL_ROOT,{recursive:true,force:true});});
