import { db } from '../db';
import { platformConfig,readPrivate,writePrivate } from '../private-config';
import { HttpError } from '../security';
import type { GoogleProvider } from '../settings-schema';
export const googleScopes: Record<GoogleProvider,string> = {
  GA4:'https://www.googleapis.com/auth/analytics.readonly',
  SEARCH_CONSOLE:'https://www.googleapis.com/auth/webmasters.readonly',
  GOOGLE_SHEETS:'https://www.googleapis.com/auth/spreadsheets.readonly',
  GTM:'https://www.googleapis.com/auth/tagmanager.readonly',
};
export const CALLBACK_PATH = '/api/integrations/google/callback';
/** Exact redirect URI sent to Google. GOOGLE_REDIRECT_URI (if set) must point at this app's callback route; otherwise APP_URL + route. */
export function googleCallback() {
  const explicit = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (explicit) {
    const u = new URL(explicit); const local = ['localhost', '127.0.0.1'].includes(u.hostname);
    if (u.pathname !== CALLBACK_PATH || u.search || u.hash || (u.protocol !== 'https:' && !(local && u.protocol === 'http:'))) throw new Error('GOOGLE_REDIRECT_URI must be https://<host>' + CALLBACK_PATH + ' (http only for localhost)');
    return u.origin + CALLBACK_PATH;
  }
  return `${new URL(process.env.APP_URL || 'http://localhost:3002').origin}${CALLBACK_PATH}`;
}
type Token = { refreshToken:string; grantedScope:string; userId:string; organizationId:string };
const tokenKey = (clientId:string,provider:GoogleProvider) => `oauth-${clientId}-${provider}`;
export async function storeGoogleToken(clientId:string,provider:GoogleProvider,value:Token) { await writePrivate(tokenKey(clientId,provider),value); }
export async function hasGoogleToken(clientId:string,provider:GoogleProvider) { return !!(await readPrivate<Token|null>(tokenKey(clientId,provider),null))?.refreshToken; }
export async function googleAccessToken(clientId:string,provider:GoogleProvider) {
  const cfg = await platformConfig();const token=await readPrivate<Token|null>(tokenKey(clientId,provider),null);
  if (!token?.refreshToken) throw new HttpError(400,'Conecte uma conta Google para este cliente.','GOOGLE_AUTH_REQUIRED');
  const response = await fetch('https://oauth2.googleapis.com/token',{ method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:cfg.GOOGLE_CLIENT_ID,client_secret:cfg.GOOGLE_CLIENT_SECRET,refresh_token:token.refreshToken,grant_type:'refresh_token'}),redirect:'error',signal:AbortSignal.timeout(10000) });
  if (!response.ok) throw new HttpError(400,'A autorização Google expirou ou foi revogada. Reconecte a conta.','GOOGLE_AUTH_REQUIRED');
  const data = await response.json();if(!data.access_token)throw new HttpError(400,'O Google não forneceu acesso. Reconecte a conta.');return data.access_token as string;
}
async function googleRequest(token:string,url:string,body?:unknown) {
  const r=await fetch(url,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw new HttpError(400,`Google retornou HTTP ${r.status}. Verifique a propriedade, a conta autorizada e se a API está habilitada.`,`GOOGLE_HTTP_${r.status}`);
  return r.json();
}
export async function syncGoogle(clientId:string,provider:GoogleProvider) {
  const integration=await db.integration.findUnique({where:{clientId_provider:{clientId,provider}}});
  const metadata=(integration?.metadata||{}) as any;const cfg=metadata.settings||{};
  const token=await googleAccessToken(clientId,provider);let snapshot:any;let detail='';
  const end=new Date(Date.now()-86400000).toISOString().slice(0,10), start=new Date(Date.now()-28*86400000).toISOString().slice(0,10);
  try {
    if(provider==='GA4'){
      if(!/^\d+$/.test(cfg.propertyId||''))throw new HttpError(400,'Salve o ID numérico da propriedade GA4.');
      const data=await googleRequest(token,`https://analyticsdata.googleapis.com/v1beta/properties/${cfg.propertyId}:runReport`,{dateRanges:[{startDate:start,endDate:end}],dimensions:[{name:'sessionSource'}],metrics:[{name:'sessions'},{name:'engagedSessions'},{name:'keyEvents'}],limit:'10000'});
      let sessions=0,engagedSessions=0,keyEvents=0,aiSessions=0;
      for(const row of data.rows||[]){const [s,e,k]=row.metricValues.map((v:any)=>Number(v.value)||0);sessions+=s;engagedSessions+=e;keyEvents+=k;if(/(^|\.)(chatgpt\.com|chat\.openai\.com|perplexity\.ai|gemini\.google\.com|copilot\.microsoft\.com|claude\.ai)$/i.test(row.dimensionValues[0]?.value||''))aiSessions+=s;}
      snapshot={startDate:start,endDate:end,sessions,engagedSessions,keyEvents,aiSessions,rows:(data.rows||[]).length,truncated:Number(data.rowCount)>10000};detail=`${sessions} sessões importadas nos últimos 28 dias.`;
    } else if(provider==='SEARCH_CONSOLE'){
      if(!cfg.siteUrl)throw new HttpError(400,'Salve a propriedade do Search Console.');
      const data=await googleRequest(token,`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(cfg.siteUrl)}/searchAnalytics/query`,{startDate:start,endDate:end,dimensions:['date'],rowLimit:1000});
      const rows=data.rows||[];snapshot={startDate:start,endDate:end,clicks:rows.reduce((n:number,r:any)=>n+(r.clicks||0),0),impressions:rows.reduce((n:number,r:any)=>n+(r.impressions||0),0),rows};detail=`${snapshot.clicks} cliques e ${snapshot.impressions} impressões importados.`;
    } else if(provider==='GOOGLE_SHEETS'){
      if(!/^[\w-]{20,150}$/.test(cfg.spreadsheetId||''))throw new HttpError(400,'Salve o ID da planilha.');
      const data=await googleRequest(token,`https://sheets.googleapis.com/v4/spreadsheets/${cfg.spreadsheetId}?fields=spreadsheetId,properties(title),sheets(properties(title))`);
      snapshot={title:data.properties?.title,tabs:(data.sheets||[]).map((s:any)=>s.properties?.title)};detail=`Planilha validada: ${snapshot.tabs.length} abas disponíveis para leitura.`;
    } else {
      if(!/^\d+$/.test(cfg.accountId||'')||!/^\d+$/.test(cfg.containerId||''))throw new HttpError(400,'Salve os IDs numéricos da conta e do container.');
      const data=await googleRequest(token,`https://tagmanager.googleapis.com/tagmanager/v2/accounts/${cfg.accountId}/containers/${cfg.containerId}`);
      snapshot={name:data.name,publicId:data.publicId,usageContext:data.usageContext};detail=`Container ${data.publicId||data.name} validado para leitura.`;
    }
    await db.integration.update({where:{clientId_provider:{clientId,provider}},data:{status:'CONNECTED',lastSyncAt:new Date(),metadata:{...metadata,managerConfigured:true,snapshot,detail,checkedAt:new Date().toISOString()}}});
    return {status:'CONNECTED',detail,snapshot};
  } catch(error) {
    const detail=error instanceof HttpError?error.message:'Não foi possível consultar o Google. Tente novamente.';
    await db.integration.update({where:{clientId_provider:{clientId,provider}},data:{status:'DEGRADED',metadata:{...metadata,managerConfigured:true,detail,checkedAt:new Date().toISOString()}}});
    throw error instanceof HttpError?error:new HttpError(502,detail);
  }
}
