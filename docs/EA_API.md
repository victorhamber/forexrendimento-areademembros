# Contrato da API para o EA (paridade com WordPress)

Base URL de exemplo: `https://seu-dominio.com` — todas as rotas abaixo são relativas a ela.

## Autenticação

| Rota | Header |
|------|--------|
| `validate_license` (v1 e v2) | `X-API-Key: <chave>` obrigatório. Chaves cadastradas em **Admin → Segurança / Licenças** (persistidas em `Setting` `forex_api_keys`, JSON array de strings). |
| `submit_performance`, `get_ranking`, `download_setup` | Públicas (sem API Key), como no plugin. |

## POST `/api/forex-rendimento/v1/validate_license` e `/api/forex-rendimento/v2/validate_license`

**Body (JSON):**

```json
{
  "email": "comprador@email.com",
  "numero_conta": "12345678",
  "system_id": "MEU_ROBO_ID"
}
```

**Regras:**

- `email` formato válido.
- `numero_conta` mínimo 3 caracteres.
- `system_id` obrigatório (string).
- **Auto-bind (1ª vez):** se existir licença elegível ativa com `numeroConta` vazio, o servidor grava a conta enviada pelo EA e segue a validação. Se a conta já estiver preenchida e for diferente, **não** sobrescreve (mismatch — troca só pelo painel).

**Respostas:**

| Situação | HTTP | Body (campo `code`) |
|----------|------|------|
| Licença ativa e não expirada | 200 | `{"status":"success","code":"LICENSE_OK","message":"Licença válida.",...}` |
| 1ª vinculação automática da conta | 200 | `{"status":"success","code":"LICENSE_OK","account_bound":true,...}` |
| Licença **desativada** no painel (`inativa`) | 403 | `{"status":"error","code":"LICENSE_INACTIVE","message":"Licença desativada no painel."}` |
| Licença **expirada** | 403 | `{"status":"error","code":"LICENSE_EXPIRED","message":"Licença expirada."}` |
| Conta não confere com a do painel | 403 | `{"status":"error","code":"ACCOUNT_MISMATCH",...}` |
| Conta ainda não vinculada (legado) | 403 | `{"status":"error","code":"ACCOUNT_REQUIRED",...}` |
| Nenhuma licença ativa para e-mail/produto | 403 | `{"status":"error","code":"LICENSE_NOT_FOUND",...}` |
| API Key ausente ou inválida | 403 | `{"status":"error","message":"Unauthorized: invalid or missing X-API-Key"}` |
| Rate limit (60 req/min por IP) | 429 | `{"status":"error","message":"Rate limit exceeded. Try again later."}` |

**EA CloseGuard:** na revalidação periódica, remove o expert com `LICENSE_INACTIVE`, `LICENSE_EXPIRED`, `ACCOUNT_MISMATCH` ou `LICENSE_NOT_FOUND` (após 3 confirmações seguidas). Falha de rede **não** derruba o robô do gráfico.

**Cache:** sucesso e revogação definitiva (`LICENSE_INACTIVE` / `LICENSE_EXPIRED`) em memória. Erros soft (conta/produto) **não** são cacheados, para não “grudar” um bloqueio falso. Auto-bind invalida o cache do e-mail.

**Revalidação no EA:** validação ao fixar no gráfico; depois a cada ~15 s (só remove se desativada/expirada).

**Idempotência:** não se aplica (read-only na validação; auto-bind só escreve se `numeroConta` estava vazio).

---

## POST `/api/webhooks/tash` (teste gratuito)

Endpoint **separado** do Hotmart. Só ativa licença de teste/desafio do Product ID configurado em Admin (`tash_webhook_product_id`). Nunca ativa anual/vitalício/mensal.

**Uso com formulário Trajetto:** o embed HTML envia para `api.trajettu.com/.../submit`. Na Trajetto, configure um **webhook de saída** apontando para este endpoint (não altere o HTML do form).

