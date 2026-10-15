import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { secretMatches,appOrigin } from '@/lib/security';
import { decryptConfig,platformConfig } from '@/lib/private-config';
import { googleProviderSchema } from '@/lib/settings-schema';
import { googleCallback,googleScopes,storeGoogleToken } from '@/lib/integrations/google-connect';
import { exchangeCode,OAuthError } from '@/lib/gsc/oauth';
import { saveConnection,connectionFailed,discoverProperties } from '@/lib/gsc/connection';
export async function GET(request:Request){
  const url=new URL(request.url);const jar=await cookies();const encrypted=jar.get('citavel_google_state')?.value;
  jar.set('citavel_google_state','',{path:'/api/integrations/google',maxAge:0});
  const back=(status:string)=>NextResponse.redirect(`${appOrigin()}/admin/integrations?google=${status}`);
  if(!encrypted)return back('expired');
  try {
    const state=decryptConfig<any>(encrypted);
    if(Date.now()>state.expires||!secretMatches(url.searchParams.get('state')||'',state.state))return back('expired');
    if(state.kind==='HUB')return hubCallback(url,state);
    if(url.searchParams.has('error'))return back('declined');
    const provider=googleProviderSchema.parse(state.provider);
    const owner=await db.user.findFirst({where:{id:state.actorId,status:'ACTIVE',memberships:{some:{organizationId:state.organizationId,role:{in:['ADMIN','SUPER_ADMIN']}}}}});
    const client=await db.client.findFirst({where:{id:state.clientId,organizationId:state.organizationId}});
    if(!owner||!client)return back('expired');
    const code=url.searchParams.get('code');if(!code)return back('failed');
    const cfg=await platformConfig();const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:cfg.GOOGLE_CLIENT_ID,client_secret:cfg.GOOGLE_CLIENT_SECRET,redirect_uri:googleCallback(),grant_type:'authorization_code',code_verifier:state.verifier}),redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)return back('failed');const token=await response.json();if(!token.refresh_token)return back('offline_required');
    if(!String(token.scope||'').split(' ').includes(googleScopes[provider]))return back('scope_required');
    await storeGoogleToken(client.id,provider,{refreshToken:token.refresh_token,grantedScope:token.scope,userId:owner.id,organizationId:client.organizationId});
    const previous=await db.integration.findUnique({where:{clientId_provider:{clientId:client.id,provider}}});
    const metadata={...(previous?.metadata as any||{}),managerConfigured:true,authorizedAt:new Date().toISOString(),detail:'Conta autorizada. Salve os identificadores e teste a conexão.'};
    await db.integration.upsert({where:{clientId_provider:{clientId:client.id,provider}},create:{clientId:client.id,provider,status:'PENDING',metadata},update:{status:'PENDING',metadata}});
    return back('connected');
  }catch{return back('failed')}
}

// Organization-level Search Console connection (Integration Hub). State, expiry and PKCE were validated above.
async function hubCallback(url:URL,state:any){
  const back=(status:string)=>NextResponse.redirect(`${appOrigin()}/admin/integrations?hub=${status}`);
  try{
    if(url.searchParams.has('error')){await connectionFailed(state.organizationId,'DECLINED');return back('declined');}
    const owner=await db.user.findFirst({where:{id:state.actorId,status:'ACTIVE',memberships:{some:{organizationId:state.organizationId,role:{in:['ADMIN','SUPER_ADMIN']}}}}});
    const code=url.searchParams.get('code');
    if(!owner||!code){await connectionFailed(state.organizationId,'FAILED');return back('failed');}
    const cfg=await platformConfig();
    const token=await exchangeCode({clientId:cfg.GOOGLE_CLIENT_ID,clientSecret:cfg.GOOGLE_CLIENT_SECRET},code,state.verifier,googleCallback());
    await saveConnection(state.organizationId,owner.id,token);
    try{await discoverProperties(state.organizationId);}catch{return back('connected_discovery_failed');}
    return back('connected');
  }catch(e){const code=e instanceof OAuthError?e.code:'FAILED';await connectionFailed(state.organizationId,code).catch(()=>{});return back(code.toLowerCase());}
}
