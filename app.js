/* CCAR-F Flashcards — spaced repetition with localStorage + GitHub Gist sync. */
(() => {
  "use strict";

  const LS_PROGRESS = "ccarf.progress.v1";
  const LS_SETTINGS = "ccarf.settings.v1";
  const GIST_FILE = "ccarf-flashcards-progress.json";
  const GIST_DESC = "CCAR-F flashcards progress (synced by the flashcards site)";
  const DAY = 86400000, MIN = 60000;
  // Leitner-style boxes: interval in days for each box.
  const INTERVALS = [0, 1, 2, 4, 8, 16, 32, 60];
  const SOLID_BOX = 3;
  const WEAK_LESSONS = ["1.6", "2.3", "2.4", "2.5", "3.1", "3.2", "3.3", "4.1", "4.2", "4.3", "4.5", "QR3", "QR4"];
  const TYPE_LABEL = { takeaway: "Key takeaway", trap: "Exam trap", rule: "Decision rule" };
  const TYPE_PROMPT = {
    takeaway: "",
    trap: "This is a tempting wrong answer. Why is it wrong — and what's right?",
    rule: "When the question signals this… what do you pick?",
  };

  const $ = (id) => document.getElementById(id);
  const now = () => Date.now();

  // ---------- storage ----------
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast("Couldn't save locally: " + e.message); } };

  let deck = null;
  let byId = new Map();
  let progress = load(LS_PROGRESS, null) || { v: 1, resetAt: 0, cards: {} };
  let settings = Object.assign({
    mode: "due", domains: [1, 2, 3, 4, 5], types: ["takeaway", "trap", "rule"],
    lessons: null, shuffle: false, token: "", gistId: "", lastSync: 0,
  }, load(LS_SETTINGS, {}));

  const saveProgress = () => save(LS_PROGRESS, progress);
  const saveSettings = () => save(LS_SETTINGS, settings);

  // ---------- scheduling ----------
  function rec(id) { return progress.cards[id]; }
  function seen(id) { const r = progress.cards[id]; return !!(r && r.reps); }
  function isDue(id, t = now()) { const r = rec(id); return !r || r.due <= t; }
  function preview(id, rating) {
    const r = rec(id) || { box: 0, reps: 0, lapses: 0 };
    let box = r.box, due;
    const t = now();
    if (rating === 0) { box = 0; due = t + MIN; }
    else if (rating === 1) { box = Math.max(1, r.reps ? r.box : 1); due = t + Math.max(6 * 3600000, INTERVALS[box] * DAY * 0.5); }
    else if (rating === 2) { box = Math.min(INTERVALS.length - 1, r.box + 1); due = t + INTERVALS[box] * DAY; }
    else { box = Math.min(INTERVALS.length - 1, r.box + 2); due = t + INTERVALS[box] * DAY * 1.3; }
    return { box, due };
  }
  function fmtIvl(ms) {
    if (ms < 3600000) return "<1h";
    if (ms < DAY) return Math.round(ms / 3600000) + "h";
    const d = Math.round(ms / DAY);
    return d < 45 ? d + "d" : Math.round(d / 30) + "mo";
  }
  function rate(id, rating) {
    const old = rec(id) || { box: 0, reps: 0, lapses: 0, star: false };
    const { box, due } = preview(id, rating);
    progress.cards[id] = {
      box, due, reps: (old.reps || 0) + 1, lapses: (old.lapses || 0) + (rating === 0 && old.reps ? 1 : 0),
      star: !!old.star, last: rating, u: now(),
    };
    saveProgress();
    scheduleSync();
  }
  function toggleStar(id) {
    const r = rec(id) || { box: 0, reps: 0, lapses: 0, due: 0 };
    progress.cards[id] = { ...r, star: !r.star, u: now() };
    saveProgress();
    scheduleSync();
    return progress.cards[id].star;
  }

  // ---------- deck / queue ----------
  function inScope(c) {
    return settings.domains.includes(c.domain) && settings.types.includes(c.type) &&
      (!settings.lessons || settings.lessons.includes(c.lesson));
  }
  function scoped() { return deck.cards.filter(inScope); }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function buildQueue() {
    const t = now();
    const cards = scoped();
    let q;
    switch (settings.mode) {
      case "all": q = shuffle(cards.slice()); break;
      case "starred": q = shuffle(cards.filter((c) => rec(c.id)?.star)); break;
      case "struggling":
        q = cards.filter((c) => { const r = rec(c.id); return r && r.reps && (r.lapses > 0 || r.box <= 1 || r.last === 0); });
        q.sort((a, b) => (rec(b.id).lapses - rec(a.id).lapses) || (rec(a.id).box - rec(b.id).box));
        break;
      default: {
        const due = cards.filter((c) => seen(c.id) && rec(c.id).due <= t).sort((a, b) => rec(a.id).due - rec(b.id).due);
        let fresh = cards.filter((c) => !seen(c.id));
        if (settings.shuffle) shuffle(fresh);
        q = due.concat(fresh);
      }
    }
    return q.map((c) => c.id);
  }

  let queue = [], qTotal = 0, done = 0, current = null, flipped = false;

  function startSession() {
    queue = buildQueue();
    qTotal = queue.length; done = 0;
    next();
  }

  function next() {
    current = queue.shift() || null;
    flipped = false;
    render();
  }

  // ---------- rendering ----------
  const esc = (s) => s.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const fmt = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

  function lessonInfo(c) {
    if (c.lesson.startsWith("QR")) {
      const d = deck.domains.find((x) => x.id === c.domain);
      return { label: `D${c.domain} · Quick reference`, url: `https://claudecertificationguide.com/learn/quick-reference/domain-${c.domain}`, title: d.name };
    }
    for (const d of deck.domains) for (const l of d.lessons) if (l.id === c.lesson) return { label: `${l.id} · ${l.title}`, url: l.url, title: l.title };
    return { label: c.lesson, url: deck.source };
  }

  function render() {
    renderSummary();
    document.querySelectorAll("#modePills button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === settings.mode)));
    const card = $("card"), empty = $("empty");
    $("sessionCount").textContent = qTotal ? `${Math.min(done, qTotal)} / ${qTotal}` : "";
    $("sessionFill").style.width = qTotal ? `${(100 * done) / qTotal}%` : "0";

    if (!current) {
      card.hidden = true; empty.hidden = false;
      $("rate").classList.remove("show"); $("btnReveal").hidden = true;
      const msgs = {
        due: ["All caught up", qTotal ? "Session complete. Nothing else is due in this deck right now." : "Nothing is due in this deck right now."],
        all: ["Deck finished", "You've been through every card in this deck."],
        struggling: ["Nothing struggling", "Cards you miss or rate low will collect here."],
        starred: ["No starred cards", "Tap ★ on any card to save it here."],
      };
      const [t, b] = msgs[settings.mode] || msgs.due;
      $("emptyTitle").textContent = scoped().length ? t : "Empty deck";
      $("emptyBody").textContent = scoped().length ? b : "No cards match your deck filters.";
      return;
    }
    card.hidden = false; empty.hidden = true;
    const c = byId.get(current);
    const info = lessonInfo(c);
    card.dataset.type = c.type;
    card.classList.toggle("flipped", flipped);
    for (const id of ["kind", "kindBack"]) { $(id).textContent = TYPE_LABEL[c.type]; $(id).dataset.type = c.type; }
    $("where").textContent = info.label;
    $("sourceLink").textContent = info.label + " ↗";
    $("sourceLink").href = info.url;
    $("promptLabel").textContent = TYPE_PROMPT[c.type];
    $("promptLabel").hidden = !TYPE_PROMPT[c.type];
    $("frontText").innerHTML = fmt(c.front);
    $("recap").innerHTML = (c.type === "trap" ? "<b>Trap:</b> " : "") + fmt(c.front);
    $("backText").innerHTML = fmt(c.back);
    $("btnStar").setAttribute("aria-pressed", String(!!rec(c.id)?.star));
    $("rate").classList.toggle("show", flipped);
    $("btnReveal").hidden = flipped;
    if (flipped) for (let r = 0; r < 4; r++) $("ivl" + r).textContent = fmtIvl(preview(c.id, r).due - now());
  }

  function renderSummary() {
    if (!deck) return;
    const s = scoped(), t = now();
    const due = s.filter((c) => seen(c.id) && rec(c.id).due <= t).length;
    const fresh = s.filter((c) => !seen(c.id)).length;
    $("deckSummary").textContent = `${s.length} cards in deck · ${due} due · ${fresh} new`;
  }

  function flip() {
    if (!current) return;
    flipped = !flipped;
    render();
  }

  function answer(r) {
    if (!current || !flipped) return;
    rate(current, r);
    done++;
    // In due mode, failed cards come back later in the same session.
    if (r === 0) { queue.splice(Math.min(queue.length, 4), 0, current); qTotal++; }
    next();
  }

  // ---------- dialogs ----------
  function openFilters() {
    const counts = (pred) => deck.cards.filter(pred).length;
    $("domainList").innerHTML = deck.domains.map((d) => `
      <label class="check"><input type="checkbox" data-dom="${d.id}" ${settings.domains.includes(d.id) ? "checked" : ""}>
      <span class="lbl">D${d.id} · ${esc(d.name)} <small style="color:var(--ink-3)">${d.weight}%</small></span>
      <span class="cnt">${counts((c) => c.domain === d.id)}</span></label>`).join("");
    $("typeList").innerHTML = Object.entries(TYPE_LABEL).map(([k, v]) => `
      <label class="check"><input type="checkbox" data-type="${k}" ${settings.types.includes(k) ? "checked" : ""}>
      <span class="lbl">${v}s</span><span class="cnt">${counts((c) => c.type === k)}</span></label>`).join("");
    $("optShuffle").checked = settings.shuffle;
    updateWeakNote();
    $("dlgFilters").showModal();
  }
  function updateWeakNote() {
    $("weakNote").textContent = settings.lessons
      ? `Weak-spot filter on: lessons ${settings.lessons.filter((l) => !l.startsWith("QR")).join(", ")} plus D3/D4 decision rules.`
      : "Weak-spot lessons: tool_choice, MCP resources vs tools, Grep vs Glob, CLAUDE.md / skills / rules containers, prompting-technique choice, batch vs sync.";
  }
  function readFilters() {
    settings.domains = [...document.querySelectorAll("#domainList input:checked")].map((i) => +i.dataset.dom);
    settings.types = [...document.querySelectorAll("#typeList input:checked")].map((i) => i.dataset.type);
    settings.shuffle = $("optShuffle").checked;
    saveSettings();
  }

  function openStats() {
    const t = now();
    const all = deck.cards;
    const cls = (c) => { const r = rec(c.id); return !r || !r.reps ? "new" : r.box >= SOLID_BOX ? "solid" : "learn"; };
    const tally = (cards) => cards.reduce((a, c) => (a[cls(c)]++, a), { new: 0, learn: 0, solid: 0 });
    const tot = tally(all);
    const dueNow = all.filter((c) => seen(c.id) && rec(c.id).due <= t).length;
    const rows = deck.domains.map((d) => {
      const cs = all.filter((c) => c.domain === d.id), k = tally(cs), n = cs.length;
      const pct = (x) => (100 * x / n).toFixed(1) + "%";
      return `<div class="dom-stat"><div class="hd"><b>D${d.id} · ${esc(d.name)}</b><span>${k.solid}/${n} solid</span></div>
        <div class="bar"><i class="solid" style="width:${pct(k.solid)}"></i><i class="learn" style="width:${pct(k.learn)}"></i><i class="new" style="width:${pct(k.new)}"></i></div></div>`;
    }).join("");
    const lapses = all.map((c) => [c, rec(c.id)?.lapses || 0]).filter(([, l]) => l > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const lapseHtml = lapses.length ? `<h3>Most missed</h3>` + lapses.map(([c, l]) =>
      `<div class="fine" style="padding:6px 0;border-top:1px solid var(--line)"><b>${l}×</b> ${esc(lessonInfo(c).label)} — ${fmt(c.front)}</div>`).join("") : "";
    $("statsBody").innerHTML = `<div class="stat-total">
        <div><b>${tot.solid}</b><span>solid of ${all.length}</span></div>
        <div><b>${tot.learn}</b><span>learning</span></div>
        <div><b>${dueNow}</b><span>due now</span></div></div>${rows}${lapseHtml}`;
    $("dlgStats").showModal();
  }

  function openSync() {
    $("inToken").value = settings.token;
    $("inGist").value = settings.gistId;
    setSyncStatus(settings.lastSync ? `Last synced ${new Date(settings.lastSync).toLocaleString()}` : settings.token ? "" : "Not connected — progress is saved on this device only.");
    $("dlgSync").showModal();
  }

  // ---------- sync (GitHub Gist) ----------
  let syncTimer = null, syncing = false, syncAgain = false;

  function setDot(state) { $("syncDot").dataset.state = state; }
  function setSyncStatus(msg, err) { const el = $("syncStatus"); el.textContent = msg; el.classList.toggle("err", !!err); }

  function merge(a, b) {
    const resetAt = Math.max(a.resetAt || 0, b.resetAt || 0);
    const out = { v: 1, resetAt, cards: {} };
    for (const src of [a.cards || {}, b.cards || {}]) {
      for (const [id, r] of Object.entries(src)) {
        if (!r || (r.u || 0) <= resetAt) continue;
        const cur = out.cards[id];
        if (!cur || (r.u || 0) > (cur.u || 0)) out.cards[id] = r;
      }
    }
    return out;
  }

  async function gh(path, opts = {}) {
    const res = await fetch("https://api.github.com" + path, {
      keepalive: opts.method === "PATCH",
      ...opts,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + settings.token,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).message || ""; } catch {}
      const e = new Error(res.status === 401 ? "Token rejected (401). Check it has the gist scope and hasn't expired."
        : res.status === 404 ? "Gist not found (404). Clear the Gist ID to auto-create one, or check the token owner."
        : `GitHub ${res.status}: ${detail}`);
      e.status = res.status;
      throw e;
    }
    return res.status === 204 ? null : res.json();
  }

  async function findOrCreateGist() {
    for (let page = 1; page <= 5; page++) {
      const list = await gh(`/gists?per_page=100&page=${page}`);
      const hit = list.find((g) => g.files && g.files[GIST_FILE]);
      if (hit) return hit.id;
      if (list.length < 100) break;
    }
    const g = await gh("/gists", {
      method: "POST",
      body: JSON.stringify({ description: GIST_DESC, public: false, files: { [GIST_FILE]: { content: JSON.stringify(progress) } } }),
    });
    return g.id;
  }

  async function readGist(id) {
    const g = await gh(`/gists/${id}`);
    const f = g.files[GIST_FILE];
    if (!f) return { v: 1, resetAt: 0, cards: {} };
    let text = f.content;
    if (f.truncated) text = await (await fetch(f.raw_url)).text();
    try { return JSON.parse(text); } catch { return { v: 1, resetAt: 0, cards: {} }; }
  }

  async function syncNow({ quiet = false } = {}) {
    if (!settings.token) { setDot("off"); return; }
    if (syncing) { syncAgain = true; return; }
    syncing = true; setDot("busy");
    if (!quiet) setSyncStatus("Syncing…");
    try {
      if (!settings.gistId) { settings.gistId = await findOrCreateGist(); saveSettings(); $("inGist").value = settings.gistId; }
      const remote = await readGist(settings.gistId);
      const merged = merge(progress, remote);
      const changedLocal = JSON.stringify(merged) !== JSON.stringify(progress);
      progress = merged; saveProgress();
      if (JSON.stringify(merged) !== JSON.stringify(remote)) {
        await gh(`/gists/${settings.gistId}`, { method: "PATCH", body: JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(merged) } } }) });
      }
      settings.lastSync = now(); saveSettings();
      setDot("ok");
      setSyncStatus(`Synced ${new Date(settings.lastSync).toLocaleTimeString()} · ${Object.keys(progress.cards).length} cards with progress`);
      if (changedLocal) { renderSummary(); if (!current) startSession(); }
    } catch (e) {
      setDot("err");
      setSyncStatus(e.message || String(e), true);
      if (!quiet) toast("Sync failed: " + (e.message || e));
    } finally {
      syncing = false;
      if (syncAgain) { syncAgain = false; syncNow({ quiet: true }); }
    }
  }

  function scheduleSync() {
    if (!settings.token) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncNow({ quiet: true }), 4000);
  }

  // Best-effort push when the tab is hidden / closed (phone backgrounding, tab switch).
  function flushOnHide() {
    if (!settings.token || !settings.gistId || !syncTimer) return;
    clearTimeout(syncTimer); syncTimer = null;
    // We can't await a merge here; push a merge against what we last knew is safe because
    // the next normal sync will re-merge using per-card timestamps.
    syncNow({ quiet: true });
  }

  // ---------- setup link (#setup=base64) ----------
  function readSetupHash() {
    const m = location.hash.match(/setup=([^&]+)/);
    if (!m) return;
    try {
      const { t, g } = JSON.parse(atob(decodeURIComponent(m[1])));
      if (t) { settings.token = t; settings.gistId = g || ""; saveSettings(); toast("Sync settings saved on this device"); }
    } catch { toast("That setup link looks invalid"); }
    history.replaceState(null, "", location.pathname + location.search);
  }

  // ---------- misc ----------
  let toastTimer;
  function toast(msg) {
    const el = $("toast"); el.textContent = msg; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function wire() {
    $("card").addEventListener("click", (e) => { if (e.target.closest("a,.star")) return; flip(); });
    $("btnReveal").addEventListener("click", flip);
    document.querySelectorAll(".r").forEach((b) => b.addEventListener("click", () => answer(+b.dataset.r)));
    $("btnStar").addEventListener("click", (e) => { e.stopPropagation(); if (current) { const s = toggleStar(current); $("btnStar").setAttribute("aria-pressed", String(s)); toast(s ? "Starred" : "Unstarred"); } });
    document.querySelectorAll("#modePills button").forEach((b) => b.addEventListener("click", () => { settings.mode = b.dataset.mode; saveSettings(); startSession(); }));
    $("btnStudyAll").addEventListener("click", () => { settings.mode = "all"; saveSettings(); startSession(); });
    $("btnFilters").addEventListener("click", openFilters);
    $("btnOpenFilters").addEventListener("click", openFilters);
    $("btnStats").addEventListener("click", openStats);
    $("btnSync").addEventListener("click", openSync);

    $("dlgFilters").addEventListener("change", () => { readFilters(); renderSummary(); });
    $("dlgFilters").addEventListener("close", () => { readFilters(); startSession(); });
    $("presetWeak").addEventListener("click", () => {
      settings.lessons = WEAK_LESSONS; settings.domains = [1, 2, 3, 4, 5];
      document.querySelectorAll("#domainList input").forEach((i) => (i.checked = true));
      saveSettings(); updateWeakNote(); renderSummary(); toast("Weak-spot lessons only");
    });
    $("presetAll").addEventListener("click", () => {
      settings.lessons = null; settings.domains = [1, 2, 3, 4, 5]; settings.types = ["takeaway", "trap", "rule"];
      document.querySelectorAll("#dlgFilters .checklist input").forEach((i) => (i.checked = true));
      saveSettings(); updateWeakNote(); renderSummary(); toast("Full deck");
    });
    for (const id of ["dlgFilters", "dlgStats", "dlgSync"]) {
      $(id).addEventListener("click", (e) => { if (e.target === $(id)) $(id).close(); });
    }

    $("btnSyncNow").addEventListener("click", () => {
      settings.token = $("inToken").value.trim();
      settings.gistId = $("inGist").value.trim().replace(/^.*\//, "");
      saveSettings();
      if (!settings.token) return setSyncStatus("Paste a GitHub token first.", true);
      syncNow();
    });
    $("btnDisconnect").addEventListener("click", () => {
      settings.token = ""; settings.gistId = ""; settings.lastSync = 0; saveSettings();
      $("inToken").value = ""; $("inGist").value = ""; setDot("off");
      setSyncStatus("Disconnected. Progress stays on this device; the gist is untouched.");
    });
    $("btnSetupLink").addEventListener("click", async () => {
      if (!settings.token || !settings.gistId) return setSyncStatus("Sync once first so there's a gist ID to share.", true);
      const blob = btoa(JSON.stringify({ t: settings.token, g: settings.gistId }));
      const url = location.origin + location.pathname + "#setup=" + encodeURIComponent(blob);
      try { await navigator.clipboard.writeText(url); toast("Setup link copied — open it on your other device"); }
      catch { prompt("Copy this link:", url); }
    });
    $("btnExport").addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(progress, null, 1)], { type: "application/json" }));
      a.download = `ccarf-progress-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(a.href);
    });
    $("inImport").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!data || typeof data.cards !== "object") throw new Error("not a progress file");
        progress = merge(progress, data); saveProgress(); toast("Imported and merged"); startSession(); scheduleSync();
      } catch (err) { toast("Import failed: " + err.message); }
      e.target.value = "";
    });
    $("btnReset").addEventListener("click", () => {
      if (!confirm("Reset all progress on every synced device? This can't be undone (export a backup first if unsure).")) return;
      progress = { v: 1, resetAt: now(), cards: {} }; saveProgress(); startSession(); scheduleSync(); toast("Progress reset");
    });

    document.addEventListener("keydown", (e) => {
      if (document.querySelector("dialog[open]") || e.target.matches("input,textarea")) return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); flip(); }
      else if (flipped && ["1", "2", "3", "4"].includes(e.key)) answer(+e.key - 1);
      else if (e.key.toLowerCase() === "s") $("btnStar").click();
      else if (e.key.toLowerCase() === "f") openFilters();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushOnHide();
      else if (settings.token && now() - settings.lastSync > 30000) syncNow({ quiet: true });
    });
    window.addEventListener("pagehide", flushOnHide);
    window.addEventListener("online", () => syncNow({ quiet: true }));
    window.addEventListener("storage", (e) => { if (e.key === LS_PROGRESS) { progress = load(LS_PROGRESS, progress); renderSummary(); } });
  }

  async function init() {
    readSetupHash();
    wire();
    setDot(settings.token ? "busy" : "off");
    try {
      const res = await fetch("cards.json", { cache: "no-cache" });
      deck = await res.json();
    } catch (e) {
      $("deckSummary").textContent = "Couldn't load cards.json";
      return;
    }
    byId = new Map(deck.cards.map((c) => [c.id, c]));
    startSession();
    if (settings.token) await syncNow({ quiet: true });
    if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  // Expose a tiny hook for tests.
  window.__ccarf = { merge, get progress() { return progress; }, get settings() { return settings; } };
  init();
})();
