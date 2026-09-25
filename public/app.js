const screens = {
  accounts: document.getElementById("accounts-screen"),
  setup: document.getElementById("setup-screen"),
  chats: document.getElementById("chats-screen"),
  thread: document.getElementById("thread-screen"),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => (s.hidden = true));
  screens[name].hidden = false;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body instanceof FormData ? options.headers : { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (res.status === 401) {
    window.location.href = "/login.html";
    throw new Error("unauthorized");
  }
  return res;
}

let currentSession = null;
let currentChatId = null;
let accountsPollTimer = null;
let setupPollTimer = null;
let threadPollTimer = null;
let listPollTimer = null;

function initials(name) {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}

function statusLabel(status) {
  const map = {
    WORKING: "Connesso",
    SCAN_QR_CODE: "In attesa di scansione",
    SCAN_QR: "In attesa di scansione",
    STARTING: "Avvio...",
    STOPPED: "Fermo",
    FAILED: "Errore",
  };
  return map[status] || status || "Sconosciuto";
}

function statusClass(status) {
  if (status === "WORKING") return "ok";
  if (status === "SCAN_QR_CODE" || status === "SCAN_QR" || status === "STARTING") return "warn";
  return "err";
}

// --- Accounts screen ---
async function startAccountsScreen() {
  clearInterval(setupPollTimer);
  clearInterval(listPollTimer);
  clearInterval(threadPollTimer);
  currentSession = null;
  currentChatId = null;
  showScreen("accounts");
  await loadAccounts();
  clearInterval(accountsPollTimer);
  accountsPollTimer = setInterval(loadAccounts, 8000);
}

async function loadAccounts() {
  const res = await api("/api/sessions");
  if (!res.ok) return;
  const sessions = await res.json();
  const list = document.getElementById("account-list");
  list.innerHTML = "";
  (Array.isArray(sessions) ? sessions : []).forEach((s) => {
    const li = document.createElement("li");
    li.className = "chat-item";
    const label = s.me?.pushName || s.name;
    li.innerHTML = `
      <div class="avatar">${initials(label)}</div>
      <div class="meta">
        <div class="name">${label}</div>
        <div class="preview status-${statusClass(s.status)}">${statusLabel(s.status)}</div>
      </div>
    `;
    li.addEventListener("click", () => openAccount(s.name, s.status));
    list.appendChild(li);
  });
}

async function openAccount(name, status) {
  currentSession = name;
  if (status === "WORKING") {
    startChatsScreen();
  } else {
    startSetupScreen();
  }
}

document.getElementById("add-account-btn").addEventListener("click", async () => {
  const name = window.prompt("Nome per il nuovo account (es. lavoro, personale):");
  if (!name) return;
  const clean = name.trim().replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40);
  if (!clean) return;
  const res = await api("/api/sessions", { method: "POST", body: JSON.stringify({ name: clean }) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error || "Impossibile creare l'account");
    return;
  }
  currentSession = clean;
  startSetupScreen();
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  window.location.href = "/login.html";
});

// --- Setup / QR screen ---
function startSetupScreen() {
  clearInterval(accountsPollTimer);
  showScreen("setup");
  document.getElementById("setup-title").textContent = currentSession;
  const statusEl = document.getElementById("setup-status");
  const qrImg = document.getElementById("qr-image");
  const refreshBtn = document.getElementById("refresh-qr");

  async function tick() {
    if (!currentSession) return;
    const res = await api(`/api/sessions/${encodeURIComponent(currentSession)}`);
    const data = await res.json();
    const status = data.status || "UNKNOWN";

    if (status === "WORKING") {
      qrImg.hidden = true;
      refreshBtn.hidden = true;
      clearInterval(setupPollTimer);
      startChatsScreen();
      return;
    }

    if (status === "SCAN_QR_CODE" || status === "SCAN_QR") {
      statusEl.textContent = "Inquadra il QR con WhatsApp (Dispositivi collegati)";
      qrImg.src = `/api/sessions/${encodeURIComponent(currentSession)}/qr?t=${Date.now()}`;
      qrImg.hidden = false;
      refreshBtn.hidden = false;
    } else if (status === "STOPPED" || status === "FAILED" || status === "UNKNOWN") {
      statusEl.textContent = "Avvio sessione...";
      qrImg.hidden = true;
      await api(`/api/sessions/${encodeURIComponent(currentSession)}/start`, { method: "POST" }).catch(() => {});
    } else {
      statusEl.textContent = `Stato: ${statusLabel(status)}...`;
      qrImg.hidden = true;
    }
  }

  refreshBtn.onclick = () => {
    qrImg.src = `/api/sessions/${encodeURIComponent(currentSession)}/qr?t=${Date.now()}`;
  };

  tick();
  clearInterval(setupPollTimer);
  setupPollTimer = setInterval(tick, 3000);
}

