import express from "express";
import cookieSession from "cookie-session";
import multer from "multer";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

const WAHA_URL = process.env.WAHA_URL || "http://waha:3000";
const WAHA_API_KEY = process.env.WAHA_API_KEY;
const APP_PASSWORD = process.env.APP_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const PORT = process.env.PORT || 3000;
const SESSION_NAME_RE = /^[A-Za-z0-9_-]{1,40}$/;

if (!WAHA_API_KEY || !APP_PASSWORD || !SESSION_SECRET) {
  console.error("Missing required env vars: WAHA_API_KEY, APP_PASSWORD, SESSION_SECRET");
  process.exit(1);
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(
  cookieSession({
    name: "wa_sess",
    secret: SESSION_SECRET,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  })
);

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.status(401).json({ error: "unauthorized" });
}

function requireValidSessionName(req, res, next) {
  if (!SESSION_NAME_RE.test(req.params.session || "")) {
    return res.status(400).json({ error: "invalid session name" });
  }
  next();
}

async function wahaFetch(pathname, options = {}) {
  return fetch(`${WAHA_URL}${pathname}`, {
    ...options,
    headers: {
      "X-Api-Key": WAHA_API_KEY,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
}

// --- Auth routes ---
app.post("/api/login", (req, res) => {
  const { password } = req.body || {};
  if (password && timingSafeEqual(password, APP_PASSWORD)) {
    req.session.authed = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: "wrong password" });
});

app.post("/api/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  res.json({ authed: !!(req.session && req.session.authed) });
});

// --- Account (WhatsApp session) management ---
app.get("/api/sessions", requireAuth, async (req, res) => {
  const r = await wahaFetch("/api/sessions");
  const body = await r.json().catch(() => []);
  res.status(r.status).json(body);
});

app.post("/api/sessions", requireAuth, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!SESSION_NAME_RE.test(name)) {
    return res.status(400).json({ error: "Nome account non valido (solo lettere, numeri, - e _)" });
  }
  const r = await wahaFetch("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      name,
      start: true,
      config: { noweb: { store: { enabled: true, fullSync: false } } },
    }),
  });
  const body = await r.json().catch(() => ({}));
  res.status(r.status).json(body);
});

app.get("/api/sessions/:session", requireAuth, requireValidSessionName, async (req, res) => {
  const r = await wahaFetch(`/api/sessions/${req.params.session}`);
  const body = await r.json().catch(() => ({}));
  res.status(r.status).json(body);
});

app.post("/api/sessions/:session/start", requireAuth, requireValidSessionName, async (req, res) => {
  const r = await wahaFetch(`/api/sessions/${req.params.session}/start`, { method: "POST" });
  const body = await r.json().catch(() => ({}));
  res.status(r.status).json(body);
});

app.post("/api/sessions/:session/restart", requireAuth, requireValidSessionName, async (req, res) => {
  const r = await wahaFetch(`/api/sessions/${req.params.session}/restart`, { method: "POST" });
  const body = await r.json().catch(() => ({}));
  res.status(r.status).json(body);
});

app.delete("/api/sessions/:session", requireAuth, requireValidSessionName, async (req, res) => {
  await wahaFetch(`/api/sessions/${req.params.session}/stop`, { method: "POST" }).catch(() => {});
  const r = await wahaFetch(`/api/sessions/${req.params.session}`, { method: "DELETE" });
  res.status(r.status).end();
});

app.get("/api/sessions/:session/qr", requireAuth, requireValidSessionName, async (req, res) => {
  const r = await wahaFetch(`/api/${req.params.session}/auth/qr`, {
    headers: { Accept: "image/png" },
  });
  if (!r.ok) return res.status(r.status).end();
  res.setHeader("Content-Type", "image/png");
  res.send(Buffer.from(await r.arrayBuffer()));
});

app.get("/api/sessions/:session/profile", requireAuth, requireValidSessionName, async (req, res) => {
  const r = await wahaFetch(`/api/${req.params.session}/profile`);
  const body = await r.json().catch(() => ({}));
  res.status(r.status).json(body);
});

