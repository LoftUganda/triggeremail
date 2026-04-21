# Trigger Email

Cloudflare Worker that mirrors the [Firebase firestore-send-email extension](https://firebase.google.com/docs/extensions/official/firestore-send-email) — persist email documents in D1, send via Cloudflare Email Workers, use templates, and receive delivery webhooks.

## Features

- **REST API** for creating and managing emails and templates
- **Template rendering** with `{{variable}}` interpolation stored in D1
- **Attachment support** — inline `content` or remote `href` (fetched server-side)
- **Delivery state tracking**: `PENDING → PROCESSING → SUCCESS | ERROR | RETRY`
- **Webhook events** (onPending, onStart, onSuccess, onError, onRetry)
- **Retry endpoint** for failed emails

## API Endpoints

### POST /mail

Create and send an email.

```json
{
  "to": "alice@example.com",
  "cc": ["bob@example.com"],
  "bcc": ["secret@example.com"],
  "from": "notifications@example.com",
  "replyTo": "support@example.com",
  "headers": {
    "X-Custom-Header": "value"
  },
  "message": {
    "subject": "Hello World",
    "text": "Plain text body",
    "html": "<p>HTML body</p>",
    "messageId": "<uuid@example.com>",
    "attachments": [
      {
        "filename": "report.pdf",
        "content": "JVBERi0...",
        "contentType": "application/pdf"
      },
      {
        "filename": "download.pdf",
        "href": "https://example.com/files/report.pdf",
        "contentType": "application/pdf"
      }
    ]
  },
  "template": {
    "name": "welcome-email",
    "data": { "userName": "Alice" }
  }
}
```

At least one of `message.text`, `message.html`, or `template` is required. At least one recipient (`to`, `cc`, or `bcc`) is required.

**Attachment fields:** `filename`, `content` (string/ArrayBuffer/Uint8Array), `href` (URL to fetch), `contentType`, `contentDisposition`, `cid`, `encoding`, `headers`

### GET /mail

List emails with pagination: `?limit=50&offset=0&state=ERROR`

### GET /mail/:id

Get a single email by ID.

### POST /mail/:id/retry

Re-attempt sending an email in `ERROR` or `RETRY` state.

### POST /templates

Create or update a template.

```json
{
  "name": "welcome-email",
  "subject": "Welcome, {{userName}}!",
  "text": "Hello {{userName}}, welcome to our service.",
  "html": "<p>Hello {{userName}}, welcome!</p>",
  "partial": false
}
```

At least one of `subject`, `text`, or `html` is required.

### GET /templates

List all templates.

### GET /templates/:name

Get a template by name.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DEFAULT_FROM` | Default sender address |
| `DEFAULT_REPLY_TO` | Default reply-to address |
| `WEBHOOK_URL` | URL to POST delivery events to |
| `WEBHOOK_SECRET` | Bearer token for webhook auth |

## Webhook Events

When `WEBHOOK_URL` is set, delivery events are fired via `fetch` in `waitUntil`:

| Event | When |
|-------|------|
| `onPending` | Mail document created in D1 |
| `onStart` | Before send attempt |
| `onSuccess` | Email sent successfully |
| `onError` | Send failed |
| `onRetry` | Retry initiated |

```json
{
  "event": "onSuccess",
  "timestamp": "2026-04-22T00:00:00.000Z",
  "data": { "id": "uuid", "to": ["alice@example.com"], "state": "SUCCESS", ... }
}
```

Authorization: `Authorization: Bearer <WEBHOOK_SECRET>`

## Delivery States

| State | Meaning |
|-------|---------|
| `PENDING` | Document created, not yet processing |
| `PROCESSING` | Send in progress |
| `SUCCESS` | Sent successfully |
| `ERROR` | Failed permanently |
| `RETRY` | Awaiting re-attempt |

## Templates

Templates use `{{variable}}` interpolation (no full Handlebars - Cloudflare Workers V8 isolate doesn't allow code generation from strings):

```
{{name}}           # escaped variable
{{user.address}}    # nested property access
```

## Setup

### 1. Configure bindings in `wrangler.jsonc`

```json
{
  "send_email": [{ "name": "SEND_EMAIL" }],
  "d1_databases": [{ "binding": "DB", "database_name": "trigger-email-db" }],
  "vars": {
    "DEFAULT_FROM": "noreply@example.com",
    "DEFAULT_REPLY_TO": "support@example.com"
  }
}
```

### 2. Create D1 database

```bash
npx wrangler d1 create trigger-email-db
# Update wrangler.jsonc with the returned database_id
```

### 3. Set webhook secrets (optional)

```bash
npx wrangler secret put WEBHOOK_URL
npx wrangler secret put WEBHOOK_SECRET
```

### 4. Deploy

```bash
npm run deploy
```

## Development

```bash
npm run dev   # Run worker locally via wrangler dev
npm test      # Run unit tests
```

## Differences from Firebase firestore-send-email

| Feature | Firebase | This Worker |
|---------|----------|-------------|
| Trigger | Firestore `onDocumentWritten` | REST API |
| Backend | Nodemailer / SendGrid | Cloudflare Email Workers |
| Auth | SMTP OAuth2 | Cloudflare email binding |
| Templates | Full Handlebars | Simple `{{variable}}` interpolation |
| Attachments | nodemailer spec | `content` or `href` (server-fetched) |
| UID recipients | `toUids`/`ccUids`/`bccUids` | Not supported |
| SendGrid features | Categories, dynamic templates | Not supported |
| AMP email | Supported | Not supported |
| TTL expiration | Firestore TTL policies | Not supported |

## License

ISC