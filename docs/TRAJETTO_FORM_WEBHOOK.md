# Formulário Trajetto → webhook de teste

O embed da Trajetto envia para `api.trajettu.com/.../submit` um JSON no formato:

```json
{
  "fn": "nome",
  "ln": "sobrenome",
  "email": "lead@email.com",
  "phone": "+5511999999999",
  "event_id": "...",
  "fields": { "fullname": "...", "email": "...", "ddi": "+55", "phone": "..." }
}
```

Nosso endpoint `POST /api/webhooks/tash?token=...` aceita exatamente esse payload.

## Integração (formulário sem webhook nativo)

No `handleTrkSubmit`, depois de montar `data` e **junto** do fetch da Trajetto, adicione:

```js
try {
  await fetch('https://app.forexrendimento.com/api/webhooks/tash?token=SEU_TOKEN', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
} catch (_e) {}
```

Assim a Trajetto continua recebendo o lead (tracker/CRM) e a área de membros libera a licença de 7 dias com o mesmo `data`.
