'use client';
export default function ErrorView({reset}:{error:Error;reset:()=>void}) {return <main className="error-state"><div className="eyebrow">CITÁVEL MANAGER</div><h1>Não foi possível carregar agora.</h1><p>Seus dados continuam salvos. Tente novamente em alguns instantes.</p><button className="button primary" onClick={reset}>Tentar novamente</button></main>}
