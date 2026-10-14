import http from 'node:http';
import {startScheduler} from './core/scheduler.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT,clientDir,loadState,loadConfig,atomicWrite,saveState,withClientLock,redactError,validateClientId} from './core/store.mjs';
import {executeStage,executePipeline,importGolden,ingestManual,exportArtifacts,runDiscover,confirmDiscover,createCleanroom} from './core/engine.mjs';
import {sheetsPayload,sheetsClearBody,createSpreadsheetBody} from './core/google.mjs';
import {importSheetRows} from './core/sheets-input.mjs';
import {setPageStatus,startExperiment} from './core/lifecycle.mjs';
import {decideAction,executeAction,publishAction} from './core/action-engine.mjs';
import {parseCSV} from './core/imports.mjs';
const port=Number(process.env.PORT||8787);
const reply=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>2_000_000)throw new Error('BODY_TOO_LARGE');}return (req.headers['content-type']||'').includes('text/csv')?parseCSV(text):text?JSON.parse(text):{};}
const server=http.createServer(async(req,res)=>{try{
 const host=(req.headers.host||'').split(':')[0];if(!['localhost','127.0.0.1','citavel-engine'].includes(host))return reply(res,403,{error:'HOST_DENIED'});
 const origin=req.headers.origin;if(origin&&!['http://localhost:'+port,'http://127.0.0.1:'+port,process.env.PUBLIC_ORIGIN].includes(origin))return reply(res,403,{error:'ORIGIN_DENIED'});
 const url=new URL(req.url,'http://localhost');
 // Recarrega o código montado (core/ e server.mjs são volumes): o processo sai e o Docker o reinicia (restart: unless-stopped).
 if(req.method==='POST'&&url.pathname==='/v1/admin/restart'){if(req.headers['x-citavel-admin']!=='restart')return reply(res,403,{error:'ADMIN_HEADER_REQUIRED'});reply(res,202,{status:'RESTARTING'});setTimeout(()=>process.exit(0),300);return;}
 if(req.method==='GET'&&url.pathname==='/healthz')return reply(res,200,{status:'ok',service:'citavel-engine',version:'2.1.0'});
 if(req.method==='POST'&&url.pathname==='/v1/run'){const input=await body(req);return reply(res,200,input.stage?await executeStage(input):await executePipeline(input));}
 const state=url.pathname.match(/^\/v1\/state\/([a-z0-9-]+)$/);if(req.method==='GET'&&state)return reply(res,200,await loadState(state[1]));
 const sheet=url.pathname.match(/^\/v1\/sheets\/([a-z0-9-]+)\/(payload|linked|status|import)$/);
 if(sheet){const id=sheet[1];if(req.method==='GET'&&sheet[2]==='payload'){const s=await loadState(id);return reply(res,200,{client_id:id,authorized:s.client.automation.google_sheets_enabled===true,spreadsheet_id:s.client.google.sheets_spreadsheet_id||null,create_body:createSpreadsheetBody(s.client),batch_body:sheetsPayload(s,s.client),clear_body:sheetsClearBody()});}
 if(req.method==='POST'){const data=await body(req);if(sheet[2]==='import')return reply(res,200,await importSheetRows(id,data.valueRanges));return reply(res,200,await withClientLock(id,async()=>{const s=await loadState(id);if(sheet[2]==='linked'){if(!/^[A-Za-z0-9_-]{20,150}$/.test(data.spreadsheetId||''))throw new Error('SPREADSHEET_ID_INVALID');s.client.google.sheets_spreadsheet_id=data.spreadsheetId;await atomicWrite(path.join(clientDir(id),'config/client.json'),s.client);s.integration_status.google_sheets={status:'CREATED',spreadsheet_url:'https://docs.google.com/spreadsheets/d/'+data.spreadsheetId};}else{s.integration_status.google_sheets={...s.integration_status.google_sheets,status:data.status==='READY'?'READY':'AUTH_OR_SYNC_FAILED',tested_at:new Date().toISOString()};}await saveState(id,s);await exportArtifacts(s);return {client_id:id,spreadsheet_id:s.client.google.sheets_spreadsheet_id,batch_body:sheetsPayload(s,s.client),clear_body:sheetsClearBody()};}));}}
 const lifecycle=url.pathname.match(/^\/v1\/lifecycle\/([a-z0-9-]+)\/(page|experiment)$/);if(req.method==='POST'&&lifecycle){const data=await body(req);return reply(res,200,lifecycle[2]==='page'?await setPageStatus(lifecycle[1],data.page_id,data.status,data.published_url):await startExperiment(lifecycle[1],data.experiment_id));}
 const act=url.pathname.match(/^\/v1\/actions\/([a-z0-9-]+)\/([A-Za-z0-9_-]+)\/(decide|execute|publish)$/);if(req.method==='POST'&&act){const data=await body(req);validateClientId(act[1]);return reply(res,200,await ({decide:decideAction,execute:executeAction,publish:publishAction})[act[3]](act[1],act[2],data));}
 const imp=url.pathname.match(/^\/v1\/import\/([a-z0-9-]+)\/(golden|evidence)$/);if(req.method==='POST'&&imp){const data=await body(req);return reply(res,200,await (imp[2]==='golden'?importGolden:ingestManual)(imp[1],Array.isArray(data)?data:data.records));}
 if(req.method==='POST'&&url.pathname==='/v1/cleanroom'){const data=await body(req);return reply(res,200,await createCleanroom(data));}
 const disc=url.pathname.match(/^\/v1\/discover\/([a-z0-9-]+)(\/confirm)?$/);if(req.method==='POST'&&disc){const data=await body(req);validateClientId(disc[1]);return reply(res,200,disc[2]?await confirmDiscover(disc[1],data):await runDiscover(disc[1],data));}
 if(req.method==='GET'&&url.pathname==='/'){res.writeHead(302,{Location:'/clients/cosentino/dashboard/'});return res.end();}
 const file=url.pathname.match(/^\/clients\/([a-z0-9-]+)\/(dashboard|reports|pages\/drafts)\/(.*)$/);
 if(req.method==='GET'&&file){const base=path.join(clientDir(file[1]),file[2]);const target=path.resolve(base,decodeURIComponent(file[3]||'index.html'));const ext=path.extname(target);const isPrivate=target.startsWith(path.join(base,'private')+path.sep);if(isPrivate&&process.env.ENGINE_EVENT_SECRET&&req.headers['x-citavel-engine-secret']!==process.env.ENGINE_EVENT_SECRET)return reply(res,403,{error:'PRIVATE_DENIED'});if(!target.startsWith(base+path.sep)||!['.html','.md','.json','.png',...(isPrivate?['.pdf']:[])].includes(ext))return reply(res,403,{error:'PATH_DENIED'});const bytes=await fs.readFile(target);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.md':'text/plain; charset=utf-8','.json':'application/json','.png':'image/png','.pdf':'application/pdf'})[ext],'x-content-type-options':'nosniff','referrer-policy':'no-referrer','cache-control':'no-store'});return res.end(bytes);}
 return reply(res,404,{error:'NOT_FOUND'});
 }catch(e){reply(res,e.code==='ENOENT'?404:400,{error:redactError(e)});}});
server.requestTimeout=1_800_000;server.listen(port,process.env.HOST||'127.0.0.1',()=>{console.log('CITAVEL local service ready on '+port);startScheduler();});