document.getElementById("setup-back-btn").addEventListener("click", () => {
  clearInterval(setupPollTimer);
  startAccountsScreen();
});

// --- Chat list screen ---
async function startChatsScreen() {
  clearInterval(listPollTimer);
  showScreen("chats");
  document.getElementById("chats-title").textContent = currentSession;
  await loadChats();
  listPollTimer = setInterval(loadChats, 15000);
}

document.getElementById("chats-back-btn").addEventListener("click", () => {
  startAccountsScreen();
});

async function loadChats() {
  if (!currentSession) return;
  const res = await api(`/api/sessions/${encodeURIComponent(currentSession)}/chats?limit=50`);
  if (!res.ok) return;
  const chats = await res.json();
  const list = document.getElementById("chat-list");
  list.innerHTML = "";
  (Array.isArray(chats) ? chats : []).forEach((chat) => {
    const name = chat.name || chat.id?.split("@")[0] || "Sconosciuto";
    const lastBody = chat.lastMessage?.body || "";
    const li = document.createElement("li");
    li.className = "chat-item";
    li.innerHTML = `
      <div class="avatar">${chat.picture ? `<img src="${chat.picture}" />` : initials(name)}</div>
      <div class="meta">
        <div class="name">${name}</div>
        <div class="preview">${lastBody}</div>
      </div>
    `;
    li.addEventListener("click", () => openThread(chat.id, name));
    list.appendChild(li);
  });
}

// --- Thread screen ---
async function openThread(chatId, name) {
  currentChatId = chatId;
  document.getElementById("thread-title").textContent = name;
  showScreen("thread");
  await loadMessages();
  clearInterval(threadPollTimer);
  threadPollTimer = setInterval(loadMessages, 4000);
  api(`/api/sessions/${encodeURIComponent(currentSession)}/chats/${encodeURIComponent(chatId)}/read`, {
    method: "POST",
  }).catch(() => {});
}

async function loadMessages() {
  if (!currentChatId || !currentSession) return;
  const res = await api(
    `/api/sessions/${encodeURIComponent(currentSession)}/chats/${encodeURIComponent(currentChatId)}/messages?limit=50`
  );
  if (!res.ok) return;
  const messages = await res.json();
  const box = document.getElementById("messages");
  const wasAtBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
  box.innerHTML = "";
  (Array.isArray(messages) ? messages : [])
    .slice()
    .reverse()
    .forEach((m) => {
      const div = document.createElement("div");
      div.className = `bubble ${m.fromMe ? "out" : "in"}`;

      const media = m.media || (m.hasMedia ? m._data?.media : null);
      if (media && media.url) {
        const proxied = `/api/media/proxy?url=${encodeURIComponent(media.url)}`;
        const mimetype = media.mimetype || "";
        if (mimetype.startsWith("image/")) {
          const img = document.createElement("img");
          img.src = proxied;
          img.className = "bubble-media-img";
          div.appendChild(img);
        } else if (mimetype.startsWith("video/")) {
          const video = document.createElement("video");
          video.src = proxied;
          video.controls = true;
          video.className = "bubble-media-video";
          div.appendChild(video);
        } else {
          const link = document.createElement("a");
          link.href = proxied;
          link.target = "_blank";
          link.rel = "noopener";
          link.className = "bubble-media-file";
          link.textContent = `📎 ${media.filename || "Allegato"}`;
          div.appendChild(link);
        }
        if (m.caption || m.body) {
          const cap = document.createElement("div");
          cap.className = "bubble-caption";
          cap.textContent = m.caption || m.body;
          div.appendChild(cap);
        }
      } else {
        div.textContent = m.body || m.caption || "[messaggio non testuale]";
      }
      box.appendChild(div);
    });
  if (wasAtBottom) box.scrollTop = box.scrollHeight;
}

document.getElementById("back-btn").addEventListener("click", () => {
  clearInterval(threadPollTimer);
  currentChatId = null;
  startChatsScreen();
});

document.getElementById("send-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("text-input");
  const text = input.value.trim();
  if (!text || !currentChatId || !currentSession) return;
  input.value = "";
  await api(`/api/sessions/${encodeURIComponent(currentSession)}/chats/${encodeURIComponent(currentChatId)}/send`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  await loadMessages();
});

document.getElementById("attach-btn").addEventListener("click", () => {
  document.getElementById("file-input").click();
});

document.getElementById("file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !currentChatId || !currentSession) return;
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(currentSession)}/chats/${encodeURIComponent(currentChatId)}/send-media`,
    { method: "POST", body: formData }
  );
  if (res.status === 401) {
    window.location.href = "/login.html";
    return;
  }
  await loadMessages();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

startAccountsScreen();
