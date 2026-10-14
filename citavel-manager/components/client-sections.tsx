import Link from 'next/link';
import { db } from '@/lib/db';
import { buildGoldenChecklist } from '@/lib/golden';
import { goldenPlatforms } from '@/lib/validation';
import { Badge, DateLabel, EmptyState, Metric, PageHeader, Panel, Percent, SectionHead } from './ui';
import { ApproveRejectControl } from './approval-controls';
import { GoldenImportForm } from './golden-import';
import { IdentityControls } from './identity-controls';

export const clientNav = [['ai-presence', 'Presença em IA'], ['golden', 'Testes GOLDEN'], ['identidade', 'Identidade'], ['demand', 'Demanda'], ['seo', 'SEO'], ['prompts', 'Prompts'], ['competitors', 'Concorrentes'], ['sources', 'Fontes'], ['aprovacoes', 'Aprovações'], ['actions', 'Ações'], ['content', 'Conteúdos'], ['experiments', 'Experimentos'], ['reports', 'Relatórios'], ['atividade', 'Atividade']] as const;

export async function ClientTabs({ id, active }: { id: string; active: string }) {
  const pending = await db.action.count({ where: { clientId: id, status: { in: ['PROPOSED', 'WAITING_APPROVAL'] } } });
  return <div className="tabs">{clientNav.map(([key, label]) => <Link key={key} className={active === key ? 'active' : ''} href={`/clients/${id}/${key}`}>{label}{key === 'aprovacoes' && pending > 0 ? ` (${pending})` : ''}</Link>)}</div>;
}

export function ActionsSection({ id, data, tabs }: { id: string; data: any; tabs: React.ReactNode }) {
  return <div className="page"><PageHeader eyebrow="Decisão" title="Gaps e ações" description="Oportunidades rastreáveis a evidências observadas, sem transformar hipótese em fato." />{tabs}<div className="section-heading"><SectionHead title="Ações prioritárias" description="Ordenadas pelo score produzido pelo Engine." /></div><div className="grid grid-2">{(data.actions as any[]).map(a => <Panel key={a.id}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><Badge status={a.priority} /><Badge status={a.status} /></div><h3>{a.title}</h3><p className="kicker">{a.description}</p><small className="kicker">Origem: {a.gapId ? 'gap identificado' : 'observação direta'} · Sinal esperado: {(a.data as any)?.expected_signal || '—'}</small><Link className="text-link" style={{ marginTop: 10 }} href={`/clients/${id}/actions/${a.id}`}>Por que esta ação existe</Link></Panel>)}</div><div className="section-heading"><SectionHead title="Gaps abertos" /></div><div className="table-wrap"><table className="table"><thead><tr><th>Tipo</th><th>Severidade</th><th>Descrição</th><th>Confiança</th><th>Status</th></tr></thead><tbody>{(data.gaps as any[]).map(g => <tr key={g.id}><td>{g.type}</td><td><Badge status={g.severity} /></td><td>{g.description}</td><td>{g.confidence == null ? '—' : `${Math.round(g.confidence * 100)}%`}</td><td><Badge status={g.status} /></td></tr>)}</tbody></table></div></div>;
}

export function ContentSection({ id, data, tabs }: { id: string; data: any; tabs: React.ReactNode }) {
  return <div className="page"><PageHeader eyebrow="Conteúdos" title="Conteúdos" description="Rascunhos e páginas observadas. A publicação automática permanece desativada." />{tabs}<div className="grid grid-2">{(data.pages as any[]).map(p => <Panel key={p.id} className="backdrop-card"><Badge status={p.status} /><h3>{p.title}</h3><p className="kicker">{p.url || 'Rascunho local'} · {p.type}</p><div style={{ display: 'flex', gap: 14, marginTop: 10 }}><Link className="text-link" href={`/clients/${id}/content/${p.id}`}>Ver detalhe</Link>{p.url && <a className="text-link" href={p.url} target="_blank" rel="noreferrer">Abrir origem</a>}</div></Panel>)}</div></div>;
}

