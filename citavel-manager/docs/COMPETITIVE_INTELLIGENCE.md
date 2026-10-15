# Inteligência competitiva

Fica dentro de **Presença em IA** de cada cliente ("Como sua marca se compara?") e na **página 2** dos PDFs de Presença em IA e Completo (logo após a capa). O Manager nunca executa medições: só importa, valida e compara o que os agentes do Endrigo entregam.

## Contrato de importação (JSON)
No JSON da medição (inteiro ou em bloco ```json), além de `platforms`:

```json
{
  "platforms": [{ "platform": "OpenAI", "observations": 20, "mentions": 8, "recommendations": 5, "citations": 2 }],
  "competitive_analysis": {
    "competitors": [
      { "name": "Empresa A", "domain": "empresa-a.com.br",
        "platforms": [{ "platform": "OpenAI", "observations": 20, "mentions": 10, "recommendations": 8, "citations": 3 }] }
    ]
  }
}
```
- `domain` é opcional, mas é a identidade do concorrente: o mesmo domínio nunca vira dois registros; nomes parecidos nunca são fundidos; mesmo nome com domínios diferentes são empresas diferentes.
- `observations` do concorrente **deve ser igual** ao do cliente na mesma plataforma (mesmas respostas). Se diferir, a empresa aparece como "Não comparável" nessa plataforma, com o motivo.
- Contagens sem total, percentuais sem contagem, valores maiores que as observações e plataformas repetidas geram avisos na revisão e ficam vazios (nunca zero). Texto livre não vira número de concorrente.
- Importações antigas (sem `competitive_analysis`) continuam válidas. Nomes em `competitors` sem contagens ficam como "Sem dados de medição".

## Indicadores (sempre com numerador/denominador)
- Cobertura de menção / recomendação / citação = respostas com a ocorrência ÷ respostas analisadas (soma de numeradores ÷ soma de denominadores das plataformas comparáveis; nada é médio de percentuais).
- Participação nas recomendações da amostra = recomendações da empresa ÷ recomendações de todas as empresas identificadas nas mesmas plataformas. **Não é market share.**
- Diferença competitiva = cobertura do cliente − cobertura do concorrente, em pontos percentuais, só nas plataformas em que ambos foram comparados. Negativo (vermelho) = cliente atrás.
- Oportunidades são derivadas só desses agregados (concorrente mais recomendado/mencionado/citado, cliente mencionado sem recomendação). Não inferem causa.
- LAB e GOLDEN são medições separadas; o filtro "Medição" escolhe uma delas e nunca as mistura. Os filtros disponíveis são medição e plataforma; período, intenção e localidade só poderão existir quando o contrato trouxer esses campos por observação.

## Logos (Brand Asset Resolver)
- Busca somente no site oficial do domínio informado: schema.org `Organization/LocalBusiness.logo` → imagem de logo no cabeçalho → ícone do site. Nunca em resultados de busca.
- Proteção SSRF: DNS resolvido e validado a cada salto (bloqueia IP privado, loopback, link-local, metadata, IPv6 mapeado), só http/https nas portas 80/443, máx. 3 redirecionamentos, timeout 8 s, limites de tamanho, conexão feita ao IP validado.
- Validação por conteúdo (PNG, JPG, GIF, WebP; SVG só estático sem script, evento, foreignObject, referências externas ou entidades). Arquivos em `.runtime/brand-assets/<cliente>/<sha256>.<ext>` (0600), nunca carregados do site a cada acesso.
- Achados automáticos ficam **PENDENTES** até um operador aprovar (prévia no painel "Gerenciar concorrentes"). Upload manual é aprovado na hora. Uma logo aprovada nunca é substituída automaticamente. Sem logo: avatar de iniciais.
- A busca roda em segundo plano após cada importação (`CITAVEL_DISABLE_LOGO_LOOKUP=1` desliga).

## PDF
O snapshot congela números **e** as logos aprovadas (data URI); o PDF não acessa a rede e não muda quando uma logo é trocada depois. Até 5 concorrentes na página 2; os demais continuam em seção seguinte (linhas nunca quebram entre páginas). Sem dados competitivos válidos, a página não é criada. O relatório só-Google nunca inclui o comparativo.

## Dados e permissões
Tabelas: `client_competitors`, `brand_assets`, `ai_measurement_competitor_metrics` (todas por `client_id`, com `organization_id` nas duas primeiras). Operadores (SUPER_ADMIN, ADMIN, ANALYST) importam, gerenciam concorrentes e aprovam logos; `CLIENT_ADMIN/CLIENT_VIEWER` só veem o próprio cliente, e logos pendentes não são servidas a eles. Tudo é checado nas rotas de API (`/api/clients/[id]/competitors`, `/brand-assets`).

## Operação
- Rollback de dados: `pg_dump` antes de cada `db push` (as tabelas novas são aditivas).
- O Manager local precisa de `ALLOW_INSECURE_LOCAL_HTTP=true` ao rodar em `http://localhost` (use `scripts/activate-local.sh`); sem isso o login retorna 500.
- Testes: `npm test` (inclui `competitive.test.ts` e `competitive-db.test.ts`) e `npx tsx --env-file=.env.local scripts/e2e-competitive.ts` (navegador real, cliente de teste isolado e apagado ao final).
