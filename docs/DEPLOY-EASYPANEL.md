# Deploy EasyPanel — uploads e erro 502

## Erro 502 ao enviar mídia

HTTP **502** significa que o proxy (Traefik/Nginx do EasyPanel) **não recebeu resposta** do container Node — não é validação de WebP no código.

### Checklist

1. **Variável de ambiente**
   - `UPLOAD_DIR=/app/uploads` (mesmo caminho do volume)

2. **Volume persistente**
   - Um volume basta: destino no container **`/app/uploads`** (como no EasyPanel)

3. **Deploy**
   - Após cada deploy, aguarde ~30s (migração Prisma no boot) antes de testar upload.

4. **Health**
   - Abra: `https://forexrendimento.com/api/health`
   - Deve retornar `"uploadsWritable": true` e `"uploadDir": "/app/uploads"`.

5. **Proxy**
   - Todo tráfego `https://app…/` deve ir para a **porta 3000** do container (um único serviço Node serve API + frontend).
   - Não use um serviço só estático para `/` e outro morto para `/api`.

6. **Limites do proxy** (se ainda der 502 em arquivos grandes)
   - `client_max_body_size 80m;`
   - `proxy_read_timeout 120s;`
   - `proxy_send_timeout 120s;`

### Comando de migração manual (SSH/console do container)

```bash
npx prisma migrate deploy
```

### Erro P3019 (`migration_lock.toml` vs PostgreSQL)

Se o log mostrar **P3019** no boot, o `migration_lock.toml` estava desalinhado com o `schema.prisma`. Corrija no repositório e faça redeploy.

### Sync de schema no boot (`prisma db push`)

O `scripts/db-boot.sh` usa `prisma db push --accept-data-loss` em vez de `migrate deploy` porque:

- O banco em produção foi criado com `db push` (sem histórico em `_prisma_migrations`).
- `migrate deploy` exige histórico íntegro e gera erros **P3005**, **P3015** ou **P3017** quando o baseline não bate.
- `db push` é idempotente: se o schema já está em sync (caso atual), não faz nada e termina silencioso.

**Quando voltar a usar `migrate deploy`:** quando o banco em produção tiver migrações reais aplicadas e versionadas (ex.: depois de fazer baseline manual com `prisma migrate resolve --applied <nome>` para cada migração existente).
