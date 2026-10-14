import { platformConfig, readPrivate, writePrivate } from '../private-config';
export type CheckResult = { status: 'CONNECTED'|'DEGRADED'|'PENDING'; detail: string; checkedAt: string };
export async function checkService(provider: string): Promise<CheckResult> {
  const cfg = await platformConfig(); let result: CheckResult;
  const at = new Date().toISOString();
  const pending = (detail: string): CheckResult => ({ status:'PENDING', detail, checkedAt:at });
  try {
    let url: string; let headers: Record<string,string> = {}; let detail = '';
    if (provider === 'ENGINE') { url = `${cfg.CITAVEL_ENGINE_URL || 'http://localhost:8788'}/healthz`; detail = 'Engine respondeu ao teste.'; }
    else if (provider === 'OLLAMA') { url = `${cfg.OLLAMA_BASE_URL || 'http://localhost:11434'}/api/tags`; detail = 'Ollama respondeu ao teste.'; }
    else if (provider === 'N8N') {
      const base = (cfg.N8N_BASE_URL || 'http://localhost:5678').replace(/\/$/,'');
      url = base + (cfg.N8N_API_KEY ? '/api/v1/workflows?limit=1' : '/healthz');
      if (cfg.N8N_API_KEY) headers['X-N8N-API-KEY'] = cfg.N8N_API_KEY;
      detail = cfg.N8N_API_KEY ? 'Acesso à API confirmado.' : 'Serviço disponível. Para gerenciar workflows, adicione uma chave de API.';
    } else if (provider === 'GEMINI') {
      if (!cfg.GEMINI_API_KEY) return pending('Adicione uma chave para testar.');
      url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1';
      headers['x-goog-api-key'] = cfg.GEMINI_API_KEY; detail = 'Chave validada pela API de modelos. Geração depende da cota da conta.';
    } else return pending('Conecte uma conta Google para este cliente.');
    const response = await fetch(url, { headers, cache:'no-store', redirect:'error', signal:AbortSignal.timeout(6000) });
    if (!response.ok) result = { status:'DEGRADED', detail:`O teste retornou HTTP ${response.status}. Confira o serviço ou a credencial.`, checkedAt:at };
    else {
      const body = await response.json();
      if (provider === 'OLLAMA') { const count = Array.isArray(body.models) ? body.models.length : 0; detail = count ? `${count} modelos locais disponíveis.` : 'Ollama ativo, mas nenhum modelo instalado.'; result = { status:count ? 'CONNECTED' : 'PENDING',detail,checkedAt:at }; }
      else result = {status:'CONNECTED',detail,checkedAt:at};
    }
  } catch { result = {status:'DEGRADED',detail:'O serviço não respondeu. Confira o endereço e se ele está iniciado.',checkedAt:at}; }
  await writePrivate(`check-${provider}`,result); return result;
}
export async function lastCheck(provider: string) { return readPrivate<CheckResult|null>(`check-${provider}`,null); }
