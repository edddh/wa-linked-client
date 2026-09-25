const screens = {
  accounts: document.getElementById("accounts-screen"),
  setup: document.getElementById("setup-screen"),
  chats: document.getElementById("chats-screen"),
  thread: document.getElementById("thread-screen"),
  preview: document.getElementById("preview-screen"),
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
let renderedMessageIds = [];

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
    const avatarId = `acct-avatar-${s.name}`;
    li.innerHTML = `
      <div class="avatar" id="${avatarId}">${initials(label)}</div>
      <div class="meta">
        <div class="name">${label}</div>
        <div class="preview status-${statusClass(s.status)}">${statusLabel(s.status)}</div>
      </div>
    `;
    li.addEventListener("click", () => openAccount(s.name, s.status));
    list.appendChild(li);

    if (s.status === "WORKING") {
      api(`/api/sessions/${encodeURIComponent(s.name)}/profile`)
        .then((r) => (r.ok ? r.json() : null))
        .then((profile) => {
          if (!profile?.picture) return;
          const el = document.getElementById(avatarId);
          if (!el) return;
          el.innerHTML = "";
          const img = document.createElement("img");
          img.src = profile.picture;
          el.appendChild(img);
        })
        .catch(() => {});
    }
  });
}

const LAST_SESSION_KEY = "waClientLastSession";

async function openAccount(name, status) {
  currentSession = name;
  localStorage.setItem(LAST_SESSION_KEY, name);
  if (status === "WORKING") {
    startChatsScreen();
  } else {
    startSetupScreen();
  }
}

const newAccountOverlay = document.getElementById("new-account-overlay");
const newAccountModal = document.getElementById("new-account-modal");
const newAccountName = document.getElementById("new-account-name");
const newAccountError = document.getElementById("new-account-error");

function openNewAccountModal() {
  newAccountError.hidden = true;
  newAccountName.value = "Personale";
  newAccountOverlay.hidden = false;
  newAccountModal.hidden = false;
  newAccountName.focus();
  newAccountName.select();
}

function closeNewAccountModal() {
  newAccountOverlay.hidden = true;
  newAccountModal.hidden = true;
}

document.getElementById("add-account-btn").addEventListener("click", openNewAccountModal);
document.getElementById("new-account-cancel").addEventListener("click", closeNewAccountModal);
newAccountOverlay.addEventListener("click", closeNewAccountModal);

