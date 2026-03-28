# rays-kitchen-server

## Required environment variables

The server **will not start** unless these are set:

| Variable | Description |
|---|---|
| `SESSION_SECRET` | Long random secret for `express-session` cookie signing |
| `ADMIN_API_KEY` | Strong random key for admin API endpoints (`x-admin-key` header) |
| `WHATSAPP_AGENT_SECRET` | Shared secret between this server and the WhatsApp agent (`x-secret` header) |

Optional:

| Variable | Default | Description |
|---|---|---|
| `ORDER_BACKEND_URL` | `https://admin.healthymealspot.com` | Orders backend base URL |
| `ALLOWED_HOSTS` | `healthymealspot.com,...` | Comma-separated allowed `Host` header values |
| `USE_AI_ETA` | — | Set to `true` to enable OpenAI-powered ETA estimates |
| `OPENAI_API_KEY` | — | Required when `USE_AI_ETA=true` |
| `NODE_ENV` | — | Set to `production` to enable secure cookies |
| `ENABLE_GEO_LOGS` | `false` | Set to `true` to enable IP geolocation lookups and append request lines to `logs/access.log` |
| `SKIP_MENU_PDF` | `false` in production | In non-production, set to `1` or `true` to make `/menu.pdf` return a friendly `503` without loading `pdf-lib` or fonts |
| `DISABLE_AGENT_CALLS` | `false` in production | In non-production, set to `1` or `true` to make `/api/chat` return `agent disabled in this environment` instead of calling the WhatsApp agent |

Example `.env`:
```
SESSION_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
ADMIN_API_KEY=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
WHATSAPP_AGENT_SECRET=<same value set in the whatsapp-agent config/settings.json api.secret>
NODE_ENV=production
```

Notes:
- `ENABLE_GEO_LOGS` is off by default, which avoids `ipapi.co` lookups and `logs/access.log` writes during local development.
- `SKIP_MENU_PDF` and `DISABLE_AGENT_CALLS` are intended for local/dev work and are ignored when `NODE_ENV=production`.

## WhatsApp webhook
- Set env vars before starting the server:
  - `WHATSAPP_VERIFY_TOKEN`: token you configured in Meta App dashboard.
  - `WHATSAPP_APP_SECRET`: app secret from Meta (enables signature validation).
- You can also store these in `config/whatsapp-webhook.json` (committed):
  ```json
  { "verifyToken": "set-your-verify-token", "appSecret": "" }
  ```
- Callback URL: `https://<your-domain>/webhooks/whatsapp`
- Meta will call `GET /webhooks/whatsapp` to verify; it returns the `hub.challenge` when the token matches.
- Incoming events are accepted on `POST /webhooks/whatsapp` and logged to `logs/whatsapp-webhook.log`.
