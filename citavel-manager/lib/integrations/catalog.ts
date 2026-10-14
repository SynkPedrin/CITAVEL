import 'server-only';
import { lastCheck } from './checks';
import { platformConfig } from '../private-config';
export type CatalogStatus='CONNECTED'|'DEGRADED'|'PENDING'|'DISABLED';
export type IntegrationCatalogItem={key:string;name:string;category:string;status:CatalogStatus;detail:string;action:string;checkedAt?:string};
export async function getIntegrationCatalog():Promise<IntegrationCatalogItem[]>{
 const cfg=await platformConfig();
 return Promise.all([['ENGINE','Engine CITÁVEL','Motor de análise'],['N8N','n8n','Automação'],['OLLAMA','Ollama','Modelo local'],['GEMINI','Gemini','Modelo externo']].map(async([key,name,category])=>{const check=await lastCheck(key);return {key,name,category,status:check?.status||'PENDING',detail:check?.detail||(key==='GEMINI'&&cfg.GEMINI_API_KEY?'Chave disponível. Teste para validar o acesso.':'Execute o teste para confirmar a conexão.'),action:'Configurar',checkedAt:check?.checkedAt}}));
}
export async function platformRuntime(){const cfg=await platformConfig();return [['Manager',process.env.APP_URL||'http://localhost:3002'],['Engine',cfg.CITAVEL_ENGINE_URL||'http://localhost:8788'],['n8n',cfg.N8N_BASE_URL||'http://localhost:5678'],['Ollama',cfg.OLLAMA_BASE_URL||'http://localhost:11434']] as const;}