**Auth (qualquer um):**
- Query: `?token=<tash_webhook_token>` (recomendado para Trajetto)
- Header: `X-Webhook-Token` ou `X-Tash-Token`

**Body (JSON)** — aceita formato Trajetto:

```json
{
  "email": "lead@email.com",
  "fn": "Nome",
  "ln": "Sobrenome",
  "phone": "+5511999999999"
}
```

Também aceita `name`/`nome`/`fullname`, `telefone`, e objetos aninhados `fields` / `data` / `lead`.

**Resposta sucesso:** `{"status":"success","message":"Licença de teste ativada.","eventId":"tash_...","licenseId":123}`

**Settings:** `tash_webhook_token`, `tash_webhook_product_id` (Admin → Webhooks / Segurança EA).

O webhook Hotmart **não é alterado** por este fluxo.

---

## POST `/api/forex-rendimento/v1/submit_performance`

**Body (JSON)** — mesmos campos do plugin:

```json
{
  "email_hash": "ab12cd",
  "numero_conta": "12345678",
  "system_id": "MEU_ROBO_ID",
  "corretora": "Corretora X",
  "ativo": "EURUSD",
  "lucro": 0,
  "drawdown": -1.5,
  "saldo_inicial": 1000,
  "saldo_final": 1050,
  "depositos": 0,
  "setup_file": "... conteúdo do setup ..."
}
```

**Obrigatórios:** `email_hash`, `numero_conta`, `system_id`, `setup_file` (não vazio).

**Resposta sucesso (200):** `status`, `message`, `debug` com campos de auditoria (como no PHP).

**Idempotência:** atualiza o **mesmo** registro lógico identificado por `(email_hash, numero_conta, system_id, corretora, ativo)` — mesma chave do plugin.

---

## GET `/api/forex-rendimento/v1/get_ranking?period=7`

`period` ∈ `7`, `15`, `30` (default 7).

**Resposta:** array de objetos com `rank`, `usuario`, `corretora`, `robo`, `ativo`, `lucro_percent`, `drawdown`, `saldo_inicial`, `saldo_final`, `depositos`, `setup_id`.

---

## GET `/api/forex-rendimento/v1/download_setup?id=<rankingEntryId>`

Retorna arquivo texto **Windows-1252** (paridade MetaTrader), `Content-Disposition: attachment; filename="setup_trader_<id>.set"`.

---

## Hash de email (`email_hash`)

Mesma regra do PHP (`RankingEndpoint` / EA):

- Se `strlen(email) >= 5`: `substr(email, 0, 2) + strlen(email) + substr(email, -2)`.
- Senão: `"anon"`.

---

## POST `/api/forex-rendimento/v1/webhook` (Hotmart / genérico)

**Headers (um de):** `hottok`, `x-hotmart-hottok`, `x-webhook-token` — valor deve ser igual ao configurado em `Setting` **`forex_webhook_token`** (obrigatório em produção).

**Body:** payload JSON Hotmart (eventos `PURCHASE_APPROVED`, `PURCHASE_COMPLETE`, cancelamentos, etc.) — processamento alinhado a `WebhookProcessor`.

**Idempotência:** `event_id` da transação em `License.eventId` (unique). Compras novas sempre criam nova licença. Renovações estendem via `subscriber_code` + `offerCode`/plano.

**Planos e systemId:** Vários produtos/planos podem compartilhar o mesmo `systemId` no cadastro. O que diferencia Anual, Desafio, Vitalício etc. é o **código da oferta Hotmart** (`purchase.offer.code`), gravado em `License.offerCode` e usado para resolver produto, plano e duração. O EA continua enviando apenas `system_id` na validação; licenças do mesmo plano (mesmo offerCode) com contas MT5 diferentes são distinguidas pelo `numero_conta`.

---

## Migração de URL no EA

Substituir:

`https://site-wordpress.com/wp-json/forex-rendimento/v1/...`

por:

`https://<API-da-biblioteca>/api/forex-rendimento/v1/...`
