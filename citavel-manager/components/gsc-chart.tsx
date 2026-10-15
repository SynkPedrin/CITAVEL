'use client';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

type Point = { date: string; clicks: number; impressions: number };
// One measure per chart (no dual axis). The previous period is aligned by day offset and drawn dashed/grey as reference.
export function GscTrend({ series, previous, metric, label }: { series: Point[]; previous: Point[]; metric: 'clicks' | 'impressions'; label: string }) {
  const data = series.map((p, i) => ({ date: p.date, current: p[metric], previous: previous[i]?.[metric] ?? null, previousDate: previous[i]?.date ?? null }));
  const fmt = (n: number) => n.toLocaleString('pt-BR');
  return <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
      <div className="eyebrow" style={{ marginBottom: 0 }}>{label}</div>
      <div className="kicker" style={{ display: 'flex', gap: 14, fontSize: 11 }}>
        <span><svg width="18" height="6" aria-hidden><line x1="0" y1="3" x2="18" y2="3" stroke="#b8f52a" strokeWidth="2" /></svg> Período atual</span>
        {previous.length > 0 && <span><svg width="18" height="6" aria-hidden><line x1="0" y1="3" x2="18" y2="3" stroke="#8a8a8a" strokeWidth="2" strokeDasharray="4 3" /></svg> Período anterior</span>}
      </div>
    </div>
    <div style={{ height: 210 }} role="img" aria-label={`${label} por dia`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: '#777', fontSize: 10 }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,.12)' }} tickFormatter={d => String(d).slice(5).split('-').reverse().join('/')} minTickGap={28} />
          <YAxis tick={{ fill: '#777', fontSize: 10 }} tickLine={false} axisLine={false} width={48} tickFormatter={n => Number(n).toLocaleString('pt-BR', { notation: 'compact' })} />
          <Tooltip cursor={{ stroke: 'rgba(255,255,255,.25)' }} contentStyle={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, fontSize: 12, color: '#f7f7f5' }}
            labelFormatter={(d, items: any) => { const prev = items?.[0]?.payload?.previousDate; return `${String(d).split('-').reverse().join('/')}${prev ? ` · anterior ${String(prev).split('-').reverse().join('/')}` : ''}`; }}
            formatter={(v: any, name: any) => [v == null ? '—' : fmt(Number(v)), name === 'current' ? 'Atual' : 'Anterior']} />
          {previous.length > 0 && <Line type="monotone" dataKey="previous" stroke="#8a8a8a" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls />}
          <Line type="monotone" dataKey="current" stroke="#b8f52a" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: '#0a0a0a', strokeWidth: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  </div>;
}