document.getElementById("new-account-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const clean = newAccountName.value.trim().replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40);
  if (!clean) {
    newAccountError.textContent = "Inserisci un nome valido";
    newAccountError.hidden = false;
    return;
  }
  const res = await api("/api/sessions", { method: "POST", body: JSON.stringify({ name: clean }) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    newAccountError.textContent = err.error || "Impossibile creare l'account";
    newAccountError.hidden = false;
    return;
  }
  closeNewAccountModal();
  currentSession = clean;
  localStorage.setItem(LAST_SESSION_KEY, clean);
  startSetupScreen();
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  localStorage.removeItem(LAST_SESSION_KEY);
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
  loadChatsTitle();
  await loadChats();
  listPollTimer = setInterval(loadChats, 15000);
}

async function loadChatsTitle() {
  try {
    const res = await api(`/api/sessions/${encodeURIComponent(currentSession)}/profile`);
    if (!res.ok) return;
    const profile = await res.json();
    document.getElementById("chats-title").textContent = profile.name || currentSession;
  } catch {
    // nice-to-have; ignore failures
  }
}

document.getElementById("chats-back-btn").addEventListener("click", () => {
  localStorage.removeItem(LAST_SESSION_KEY);
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
function scrollToBottom(box) {
  box.scrollTop = box.scrollHeight;
  // images/videos report scrollHeight before they've finished loading their
  // own dimensions, so the initial scroll can land short; correct it once
  // each media element actually loads.
  box.querySelectorAll("img, video").forEach((el) => {
    const fix = () => {
      box.scrollTop = box.scrollHeight;
    };
    if (el.tagName === "IMG") {
      if (el.complete) fix();
      else el.addEventListener("load", fix, { once: true });
    } else {
      el.addEventListener("loadedmetadata", fix, { once: true });
    }
  });
}

function buildBubble(m) {
  const div = document.createElement("div");
  div.className = `bubble ${m.fromMe ? "out" : "in"}`;

  const media = m.media || (m.hasMedia ? m._data?.media : null);
  if (media && media.url) {
    const proxied = `/api/media/proxy?url=${encodeURIComponent(media.url)}`;
    const mimetype = media.mimetype || "";
    if (mimetype.startsWith("image/")) {
      const img = document.createElement("img");
      img.src = proxied;
      img.loading = "lazy";
      img.className = "bubble-media-img";
      div.appendChild(img);
    } else if (mimetype.startsWith("video/")) {
      const video = document.createElement("video");
      video.src = proxied;
      video.controls = true;
      video.preload = "metadata";
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
  return div;
}

const MESSAGES_PAGE_SIZE = 50;
let messagesLimit = MESSAGES_PAGE_SIZE;
let hasMoreMessages = true;
let isLoadingMoreMessages = false;

async function openThread(chatId, name) {
  currentChatId = chatId;
  renderedMessageIds = [];
  messagesLimit = MESSAGES_PAGE_SIZE;
  hasMoreMessages = true;
  document.getElementById("messages").innerHTML = "";
  document.getElementById("thread-title").textContent = name;
  showScreen("thread");
  await loadMessages();
  clearInterval(threadPollTimer);
  threadPollTimer = setInterval(loadMessages, 4000);
  api(`/api/sessions/${encodeURIComponent(currentSession)}/chats/${encodeURIComponent(chatId)}/read`, {
    method: "POST",
  }).catch(() => {});
}

document.getElementById("messages").addEventListener("scroll", async (e) => {
  const box = e.target;
  if (box.scrollTop > 60 || isLoadingMoreMessages || !hasMoreMessages || !currentChatId) return;
  isLoadingMoreMessages = true;
  messagesLimit += MESSAGES_PAGE_SIZE;
  await loadMessages({ preserveScroll: true });
  isLoadingMoreMessages = false;
});

async function loadMessages({ preserveScroll = false } = {}) {
  if (!currentChatId || !currentSession) return;
  const res = await api(
    `/api/sessions/${encodeURIComponent(currentSession)}/chats/${encodeURIComponent(currentChatId)}/messages?limit=${messagesLimit}`
  );
  if (!res.ok) return;
  const messages = await res.json();
  const rawList = Array.isArray(messages) ? messages : [];
  hasMoreMessages = rawList.length >= messagesLimit;
  const ordered = rawList.slice().reverse();
  const ids = ordered.map((m) => m.id);

  const sameAsBefore =
    ids.length === renderedMessageIds.length && ids.every((id, i) => id === renderedMessageIds[i]);
  if (sameAsBefore) return;

  const box = document.getElementById("messages");

  // If only new messages were appended at the end, just append the diff
  // instead of rebuilding the whole list (avoids re-fetching/re-decoding
  // every image and video on each poll tick, which caused visible flicker).
  const isAppendOnly =
    ids.length > renderedMessageIds.length &&
    renderedMessageIds.every((id, i) => id === ids[i]);

  if (isAppendOnly) {
    ordered.slice(renderedMessageIds.length).forEach((m) => box.appendChild(buildBubble(m)));
    scrollToBottom(box);
  } else if (preserveScroll) {
    const prevScrollHeight = box.scrollHeight;
    const prevScrollTop = box.scrollTop;
    box.innerHTML = "";
    ordered.forEach((m) => box.appendChild(buildBubble(m)));
    box.scrollTop = box.scrollHeight - prevScrollHeight + prevScrollTop;
  } else {
    const wasAtBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
    box.innerHTML = "";
    ordered.forEach((m) => box.appendChild(buildBubble(m)));
    if (wasAtBottom) scrollToBottom(box);
  }
  renderedMessageIds = ids;
}

document.getElementById("back-btn").addEventListener("click", () => {
  clearInterval(threadPollTimer);
  currentChatId = null;
  startChatsScreen();
});

const textInput = document.getElementById("text-input");

textInput.addEventListener("input", () => {
  textInput.style.height = "auto";
  textInput.style.height = `${Math.min(textInput.scrollHeight, 120)}px`;
});

textInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    document.getElementById("send-form").requestSubmit();
  }
});

document.getElementById("send-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = textInput.value.trim();
  if (!text || !currentChatId || !currentSession) return;
  textInput.value = "";
  textInput.style.height = "auto";
  await api(`/api/sessions/${encodeURIComponent(currentSession)}/chats/${encodeURIComponent(currentChatId)}/send`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  await loadMessages();
});

const attachMenu = document.getElementById("attach-menu");
const attachOverlay = document.getElementById("attach-overlay");
const attachInputs = {
  camera: document.getElementById("file-input-camera"),
  gallery: document.getElementById("file-input-gallery"),
  document: document.getElementById("file-input-document"),
};

function closeAttachMenu() {
  attachMenu.hidden = true;
  attachOverlay.hidden = true;
}

document.getElementById("attach-btn").addEventListener("click", () => {
  attachMenu.hidden = false;
  attachOverlay.hidden = false;
});

attachOverlay.addEventListener("click", closeAttachMenu);

attachMenu.querySelectorAll("button[data-kind]").forEach((btn) => {
  btn.addEventListener("click", () => {
    attachInputs[btn.dataset.kind].click();
    closeAttachMenu();
  });
});

async function uploadAttachment(file, caption) {
  if (!file || !currentChatId || !currentSession) return;
  const formData = new FormData();
  formData.append("file", file);
  if (caption) formData.append("caption", caption);
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(currentSession)}/chats/${encodeURIComponent(currentChatId)}/send-media`,
    { method: "POST", body: formData }
  );
  if (res.status === 401) {
    window.location.href = "/login.html";
    return;
  }
  const box = document.getElementById("messages");
  await loadMessages();
  scrollToBottom(box);
  // WAHA's own message store can lag a moment after sending; retry once so
  // the just-sent attachment is picked up and scrolled into view.
  setTimeout(async () => {
    await loadMessages();
    scrollToBottom(box);
  }, 1200);
}

let pendingFile = null;
let pendingPreviewUrl = null;

function showAttachmentPreview(file) {
  pendingFile = file;
  const body = document.getElementById("preview-body");
  body.innerHTML = "";
  if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
  pendingPreviewUrl = URL.createObjectURL(file);

  if (file.type.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = pendingPreviewUrl;
    img.className = "preview-media";
    body.appendChild(img);
  } else if (file.type.startsWith("video/")) {
    const video = document.createElement("video");
    video.src = pendingPreviewUrl;
    video.controls = true;
    video.className = "preview-media";
    body.appendChild(video);
  } else {
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (ext === "pdf" && window.pdfjsLib) {
      renderPdfThumbnail(file, body).catch(() => showFileIconCard(file, ext, body));
    } else {
      showFileIconCard(file, ext, body);
    }
  }

  document.getElementById("preview-caption").value = "";
  showScreen("preview");
}

function showFileIconCard(file, ext, body) {
  const colorClass = ["doc", "docx"].includes(ext)
    ? "doc-word"
    : ["xls", "xlsx", "csv"].includes(ext)
    ? "doc-excel"
    : ["ppt", "pptx"].includes(ext)
    ? "doc-powerpoint"
    : ext === "pdf"
    ? "doc-pdf"
    : "attach-icon-document";
  const card = document.createElement("div");
  card.className = "preview-file-card";
  card.innerHTML = `
    <span class="attach-icon ${colorClass}" style="width:64px;height:64px">
      <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
    </span>
    <div class="preview-file-name">${file.name}</div>
  `;
  body.appendChild(card);
}

async function renderPdfThumbnail(file, body) {
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  const page = await pdf.getPage(1);
  const unscaled = page.getViewport({ scale: 1 });
  const targetWidth = Math.min(320, body.clientWidth || 320);
  const scale = targetWidth / unscaled.width;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.className = "preview-pdf-canvas";
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  body.innerHTML = "";
  body.appendChild(canvas);
}

document.getElementById("preview-cancel-btn").addEventListener("click", () => {
  pendingFile = null;
  showScreen("thread");
});

document.getElementById("preview-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = pendingFile;
  const caption = document.getElementById("preview-caption").value.trim();
  pendingFile = null;
  showScreen("thread");
  await uploadAttachment(file, caption);
});

Object.values(attachInputs).forEach((input) => {
  input.addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) showAttachmentPreview(file);
  });
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

async function init() {
  const saved = localStorage.getItem(LAST_SESSION_KEY);
  if (saved) {
    try {
      const res = await api(`/api/sessions/${encodeURIComponent(saved)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === "WORKING") {
          currentSession = saved;
          startChatsScreen();
          return;
        }
      }
    } catch {
      // fall through to accounts screen
    }
    localStorage.removeItem(LAST_SESSION_KEY);
  }
  startAccountsScreen();
}

init();
