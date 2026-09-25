# wa-linked-client

A minimal, self-hosted mobile web client for WhatsApp — connect as a linked
device (like WhatsApp Web) and read/send messages from a lightweight PWA you
can add to your phone's home screen.

No AI, no third-party data sharing, no official Business API. Just a thin,
authenticated proxy between you and your own WhatsApp account, built on
[WAHA](https://github.com/devlikeapro/waha) (NOWEB engine, no Chromium).

## What this is (and isn't)

- **Is**: a single-user personal client. One password protects the whole app.
- **Supports multiple WhatsApp accounts** ("sessions") from the same
  instance — link several numbers and switch between them.
- **Is not** a multi-tenant SaaS, a bot framework, or a CRM. If you want AI
  drafting, transcription, or CRM features, look at other projects in the WAHA
  ecosystem instead.
- **Is not** able to make or receive WhatsApp calls (voice/video). No
  unofficial WhatsApp library — WAHA, Baileys, whatsapp-web.js, OpenWA —
  supports this; it is a protocol-level limitation, not something this
  project can add.

## Before you use this

WhatsApp does not officially support third-party clients connecting as a
linked device outside their own apps. Using this is against WhatsApp's Terms
of Service in spirit, and while linked-device connections are a normal,
supported WhatsApp *feature*, accounts using unofficial automation/clients
can in principle be flagged or banned. Nobody can quantify the risk. Use at
your own discretion, on an account you're comfortable taking that risk with.

This project is not affiliated with, endorsed by, or connected to WhatsApp or
Meta in any way.

## Architecture

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│   Your       │◄────►│   backend    │◄────►│    WAHA      │◄──► WhatsApp
│   phone (PWA)│ HTTPS│  (Express)   │ HTTP │ (NOWEB/Baileys)│
└─────────────┘      └──────────────┘      └─────────────┘
```

- **WAHA** holds the actual WhatsApp linked-device session(s) and exposes a
  REST API. Runs the NOWEB engine — no headless Chromium, low memory
  footprint.
- **backend** is a small Express app: single-password login (cookie
  session), and an authenticated proxy to WAHA's API. Nothing here talks to
  WhatsApp directly.
- **public/** is a static, mobile-first PWA: account list → chat list →
  thread, with text and media (image/video/document) send & receive.

Both WAHA and the backend are only exposed on `127.0.0.1` — put your own
reverse proxy (nginx, Caddy, ...) with TLS in front for real use.

## Requirements

- Docker + Docker Compose
- A domain (or subdomain) pointed at your server, with HTTPS — required for
  the PWA install prompt and for iOS "Add to Home Screen" to work well
- ~1 GB of free RAM (WAHA's NOWEB engine is light; still needs headroom)

## Setup

```bash
git clone https://github.com/edddh/wa-linked-client.git
cd wa-linked-client
cp .env.example .env
```

Edit `.env` and fill in three values (all required):

```ini
WAHA_API_KEY=...      # openssl rand -hex 24
APP_PASSWORD=...      # your own login password for the web app
SESSION_SECRET=...    # openssl rand -hex 32
```

Start it:

```bash
docker compose up -d --build
```

Put a reverse proxy in front of `127.0.0.1:3011` (the backend) with a real
TLS certificate — e.g. nginx + certbot. See `nginx.example.conf` for a
starting point.

## Using it

1. Open your domain in a browser, log in with `APP_PASSWORD`.
2. Tap **"+ Aggiungi account"** to create a WhatsApp session, or tap an
   existing one.
3. Scan the QR code from your phone: WhatsApp → **Settings → Linked
   devices → Link a device**.
4. Once connected, browse chats and send/receive text, images, videos and
   documents.
5. On iPhone: Safari → Share → **Add to Home Screen** for an app-like icon.

## License

MIT — see [LICENSE](LICENSE).