// --- Chats & messages (per account) ---
app.get("/api/sessions/:session/chats", requireAuth, requireValidSessionName, async (req, res) => {
  const limit = req.query.limit || "50";
  const r = await wahaFetch(`/api/${req.params.session}/chats/overview?limit=${limit}`);
  const body = await r.json().catch(() => ({}));
  res.status(r.status).json(body);
});

app.get(
  "/api/sessions/:session/chats/:chatId/messages",
  requireAuth,
  requireValidSessionName,
  async (req, res) => {
    const limit = req.query.limit || "50";
    const chatId = encodeURIComponent(req.params.chatId);
    const r = await wahaFetch(
      `/api/${req.params.session}/chats/${chatId}/messages?limit=${limit}&downloadMedia=true`
    );
    const body = await r.json().catch(() => ({}));
    res.status(r.status).json(body);
  }
);

app.post(
  "/api/sessions/:session/chats/:chatId/send",
  requireAuth,
  requireValidSessionName,
  async (req, res) => {
    const { text } = req.body || {};
    if (!text || !text.trim()) return res.status(400).json({ error: "empty text" });
    const r = await wahaFetch("/api/sendText", {
      method: "POST",
      body: JSON.stringify({ chatId: req.params.chatId, text, session: req.params.session }),
    });
    const body = await r.json().catch(() => ({}));
    res.status(r.status).json(body);
  }
);

app.post(
  "/api/sessions/:session/chats/:chatId/send-media",
  requireAuth,
  requireValidSessionName,
  upload.single("file"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "no file" });
    const mimetype = req.file.mimetype || "application/octet-stream";
    const filename = req.file.originalname || "file";
    const data = req.file.buffer.toString("base64");
    const caption = req.body.caption || undefined;
    const payload = {
      session: req.params.session,
      chatId: req.params.chatId,
      caption,
      file: { mimetype, filename, data },
    };

    const endpoint = mimetype.startsWith("image/")
      ? "/api/sendImage"
      : mimetype.startsWith("video/")
      ? "/api/sendVideo"
      : "/api/sendFile";

    let r = await wahaFetch(endpoint, { method: "POST", body: JSON.stringify(payload) });
    if (!r.ok && endpoint !== "/api/sendFile") {
      // some image/video formats are rejected by the media endpoints; fall back to a plain document
      r = await wahaFetch("/api/sendFile", { method: "POST", body: JSON.stringify(payload) });
    }
    const body = await r.json().catch(() => ({}));
    res.status(r.status).json(body);
  }
);

app.post(
  "/api/sessions/:session/chats/:chatId/read",
  requireAuth,
  requireValidSessionName,
  async (req, res) => {
    const chatId = encodeURIComponent(req.params.chatId);
    const r = await wahaFetch(`/api/${req.params.session}/chats/${chatId}/messages/read`, {
      method: "POST",
    });
    res.status(r.status).end();
  }
);

app.get("/api/media/proxy", requireAuth, async (req, res) => {
  const target = req.query.url;
  if (!target || typeof target !== "string") return res.status(400).end();
  let relativePath;
  if (target.startsWith("/")) {
    relativePath = target;
  } else {
    try {
      const u = new URL(target);
      relativePath = u.pathname + u.search;
    } catch {
      return res.status(400).end();
    }
  }
  // relativePath is always re-fetched against our own WAHA_URL, never the
  // host embedded in the client-supplied url, so this can't be used as an
  // open proxy to arbitrary hosts.
  const r = await wahaFetch(relativePath);
  if (!r.ok) return res.status(r.status).end();
  res.setHeader("Content-Type", r.headers.get("content-type") || "application/octet-stream");
  res.send(Buffer.from(await r.arrayBuffer()));
});

// --- Static frontend ---
app.use(express.static(PUBLIC_DIR, { index: false }));

app.get("/", (req, res) => {
  if (!(req.session && req.session.authed)) {
    return res.redirect("/login.html");
  }
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`wa-client backend listening on :${PORT}`);
});