function actionEvidence(a: any, data: any) {
  const raw = (a.data || {}) as any;
  const origin = raw.origin || {};
  const promptIds: string[] = Array.isArray(raw.affected_prompts) && raw.affected_prompts.length ? raw.affected_prompts : (Array.isArray(origin.prompt_ids) ? origin.prompt_ids : []);
  const runIds: string[] = Array.isArray(origin.run_ids) && origin.run_ids.length ? origin.run_ids : (Array.isArray(raw.source_run_ids) ? raw.source_run_ids : []);
  const gap = (data.gaps as any[]).find(g => g.id === a.gapId) || null;
  const prompts = (data.prompts as any[]).filter(p => promptIds.includes(p.externalId));
  return { gap, prompts, promptCount: promptIds.length, runCount: runIds.length };
}

export function AprovacoesSection({ id, data, tabs, operate }: { id: string; data: any; tabs: React.ReactNode; operate: boolean }) {
  const pending = (data.actions as any[]).filter(a => ['PROPOSED', 'WAITING_APPROVAL'].includes(a.status));
  return <div className="page"><PageHeader eyebrow="Aprovações" title="Decisões pendentes" description="Toda ação proposta pelo Engine com a evidência que a originou. Nada é executado sem decisão humana." />{tabs}
    {!pending.length ? <EmptyState title="Nenhuma ação aguardando decisão" description="Quando o Engine propor uma nova ação, ela aparecerá aqui com a evidência completa antes de qualquer execução." /> : <div className="grid grid-2">{pending.map(a => {
      const { gap, prompts, promptCount, runCount } = actionEvidence(a, data);
      const preview = (a.preview || null) as any;
      return <Panel key={a.id}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}><Badge status={a.priority} /><Badge status={a.status} /></div>
        <h3>{a.title}</h3>
        <p className="kicker">{a.description}</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0' }}>
          {a.actionType && <Badge status={a.actionType} />}
          {a.risk && <Badge status={a.risk}>Risco: {a.risk}</Badge>}
          {a.automationLevel && <Badge status={a.automationLevel} />}
        </div>
        <small className="kicker" style={{ display: 'block' }}>Evidência: {gap ? `gap ${gap.type} (${gap.severity})` : 'observação direta'} · {promptCount} prompt(s) · {runCount} execução(ões) de IA</small>
        {prompts.length > 0 && <small className="kicker" style={{ display: 'block', marginTop: 6 }}>Prompts afetados: {prompts.slice(0, 3).map(p => `“${p.prompt}”`).join(', ')}{promptCount > prompts.slice(0, 3).length ? ` +${promptCount - prompts.slice(0, 3).length}` : ''}</small>}
        {preview && <div className="notice" style={{ marginTop: 12 }}>
          <strong>Preview do conteúdo proposto</strong>
          <small className="kicker" style={{ display: 'block', marginTop: 6 }}>{[preview.title && `Título: ${preview.title}`, preview.meta_description && `Meta: ${preview.meta_description}`, preview.h1 && `H1: ${preview.h1}`, Array.isArray(preview.outline) && preview.outline.length ? `Outline: ${preview.outline.length} seções` : null, typeof preview.faq_count === 'number' ? `FAQ: ${preview.faq_count}` : null].filter(Boolean).join(' · ') || 'Estrutura ainda não detalhada.'}</small>
        </div>}
        <Link className="text-link" style={{ marginTop: 12 }} href={`/clients/${id}/actions/${a.id}`}>Por que esta ação existe</Link>
        {operate && <ApproveRejectControl actionId={a.id} />}
      </Panel>;
    })}</div>}
  </div>;
}

