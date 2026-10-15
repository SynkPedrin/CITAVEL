# Operação do dia a dia

**Adicionar cliente**: Clientes → *Novo cliente* (admins). Informe serviços e localidades **confirmados** — alimentam o classificador do Google e o briefing de IA. Depois: Configurações → Integrações → vincular a propriedade do Search Console.

**Google**: atualização **automática** de todos os clientes com propriedade vinculada, feita pelo próprio Manager (`lib/gsc/scheduler.ts`, iniciado em `instrumentation.ts`): a cada 10 min ele garante a sincronização do dia (uma por cliente por dia, últimos 10 dias, porque o Google revisa dias recentes), executa jobs pendentes — inclusive os perdidos em reinícios — e marca como falhos os travados há mais de 2 h. Cliente sem importação inicial concluída recebe a importação completa. O n8n (`CITAVEL — GSC DAILY SYNC`) segue como gatilho adicional, sem duplicar. Sincronização manual: Integrações → Vínculos → *Sincronizar*. Estado visível em Integrações ("Atualização automática ativa…"). Desligar só com `GSC_SCHEDULER=off`. A seção mostra período solicitado × dias com dados e só compara com o período anterior quando ambos têm cobertura suficiente.

**Presença em IA**: ver `AI_MEASUREMENT_IMPORT.md`. **Relatórios**: ver `REPORT_ENGINE.md`.

## Investigar erros
| Sintoma | Onde olhar |
|---|---|
| Google "reautorização necessária" | Configurações → Integrações (estado `AUTH_EXPIRED`) → *Reautorizar Google*. Em modo Teste do app OAuth, o Google expira a autorização a cada 7 dias. |
| Sync falhou | Integrações → Sincronizações (código e detalhe do erro); log `.runtime/manager.log`. |
| PDF "Falhou" | Coluna Status em Relatórios (mensagem); Chromium: `CHROMIUM_PATH` no container ou Google Chrome local. |
| Eventos de auditoria | tabela `system_events` (origens `GOOGLE_HUB`, `AI_MEASUREMENT`, `REPORT_ENGINE`, `MANAGER`). |
| Saúde | `GET /api/health` (503 se o banco estiver fora). |

## Testes
`npm run typecheck` · `npm test` (unitários + Postgres real em organizações temporárias) · `npm run e2e` (navegador real; mutações num cliente de teste isolado, removido ao final).
