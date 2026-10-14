'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, LoaderCircle, RefreshCw } from 'lucide-react';

async function mutate(url:string,body?:unknown,method='POST'){
  const response=await fetch(url,{
    method,
    headers:{'content-type':'application/json','X-Citavel-Request':'1'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||'Não foi possível atualizar. Tente novamente.');
  return result;
}

export function SyncClientButton({clientId}:{clientId:string}){
  const router=useRouter();const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [error,setError]=useState(false);
  async function sync(){
    setBusy(true);setMessage('');setError(false);
    try{await mutate(`/api/clients/${clientId}/sync`);setMessage('Diagnóstico sincronizado.');router.refresh()}
    catch(error){setError(true);setMessage(error instanceof Error?error.message:'Não foi possível sincronizar.')}
    finally{setBusy(false)}
  }
  return <div><button className="button" onClick={sync} disabled={busy} title="Carrega no Manager os dados mais recentes do diagnóstico do Engine">{busy?<LoaderCircle size={14}/>:<RefreshCw size={14}/>} {busy?'Sincronizando…':'Atualizar diagnóstico'}</button>{message&&<p role={error?'alert':'status'} style={{maxWidth:280,fontSize:11,color:error?'var(--amber)':'var(--green)',margin:'8px 0 0'}}>{message}</p>}</div>
}

export function GoogleSyncButton({clientId,provider}:{clientId:string;provider:'GA4'|'SEARCH_CONSOLE'}){
  const router=useRouter();const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [error,setError]=useState(false);
  async function sync(){
    setBusy(true);setMessage('');setError(false);
    try{await mutate('/api/integrations/client',{clientId,provider,action:'sync'});setMessage('Dados atualizados.');router.refresh()}
    catch(error){setError(true);setMessage(error instanceof Error?error.message:'Não foi possível atualizar.')}
    finally{setBusy(false)}
  }
  return <div><button className="button" onClick={sync} disabled={busy}>{busy?<LoaderCircle size={14}/>:<RefreshCw size={14}/>} {busy?'Importando…':`Atualizar ${provider==='GA4'?'Analytics':'Search Console'}`}</button>{message&&<p role={error?'alert':'status'} style={{maxWidth:280,fontSize:11,color:error?'var(--amber)':'var(--green)',margin:'8px 0 0'}}>{message}</p>}</div>
}

const statuses=[['OPEN','Aberta'],['IN_PROGRESS','Em andamento'],['DONE','Concluída'],['BLOCKED','Aguardando'],['DISMISSED','Descartada']] as const;
const otherStatuses:Record<string,string>={PROPOSED:'Proposta',PENDING:'Pendente',APPROVED:'Aprovada',IMPLEMENTED:'Implementada'};
export function ActionStatusControl({actionId,status}:{actionId:string;status:string}){
  const router=useRouter();const [selected,setSelected]=useState(status);const [saved,setSaved]=useState(status);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [error,setError]=useState(false);
  useEffect(()=>{setSelected(status);setSaved(status)},[status]);
  async function save(){
    setBusy(true);setMessage('');setError(false);
    try{const result=await mutate(`/api/actions/${actionId}`,{status:selected},'PATCH');setSaved(result.action.status);setMessage('Status salvo.');router.refresh()}
    catch(error){setError(true);setMessage(error instanceof Error?error.message:'Não foi possível salvar.')}
    finally{setBusy(false)}
  }
  return <div style={{borderTop:'1px solid var(--line)',paddingTop:14,marginTop:18}}>
    <div style={{display:'flex',gap:10,alignItems:'flex-end',flexWrap:'wrap'}}>
      <div className="field" style={{flex:'1 1 150px'}}><label htmlFor={`action-${actionId}`}>Andamento da ação</label><select id={`action-${actionId}`} value={selected} disabled={busy} onChange={event=>{setSelected(event.target.value);setMessage('')}}>{!statuses.some(([value])=>value===status)&&<option value={status}>{otherStatuses[status]||status}</option>}{statuses.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
      <button className="button" onClick={save} disabled={busy||selected===saved}>{busy?<LoaderCircle size={14}/>:<Check size={14}/>} {busy?'Salvando…':'Salvar'}</button>
    </div>
    {message&&<p role={error?'alert':'status'} style={{fontSize:11,color:error?'var(--amber)':'var(--green)',margin:'9px 0 0'}}>{message}</p>}
  </div>
}