export function GoldenSection({ id, data, tabs, operate }: { id: string; data: any; tabs: React.ReactNode; operate: boolean }) {
  const runs = (data.aiRuns as any[]).map(r => ({ promptId: r.promptId ?? null, platform: r.platform, runType: r.runType }));
  const checklist = buildGoldenChecklist(data.prompts as any[], runs);
  const covered = checklist.filter(item => item.collected).length;
  const golden = (data.metrics as any)?.GOLDEN || {};
  const money = (p: any) => ['P4', 'P5'].includes(p.priority) ? 0 : 1;
  const formPrompts = (data.prompts as any[])
    .filter(p => p.active)
    .sort((a, b) => money(a) - money(b) || (b.commercialScore ?? -Infinity) - (a.commercialScore ?? -Infinity))
    .map(p => ({ externalId: p.externalId, prompt: p.prompt, priority: p.priority, commercialScore: p.commercialScore }));
  return <div className="page">
    <PageHeader eyebrow="GOLDEN" title="Testes GOLDEN" description="Respostas reais coletadas manualmente nas plataformas alvo — a evidência que ancora as métricas GOLDEN, separada do diagnóstico LAB." />
    {tabs}
    <div className="notice" style={{ marginBottom: 15 }}>Cole somente respostas reais coletadas nos ambientes alvo. LAB é automático; GOLDEN é evidência importada.</div>
    <div className="metric-grid" style={{ marginBottom: 15 }}>
      <Metric label="Cobertura do Test Pack" value={`${covered} de ${checklist.length}`} note="Money Prompts com pelo menos 1 teste GOLDEN" accent />
      <Metric label="Runs GOLDEN" value={golden.runs ?? '—'} note="observados pelo Engine" />
      <Metric label="Coverage · GOLDEN" value={<Percent value={golden.recommendation_coverage} />} note="revisado" />
      <Metric label="Mention Rate · GOLDEN" value={<Percent value={golden.mention_rate} />} note="revisado" />
    </div>
    <SectionHead title="Checklist do Test Pack" description="Money Prompts ativos (P4/P5), ordenados por valor comercial, com as plataformas já coletadas." />
    {!checklist.length ? <EmptyState title="Nenhum Money Prompt ativo" description="O Engine ainda não definiu prompts P4/P5 ativos para este cliente." /> : <div className="table-wrap"><table className="table"><thead><tr><th>Prompt</th><th>Cluster</th><th>Valor</th><th>Plataformas</th><th>Status</th></tr></thead><tbody>{checklist.map(item => <tr key={item.promptId}><td><strong>{item.prompt}</strong><small>{item.externalId}</small></td><td>{item.cluster}</td><td>{item.commercialScore ?? '—'}/5</td><td><div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{goldenPlatforms.map(platform => <Badge key={platform} status={item.collectedPlatforms.includes(platform) ? 'ACTIVE' : 'PENDING'}>{platform}</Badge>)}</div></td><td><Badge status={item.collected ? 'ACTIVE' : 'PENDING'}>{item.collected ? 'Coletado' : 'Pendente'}</Badge></td></tr>)}</tbody></table></div>}
    {operate && <><SectionHead title="Importar teste GOLDEN" description="Cada importação recalcula métricas GOLDEN, fontes, concorrentes e gaps no Engine." /><Panel><GoldenImportForm clientId={id} prompts={formPrompts} /></Panel></>}
  </div>;
}

const notFound = <small className="kicker">NOT_FOUND</small>;
const arr = (value: unknown): any[] => Array.isArray(value) ? value : [];
const confidence = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? <Badge>{`confiança ${Math.round(value * 100)}%`}</Badge> : null;

