'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LayoutDashboard, Building2, Workflow, Activity, Plug, Users, SlidersHorizontal, PanelLeftClose, PanelLeftOpen, LogOut, Menu, X, Radar, TrendingUp, Search, MessageSquare, UsersRound, Globe, ListChecks, ShieldCheck, BadgeCheck, Fingerprint, FileText, FlaskConical, BarChart3, ChevronLeft, ArrowUpRight } from 'lucide-react';
import { labels } from './ui';

const adminItems=[['','Visão geral',LayoutDashboard],['/clients','Clientes',Building2],['/automations','Automações',Workflow],['/operation','Operação',Activity],['/integrations','Integrações',Plug],['/users','Usuários',Users],['/system','Sistema',SlidersHorizontal]] as const;
const clientItems=[['','Visão geral',LayoutDashboard],['/ai-presence','Presença em IA',Radar],['/golden','Testes GOLDEN',BadgeCheck],['/identidade','Identidade',Fingerprint],['/demand','Demanda',TrendingUp],['/seo','SEO',Search],['/prompts','Prompts',MessageSquare],['/competitors','Concorrentes',UsersRound],['/sources','Fontes',Globe],['/aprovacoes','Aprovações',ShieldCheck],['/actions','Ações',ListChecks],['/content','Conteúdos',FileText],['/experiments','Experimentos',FlaskConical],['/reports','Relatórios',BarChart3],['/atividade','Atividade',Activity]] as const;

export function Shell({children,actor,client,pendingApprovals=0}:{children:React.ReactNode;actor:{name:string;role:string};client?:{id:string;name:string};pendingApprovals?:number}){
  const pathname=usePathname();
  const [open,setOpen]=useState(false);
  const [collapsed,setCollapsed]=useState(false);
  const [signingOut,setSigningOut]=useState(false);
  const [logoutError,setLogoutError]=useState('');
  const items=client?clientItems:adminItems;
  const base=client?`/clients/${client.id}`:'/admin';
  const isAdmin=!actor.role.startsWith('CLIENT_');
  const sectionTitle=pathname.startsWith('/account')?'Minha conta':pathname==='/admin/settings'?'Configurações':items.find(([p])=>pathname===base+p||(p&&pathname.startsWith(base+p+'/')))?.[1]||'Configuração';
  useEffect(()=>{
    if(!open)return;
    const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false)};
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    window.addEventListener('keydown',close);
    return ()=>{document.body.style.overflow=previousOverflow;window.removeEventListener('keydown',close)};
  },[open]);
  async function logout(){
    setSigningOut(true);setLogoutError('');
    try{
      const response=await fetch('/api/auth/logout',{method:'POST',headers:{'X-Citavel-Request':'1'}});
      if(!response.ok)throw new Error('Não foi possível sair. Tente novamente.');
      window.location.assign('/login');
    }catch(error){setLogoutError(error instanceof Error?error.message:'Não foi possível sair.');setSigningOut(false)}
  }
  return <div className={`app-shell ${collapsed?'sidebar-collapsed':''}`}>
    <a className="skip-link" href="#main-content">Ir para o conteúdo</a>
    <button className="mobile-menu icon-button" aria-label="Abrir menu" aria-controls="main-navigation" aria-expanded={open} onClick={()=>{setCollapsed(false);setOpen(true)}}><Menu size={20}/></button>
    {open&&<button className="drawer-overlay" aria-label="Fechar menu" onClick={()=>setOpen(false)}/>}
    <aside id="main-navigation" className={`sidebar ${open?'is-open':''}`} aria-label="Menu principal">
      <div className="brand-row">
        <Link href={base} className="brand" aria-label="CITÁVEL Manager — início" onClick={()=>setOpen(false)}><img src={collapsed?'/brand/citavel-icon.png':'/brand/citavel-logo.png'} width={collapsed?1280:2172} height={collapsed?1280:724} alt="CITÁVEL"/></Link>
        <button className="icon-button desktop-collapse" aria-label={collapsed?'Expandir menu':'Recolher menu'} title={collapsed?'Expandir menu':'Recolher menu'} onClick={()=>setCollapsed(!collapsed)}>{collapsed?<PanelLeftOpen size={16}/>:<PanelLeftClose size={16}/>}</button>
        <button className="icon-button mobile-close" aria-label="Fechar menu" onClick={()=>setOpen(false)}><X size={18}/></button>
      </div>
      <div className="workspace-marker"><span className="tiny-square"/><span>{client?client.name:'Manager'}<small>{client?'Espaço do cliente':'Central de operações'}</small></span></div>
      {client&&isAdmin&&<Link className="back-admin" href="/admin/clients"><ChevronLeft size={13}/><span>Todos os clientes</span></Link>}
      <nav aria-label={client?'Navegação do cliente':'Administração'}>{items.map(([path,label,Icon])=>{
        const active=pathname===`${base}${path}`||Boolean(path&&pathname.startsWith(`${base}${path}/`));
        return <Link title={label} aria-label={label} aria-current={active?'page':undefined} key={path} href={`${base}${path}`} onClick={()=>setOpen(false)} className={active?'active':''}><Icon size={17}/><span>{label}</span>{path==='/aprovacoes'&&pendingApprovals>0&&<span className="badge amber" style={{marginLeft:'auto',padding:'2px 7px'}}>{pendingApprovals}</span>}</Link>
      })}</nav>
      <div className="sidebar-bottom">
        {isAdmin&&<Link className="settings-link" title="Configurações da plataforma" href="/admin/settings" onClick={()=>setOpen(false)}><SlidersHorizontal size={15}/><span>Configurações</span><ArrowUpRight size={12}/></Link>}
        <Link className="user-profile" href="/account" title="Minha conta"><div className="avatar">{actor.name.split(' ').map(n=>n[0]).slice(0,2).join('')}</div><span><strong>{actor.name}</strong><small>{labels[actor.role]||actor.role}</small></span></Link>
        <button className="logout-button" title="Sair da conta" aria-label="Sair da conta" onClick={logout} disabled={signingOut}><LogOut size={14}/><span>{signingOut?'Saindo…':'Sair da conta'}</span></button>
        {logoutError&&<p className="sidebar-error" role="alert">{logoutError}</p>}
      </div>
    </aside>
    <div className="main-content" id="main-content" tabIndex={-1}>
      <div className="topbar"><span>{client?'ESPAÇO DO CLIENTE':'CITÁVEL MANAGER'}<span className="topbar-slash">/</span>{sectionTitle}</span><span className="topbar-right"><span className="status-dot"/> Ambiente local</span></div>
      {children}
      <footer className="app-footer"><span>CITÁVEL®</span><span>Presença que constrói demanda.</span></footer>
    </div>
  </div>
}
