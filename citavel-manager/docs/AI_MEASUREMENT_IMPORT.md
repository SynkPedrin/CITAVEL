# Importação de medições de IA

As medições são feitas **fora** do Manager (agentes do Endrigo). O Manager recebe o texto, interpreta, mostra para revisão e só salva após confirmação.

## Fluxo do operador
1. Cliente → **Presença em IA** → **Copiar briefing de medição** (texto com dados confirmados do cliente, consultas reais do Google e o modelo de entrega). Enviar ao Endrigo.
2. Ao receber o relatório: **Importar medição** → preencher (opcional) título, período, data, origem, metodologia, plataformas → colar o texto (ou carregar `.txt`, `.md`, `.json`) → **Analisar resultados**.
3. **Revisar medição**: cada valor mostra a linha do texto que o sustenta (passe o mouse); avisos listam ambiguidades. **Corrigir dados** habilita edição. **Confirmar e salvar** grava.
4. Para corrigir depois: abrir a medição → **Editar (nova versão)**. A versão anterior fica em *Histórico de revisões*. **Arquivar** tira a medição do painel sem apagá-la.

## O que o interpretador lê (sem IA, sem rede)
- Modelo recomendado (`RELATÓRIO DE PRESENÇA EM IA` / `CLIENTE:` / `PLATAFORMAS:` / `OPENAI:` / `MENÇÕES: 8 de 20` …) — disponível no botão *Copiar modelo de entrega*.
- JSON (inteiro ou em bloco ```json), tabelas Markdown com coluna de plataforma, e texto livre.
- Em texto livre, só vira número uma frase explícita "N de M" com **uma** plataforma e uma métrica (menção, recomendação, citação). "Boa presença no ChatGPT" não vira percentual.
- Percentuais sem contagem são guardados como declaração, não como número. Valores conflitantes ou impossíveis (ex.: menções > observações) ficam vazios com aviso.
- Instruções dentro do texto ("ignore as instruções…") são só texto: geram aviso e não alteram nada.
- CPF, telefone, termos como paciente/laudo/prontuário geram aviso; salvar exige confirmar que são só dados institucionais.

## Classificação
- **LAB**: execução por API/ambiente automatizado.
- **GOLDEN**: só com método de coleta em interface de consumo **em cada plataforma** e ao menos uma evidência original (validado também no servidor).
- **Qualitativa / não verificada**: demais casos. Sem contagens, nenhum percentual é exibido.
LAB e GOLDEN nunca são combinados. Comparação entre medições só é numérica quando classificação, metodologia/versão, plataformas, modelos, prompts e observações coincidem; caso contrário aparece um aviso.

## Indicadores
Cobertura de menção = Σ menções ÷ Σ observações das plataformas que informaram ambos (idem recomendação e citação). Sempre exibidos com numerador/denominador.