export function IdentitySection({ id, data, tabs, operate }: { id: string; data: any; tabs: React.ReactNode; operate: boolean }) {
  const bi = data.brandIdentity as any;
  if (!bi) return <div className="page"><PageHeader eyebrow="Identidade" title="Identidade da marca" description="Descoberta automática do Engine no site oficial, com origem e confiança de cada item." />{tabs}<EmptyState title="Identidade ainda não descoberta" description="A descoberta de identidade roda no onboarding ou na implantação clean-room. Quando o Engine coletar os dados, eles aparecerão aqui." /></div>;
  const logos = arr(bi.logos); const palette = arr(bi.palette); const fonts = arr(bi.fonts); const social = arr(bi.social_profiles);
  const names = arr(bi.alternate_names); const products = arr(bi.products_services); const claims = arr(bi.claims); const ctas = arr(bi.cta);
  const contact = bi.contact || {}; const whatsapp = arr(contact.whatsapp); const emails = arr(contact.emails); const forms = arr(contact.forms);
  return <div className="page">
    <PageHeader eyebrow="Identidade" title={bi.brand_name || 'Identidade da marca'} description="Descoberta automática do Engine no site oficial, com origem e confiança de cada item. Confirme antes de usar em conteúdo." />
    {tabs}
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
      <Badge status={bi.status} />
      {bi.tagline && <small className="kicker">{bi.tagline}</small>}
      {bi.official_domain && <a className="text-link" href={bi.official_domain} target="_blank" rel="noreferrer">{bi.official_domain}</a>}
      {bi.collected_at && <small className="kicker">Coletado em <DateLabel value={bi.collected_at} time /></small>}
    </div>
    <div className="grid grid-2">
      <Panel>
        <div className="eyebrow">LOGOS</div>
        {logos.length ? <div style={{ display: 'grid', gap: 12, marginTop: 10 }}>{logos.map((logo, i) => <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}><img src={logo.asset_url} alt={`Logo (${logo.type || 'candidato'})`} style={{ maxWidth: 120, maxHeight: 44, objectFit: 'contain', background: '#fff', borderRadius: 6, padding: 4 }} /><div><small className="kicker" style={{ display: 'block' }}>{logo.type || '—'} · {logo.mime_type || '—'}</small><div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>{confidence(logo.confidence)}{logo.source_page && <a className="text-link" style={{ display: 'inline-flex' }} href={logo.source_page} target="_blank" rel="noreferrer">origem</a>}</div></div></div>)}</div> : notFound}
        <div className="eyebrow" style={{ marginTop: 16 }}>FAVICON</div>
        {bi.favicon?.asset_url ? <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10 }}><img src={bi.favicon.asset_url} alt="Favicon" width={24} height={24} style={{ borderRadius: 4 }} />{confidence(bi.favicon.confidence)}{bi.favicon.source_page && <a className="text-link" style={{ display: 'inline-flex' }} href={bi.favicon.source_page} target="_blank" rel="noreferrer">origem</a>}</div> : notFound}
      </Panel>
      <Panel>
        <div className="eyebrow">PALETA</div>
        {palette.length ? <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>{palette.map((color, i) => <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span style={{ display: 'inline-block', width: 20, height: 20, borderRadius: 5, backgroundColor: color.hex, border: '1px solid var(--line)' }} /><small className="kicker">{color.role || '—'} · {color.hex} · {color.source || '—'}</small>{confidence(color.confidence)}</div>)}</div> : notFound}
        <div className="eyebrow" style={{ marginTop: 16 }}>FONTES</div>
        {fonts.length ? <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>{fonts.map((font, i) => <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}><strong style={{ fontSize: 12 }}>{font.family}</strong><small className="kicker">{font.source || '—'}</small>{confidence(font.confidence)}</div>)}</div> : notFound}
      </Panel>
      <Panel>
        <div className="eyebrow">DESCRIÇÃO</div>
        {bi.description?.text ? <div style={{ marginTop: 10 }}><p className="kicker" style={{ marginTop: 0 }}>{bi.description.text}</p><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{confidence(bi.description.confidence)}{bi.description.source_url && <a className="text-link" style={{ display: 'inline-flex' }} href={bi.description.source_url} target="_blank" rel="noreferrer">fonte</a>}</div></div> : notFound}
        <div className="eyebrow" style={{ marginTop: 16 }}>NOMES ALTERNATIVOS</div>
        {names.length ? <ul style={{ margin: '10px 0 0', paddingLeft: 18, display: 'grid', gap: 8 }}>{names.map((name, i) => <li key={i} className="kicker"><strong style={{ color: 'var(--text)' }}>{name.name}</strong> {confidence(name.confidence)} {name.source_url && <a className="text-link" style={{ display: 'inline-flex' }} href={name.source_url} target="_blank" rel="noreferrer">fonte</a>}</li>)}</ul> : notFound}
      </Panel>
      <Panel>
        <div className="eyebrow">PERFIS SOCIAIS</div>
        {social.length ? <ul style={{ margin: '10px 0 0', paddingLeft: 18, display: 'grid', gap: 8 }}>{social.map((profile, i) => <li key={i}><a className="text-link" style={{ display: 'inline-flex' }} href={profile.url} target="_blank" rel="noreferrer">{profile.platform || profile.url}</a> {confidence(profile.confidence)}</li>)}</ul> : notFound}
        <div className="eyebrow" style={{ marginTop: 16 }}>CONTATO</div>
        {whatsapp.length || emails.length || forms.length ? <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          {whatsapp.map((entry: any, i: number) => <small key={`w${i}`} className="kicker">WhatsApp: {entry.number} {entry.source_url && <a className="text-link" style={{ display: 'inline-flex' }} href={entry.source_url} target="_blank" rel="noreferrer">fonte</a>}</small>)}
          {emails.map((entry: any, i: number) => <small key={`e${i}`} className="kicker">E-mail: {typeof entry === 'string' ? entry : entry.email || entry.address || '—'}</small>)}
          {forms.map((entry: any, i: number) => <small key={`f${i}`} className="kicker">Formulário: <a className="text-link" style={{ display: 'inline-flex' }} href={entry.page_url} target="_blank" rel="noreferrer">{entry.page_url}</a> {confidence(entry.confidence)}</small>)}
        </div> : notFound}
      </Panel>
      <Panel>
        <div className="eyebrow">PRODUTOS E SERVIÇOS</div>
        {products.length ? <ul style={{ margin: '10px 0 0', paddingLeft: 18, display: 'grid', gap: 8 }}>{products.map((product, i) => <li key={i} className="kicker"><strong style={{ color: 'var(--text)' }}>{product.name}</strong> {confidence(product.confidence)} {product.source_url && <a className="text-link" style={{ display: 'inline-flex' }} href={product.source_url} target="_blank" rel="noreferrer">fonte</a>}</li>)}</ul> : notFound}
      </Panel>
      <Panel>
        <div className="eyebrow">CLAIMS (O QUE A MARCA AFIRMA)</div>
        {claims.length ? <ul style={{ margin: '10px 0 0', paddingLeft: 18, display: 'grid', gap: 8 }}>{claims.map((claim, i) => <li key={i} className="kicker">{claim.text} {confidence(claim.confidence)} {claim.source_url && <a className="text-link" style={{ display: 'inline-flex' }} href={claim.source_url} target="_blank" rel="noreferrer">fonte</a>}</li>)}</ul> : notFound}
        {ctas.length > 0 && <><div className="eyebrow" style={{ marginTop: 16 }}>CTAs</div><ul style={{ margin: '10px 0 0', paddingLeft: 18, display: 'grid', gap: 8 }}>{ctas.map((cta, i) => <li key={i} className="kicker">{cta.text} {cta.href && <a className="text-link" style={{ display: 'inline-flex' }} href={cta.href} target="_blank" rel="noreferrer">destino</a>}</li>)}</ul></>}
      </Panel>
    </div>
    {operate && bi.status !== 'VERIFIED_BRAND_IDENTITY' && <Panel style={{ marginTop: 14 }}><div className="eyebrow">REVISÃO DA IDENTIDADE</div><p className="kicker">Confirme a identidade descoberta, corrija campos pontuais ou rejeite para refazer a descoberta. Cada decisão é registrada na atividade do cliente.</p><IdentityControls clientId={id} /></Panel>}
  </div>;
}
