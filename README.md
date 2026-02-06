# rays-kitchen-server

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
