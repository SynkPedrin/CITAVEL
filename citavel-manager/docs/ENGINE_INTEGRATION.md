# Integração com o Engine

npm run sync:cosentino lê somente clients/cosentino/data/state.json e a configuração validada. Upserts usam client_id + external_id.

O Manager não move nem reescreve o Engine. O ciclo manual usa POST /v1/run exclusivamente no backend. Dados ausentes aparecem como pendentes. Os 47 testes do Engine são saúde do sistema, não resultado comercial.
