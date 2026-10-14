import test from 'node:test';import assert from 'node:assert/strict';import {extractIdentity} from '../core/brand-discovery.mjs';import {crawl} from '../core/crawler.mjs';
const home=(identity)=>({pages:[{url:'https://b.com/',status_code:200,is_html:true,page_class:'HOME',word_count:200,identity:{icon_links:[],logo_candidates:[],...identity}}],collected_at:'2026-10-13T00:00:00Z'});
test('paleta: estilo computado + theme-color vencem; paleta padrão do Tailwind é ignorada',()=>{
 const id=extractIdentity(home({theme_color:'#A822DD',style_blocks:':root{--color-red-500:#fb2c36;--color-orange-500:#fe6e00;--color-yellow-300:#ffd236;--brand-accent:#00e0ff}',visual:{body_background:'#0b0a14',body_text:'#f5f3ff',fonts:{h1:'Oswald, sans-serif',body:'"Lato", Lato Fallback, sans-serif'},colors:[{hex:'#0b0a14',kind:'background',weight:900000},{hex:'#9b30ff',kind:'interactive',weight:20000},{hex:'#1a1726',kind:'background',weight:50000},{hex:'#a1a1aa',kind:'text',weight:3000}]}}),{brand:'B',domain:'https://b.com/'});
 const by=Object.fromEntries(id.palette.map(p=>[p.role,p.hex]));
 assert.equal(by.background,'#0b0a14');assert.equal(by.text_primary,'#f5f3ff');assert.equal(by.primary,'#a822dd');assert.equal(by.surface,'#1a1726');assert.equal(by.text_secondary,'#a1a1aa');
 assert.ok(!id.palette.some(p=>['#fb2c36','#fe6e00','#ffd236'].includes(p.hex)));
 assert.ok(['#9b30ff','#00e0ff'].includes(by.accent));
 assert.deepEqual(id.fonts.map(f=>f.family).slice(0,2),['Oswald','Lato']);assert.ok(!id.fonts.some(f=>/fallback|var\(/i.test(f.family)));});
test('paleta sem nenhum sinal continua vazia (nada inventado)',()=>{assert.deepEqual(extractIdentity(home({}),{brand:'B'}).palette,[]);});
test('crawler renderiza home e páginas com pouco texto via renderer injetado e marca javascript_rendered',async()=>{
 const html=(body)=>`<!doctype html><html><head><title>T</title></head><body>${body}</body></html>`;
 const fetch=async(url)=>({status:url.endsWith('robots.txt')||url.endsWith('sitemap.xml')?404:200,headers:{'content-type':'text/html'},body:html('<div id=app>Carregando</div>')});
 const rendered=html('<main><h1>Inteligência que automatiza</h1><p>'+'palavra '.repeat(80)+'</p><a href="/produtos">Produtos</a></main>');
 const calls=[];const renderer=async(url)=>{calls.push(url);return {status:'RENDERED',url,html:rendered,visual:{body_background:'#000000',colors:[]}};};
 const r=await crawl({client_id:'x',domain:'https://example.com/'},{fetch,renderer,maxPages:2,delayMs:0});
 assert.ok(calls.includes('https://example.com/'));const home=r.pages.find(p=>p.url==='https://example.com/');assert.equal(home.rendered_with,'chromium');assert.ok(home.word_count>=80);assert.equal(home.static_word_count,1);assert.equal(home.identity.visual.body_background,'#000000');assert.equal(r.scope.javascript_rendered,true);assert.ok(r.pages.some(p=>p.url==='https://example.com/produtos'));assert.equal(r.site_status.status,'OK');});
test('crawler com fetch de fixture não abre navegador sem renderer explícito',async()=>{const fetch=async()=>({status:200,headers:{'content-type':'text/html'},body:'<html><body>oi</body></html>'});const r=await crawl({client_id:'x',domain:'https://example.com/'},{fetch,maxPages:1,delayMs:0});assert.equal(r.scope.javascript_rendered,false);});
