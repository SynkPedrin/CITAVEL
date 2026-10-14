import { getIntegrationCatalog } from '@/lib/integrations/catalog';
import { NewClientWizard } from './wizard';
export const dynamic='force-dynamic';
export default async function Page(){const catalog=await getIntegrationCatalog();const status=(key:string)=>catalog.find(i=>i.key===key)?.status||'PENDING';return <NewClientWizard statuses={{N8N:status('N8N'),Ollama:status('OLLAMA'),Gemini:status('GEMINI')}}/>}
