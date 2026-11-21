/* Grok Bot phone app. No secrets in this tree. The desk-data token lives only in localStorage. */
(function () {
  "use strict";

  const OWNER = "DeezFreez";
  const REPO = "desk-data";
  const TOKEN_KEY = "desk-data-token";
  const POLL_MS = 20000;
  const SCREEN_MS = 15000;
  const BOTS = ["scanner", "analyst", "brain", "executor", "risk"];
  const BOT_COLOR = {
    scanner: "#64d2ff",
    analyst: "#ffd60a",
    brain: "#bf5af2",
    executor: "#00d35a",
    risk: "#ff6b9a",
  };
  const BOT_TITLE = {
    scanner: "Scanner",
    analyst: "Analyst",
    brain: "Brain",
    executor: "Executor",
    risk: "Risk",
  };
  const RANGES = ["LIVE", "1H", "4H", "1D", "1W", "ALL"];
  const GROUP_TITLE = {
    scanner: "Scanner",
    analyst: "Analyst",
    social: "Social",
    brain: "Brain",
    executor: "Executor",
    risk: "Risk",
    desk: "Desk",
  };

  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const store = {
    token: "",
    route: "home",
    param: "",
    state: null,
    chart: {},
    range: "LIVE",
    activity: null,
    account: null,
    settings: null,
    decisions: {},
    coin: {},
    audit: {},
    screenUrl: null,
    screenAt: 0,
    screenFreshAt: 0,
    lastOkAt: 0,
    error: null,
    retryIn: 0,
    loading: true,
    setupError: "",
    toast: "",
    sheet: null,
    searchQ: "",
    screenZoom: 1,
  };

  const fetchedAt = Object.create(null);
  const inFlight = Object.create(null);
  let toastTimer = 0;
  let tickTimer = 0;
  let screenTimer = 0;
  let retryTimer = 0;
  let equityCanvas = null;
  let candleCanvas = null;
  let screenFront = 0;
  const screenImgs = [null, null];

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, attrs, kids) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v == null || v === false) return;
        if (k === "class") node.className = v;
        else if (k === "html") node.innerHTML = v;
        else if (k === "text") node.textContent = v;
        else if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
        else if (k === "dataset") Object.assign(node.dataset, v);
        else if (v === true) node.setAttribute(k, "");
        else node.setAttribute(k, String(v));
      });
    }
    (kids || []).forEach((c) => {
      if (c == null || c === false) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }
  function svg(path, view) {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", view || "0 0 24 24");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "1.8");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.innerHTML = path;
    return s;
  }
  const ICO = {
    search: () => svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>'),
    bell: () => svg('<path d="M6 9a6 6 0 1 1 12 0c0 7 2 7 2 9H4c0-2 2-2 2-9z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
    home: () => svg('<path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/>'),
    bots: () => svg('<rect x="4" y="8" width="6" height="10" rx="1.4"/><rect x="14" y="4" width="6" height="14" rx="1.4"/>'),
    activity: () => svg('<path d="M4 18V6"/><path d="M10 18V9"/><path d="M16 18v-5"/><path d="M22 18V8"/>'),
    account: () => svg('<circle cx="12" cy="8" r="3.2"/><path d="M5 19c1.4-3 4-4.5 7-4.5S17.6 16 19 19"/>'),
    back: () => svg('<path d="M15 5 8 12l7 7"/>'),
    check: () => svg('<path d="M5 12.5l4 4 10-10"/>', "0 0 24 24"),
  };

  function money(n, d) {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    const x = Number(n);
    const sign = x < 0 ? "-" : "";
    return sign + "$" + Math.abs(x).toFixed(d == null ? 2 : d);
  }
  function pct(n, d) {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    const x = Number(n);
    const sign = x > 0 ? "+" : "";
    return sign + x.toFixed(d == null ? 2 : d) + "%";
  }
  function shortMint(m) {
    m = String(m || "");
    return m.length > 10 ? m.slice(0, 4) + "…" + m.slice(-4) : m;
  }
  function coinLabel(row) {
    return (row && (row.symbol || row.name)) || shortMint(row && row.mint);
  }
  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Denver" });
  }
  function fmtWhen(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const sec = Math.round((now - d) / 1000);
    if (sec < 5) return "just now";
    if (sec < 60) return sec + "s ago";
    if (sec < 3600) return Math.round(sec / 60) + "m ago";
    return fmtTime(iso);
  }
  function titleize(key) {
    const part = String(key || "").split(".").slice(1).join(".") || String(key || "");
    return part.replace(/_/g, " ").replace(/usd/gi, "USD").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  function prettyLane(lane) {
    const s = String(lane || "Idle");
    if (!s || /^idle$/i.test(s)) return { text: "Idle", color: "rgba(235,235,245,0.6)" };
    const low = s.toLowerCase();
    let color = "#fff";
    BOTS.forEach((b) => { if (low.indexOf(b) >= 0) color = BOT_COLOR[b]; });
    const pretty = s.replace(/^\w/, (c) => c.toUpperCase()).replace(/\b(scanner|analyst|brain|executor|risk)\b/gi, (m) => BOT_TITLE[m.toLowerCase()] || m);
    return { text: pretty, color };
  }

  /* ---------- token + GitHub client (scheme is the classic "token" prefix; no secrets here) ---------- */
  function captureFragment() {
    const h = location.hash || "";
    if (h.indexOf("#t=") === 0) {
      const raw = h.slice(3);
      const tok = decodeURIComponent(raw.replace(/\+/g, " "));
      if (tok) {
        try { localStorage.setItem(TOKEN_KEY, tok); } catch (e) {}
      }
      history.replaceState(null, "", location.pathname + location.search);
    }
  }
  function readToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function writeToken(tok) {
    try { localStorage.setItem(TOKEN_KEY, tok); } catch (e) {}
    store.token = tok;
  }
  function forgetToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    store.token = "";
    store.state = null;
    store.error = null;
    go("setup");
    render();
  }
  function authHeader(tok) {
    return "token " + tok;
  }
  function contentsUrl(path, ref) {
    return "https://api.github.com/repos/" + OWNER + "/" + REPO + "/contents/" + path.split("/").map(encodeURIComponent).join("/") + "?ref=" + encodeURIComponent(ref || "main");
  }

  function ApiError(status, message) {
    this.name = "ApiError";
    this.status = status;
    this.message = message;
  }
  ApiError.prototype = Object.create(Error.prototype);

  async function githubGet(path, kind, force) {
    const now = Date.now();
    if (!force && fetchedAt[path] && now - fetchedAt[path] < POLL_MS && inFlight[path] == null) {
      return "cached";
    }
    if (inFlight[path]) return inFlight[path];
    const tok = store.token;
    const run = (async () => {
      const res = await fetch(contentsUrl(path, "main"), {
        headers: {
          Authorization: authHeader(tok),
          Accept: "application/vnd.github.raw",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let msg = "GitHub " + res.status;
        if (res.status === 401 || res.status === 403) msg = "Token was refused or is missing Contents access on desk-data.";
        else if (res.status === 404) msg = path + " was not found on desk-data.";
        else if (res.status === 429) msg = "Rate limited. Slowing down.";
        if (text && text.length < 180 && text.indexOf(" ") >= 0) {
          /* keep a short public error, never a header or credential */
        }
        throw new ApiError(res.status, msg);
      }
      fetchedAt[path] = Date.now();
      if (kind === "blob") {
        return { blob: await res.blob(), etag: res.headers.get("etag") || "", lastModified: res.headers.get("last-modified") || "" };
      }
      return res.json();
    })();
    inFlight[path] = run;
    try { return await run; } finally { delete inFlight[path]; }
  }

  async function putCommand(cmd) {
    const body = Object.assign({ who: "me" }, cmd);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const path = "commands/" + ts + ".json";
    const json = JSON.stringify(body);
    const bytes = new TextEncoder().encode(json);
    let bin = "";
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    const content = btoa(bin);
    const res = await fetch(contentsUrl(path, "inbox").replace(/\?ref=.*/, ""), {
      method: "PUT",
      headers: {
        Authorization: authHeader(store.token),
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        message: "command " + (cmd.op || "update"),
        content: content,
        branch: "inbox",
      }),
    });
    if (!res.ok) {
      let msg = "Could not write the command (" + res.status + ").";
      if (res.status === 409) msg = "Inbox conflict. Try again.";
      if (res.status === 401 || res.status === 403) msg = "Token cannot write to the inbox branch. It needs Contents write on desk-data.";
      throw new ApiError(res.status, msg);
    }
    return res.json();
  }

  let lastCmdSig = "";
  let lastCmdAt = 0;
  async function sendCommand(cmd) {
    const sig = JSON.stringify(cmd);
    const now = Date.now();
    if (sig === lastCmdSig && now - lastCmdAt < 1500) return true;
    lastCmdSig = sig;
    lastCmdAt = now;
    try {
      await putCommand(cmd);
      toast("Command sent");
      return true;
    } catch (err) {
      toast(err.message || "Command failed");
      return false;
    }
  }

  /* ---------- data loads ---------- */
  async function loadState(force) {
    const data = await githubGet("state.json", "json", force);
    if (data && data !== "cached") {
      store.state = data;
      store.lastOkAt = Date.now();
      store.error = null;
    }
  }
  async function loadChart(range, force) {
    const r = range || store.range;
    const data = await githubGet("chart_" + r + ".json", "json", force);
    if (data && data !== "cached") store.chart[r] = data;
  }
  async function loadActivity(force) {
    const data = await githubGet("activity.json", "json", force);
    if (data && data !== "cached") store.activity = data;
  }
  async function loadAccount(force) {
    const data = await githubGet("account.json", "json", force);
    if (data && data !== "cached") store.account = data;
  }
  async function loadSettings(force) {
    const data = await githubGet("settings.json", "json", force);
    if (data && data !== "cached") store.settings = data;
  }
  async function loadDecisions(force) {
    await Promise.all(BOTS.map(async (name) => {
      try {
        const data = await githubGet("bots/" + name + "/decisions.json", "json", force);
        if (data && data !== "cached") store.decisions[name] = data;
      } catch (err) {
        /* missing file is fine */
        if (!(err instanceof ApiError && err.status === 404)) throw err;
      }
    }));
  }
  async function loadCoin(mint, force) {
    if (!mint) return;
    const data = await githubGet("coin/" + mint + ".json", "json", force);
    if (data && data !== "cached") store.coin[mint] = data;
  }
  async function loadAudit(mint, force) {
    if (!mint) return;
    const data = await githubGet("audit/" + mint + ".json", "json", force);
    if (data && data !== "cached") store.audit[mint] = data;
  }
  async function loadScreen() {
    try {
      const data = await githubGet("screen.jpg", "blob", true);
      if (!data || data === "cached") return;
      const url = URL.createObjectURL(data.blob);
      const prev = store.screenUrl;
      store.screenUrl = url;
      store.screenAt = Date.now();
      if (data.etag && data.etag !== store._screenEtag) {
        store.screenFreshAt = Date.now();
        store._screenEtag = data.etag;
      } else if (data.lastModified && data.lastModified !== store._screenLM) {
        store.screenFreshAt = Date.parse(data.lastModified) || Date.now();
        store._screenLM = data.lastModified;
      }
      if (prev && prev !== url) setTimeout(() => URL.revokeObjectURL(prev), 1500);
      paintScreen(url);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        store.screenUrl = null;
        paintScreen(null);
        return;
      }
      throw err;
    }
  }

  function filesForRoute(route) {
    const r = route || store.route;
    if (r === "home") return [loadState, () => loadChart(store.range), loadScreen];
    if (r === "bots") return [loadState, loadDecisions];
    if (r === "activity") return [loadState, loadActivity];
    if (r === "account") return [loadState, loadAccount, loadSettings];
    if (r === "coin") return [loadState, () => loadCoin(store.param)];
    if (r === "audit") return [loadState, () => loadAudit(store.param)];
    if (r === "search") return [loadState, loadActivity];
    if (r === "screen") return [loadState, loadScreen];
    return [loadState];
  }

  async function refresh(force) {
    if (!store.token || store.route === "setup") return;
    const jobs = filesForRoute(store.route);
    try {
      await Promise.all(jobs.map((fn) => fn(force)));
      store.loading = false;
      store.error = null;
      store.lastOkAt = store.lastOkAt || Date.now();
    } catch (err) {
      store.loading = false;
      store.error = (err && err.message) || "Desk offline";
      store.retryIn = Math.ceil(POLL_MS / 1000);
    }
    render();
    afterPaint();
  }

  function startPolling() {
    clearInterval(tickTimer);
    clearInterval(screenTimer);
    tickTimer = setInterval(() => refresh(false), POLL_MS);
    const needScreen = () => store.route === "home" || store.route === "screen";
    screenTimer = setInterval(() => {
      if (needScreen() && store.token) loadScreen().then(afterPaint).catch(() => {});
    }, SCREEN_MS);
  }

  /* ---------- router ---------- */
  function parseRoute() {
    const h = location.hash || "";
    if (h.indexOf("#t=") === 0) return;
    const raw = h.replace(/^#\/?/, "");
    const parts = raw.split("/").filter(Boolean);
    if (!store.token) { store.route = "setup"; store.param = ""; return; }
    const head = (parts[0] || "home").toLowerCase();
    if (["home", "bots", "activity", "account", "search", "screen"].indexOf(head) >= 0) {
      store.route = head; store.param = "";
    } else if (head === "coin" || head === "audit") {
      store.route = head; store.param = parts.slice(1).join("/") || "";
    } else {
      store.route = "home"; store.param = "";
    }
  }
  function go(route, param) {
    if (route === "setup") {
      store.route = "setup";
      render();
      return;
    }
    const path = param ? "#/" + route + "/" + param : (route === "home" ? "#/" : "#/" + route);
    if (location.hash === path || (route === "home" && (location.hash === "" || location.hash === "#/" || location.hash === "#"))) {
      store.route = route;
      store.param = param || "";
      refresh(false);
      render();
      afterPaint();
      return;
    }
    location.hash = path;
  }
  window.addEventListener("hashchange", () => {
    parseRoute();
    store.loading = !store.state;
    render();
    refresh(false);
  });

  /* ---------- toast / sheet ---------- */
  function toast(msg) {
    store.toast = msg;
    render();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { store.toast = ""; render(); }, 2400);
  }
  function closeSheet() { store.sheet = null; render(); }

  /* ---------- render ---------- */
  function render() {
    const root = document.getElementById("app");
    if (!root) return;
    document.body.classList.toggle("setup-mode", store.route === "setup");
    root.replaceChildren();
    if (store.route === "setup") {
      root.appendChild(viewSetup());
      return;
    }
    if (store.error && store.state) {
      root.appendChild(el("div", { class: "banner", text: "Desk offline · retrying in " + store.retryIn + "s · last update " + fmtWhen(store.state.updated_at || new Date(store.lastOkAt).toISOString()) }));
    } else if (store.error && !store.state) {
      root.appendChild(el("div", { class: "banner", text: "Desk offline · retrying in " + store.retryIn + "s · last update —" }));
    }
    if (store.route === "screen") {
      root.appendChild(viewScreenFs());
    } else {
      root.appendChild(viewNav());
      const page = el("div", { class: "page" + (store.route === "home" ? " fullbleed" : "") + (["coin", "audit", "search"].indexOf(store.route) >= 0 ? " no-tab" : "") });
      if (store.loading && !store.state) page.appendChild(viewSkeleton(store.route));
      else if (store.route === "home") page.appendChild(viewHome());
      else if (store.route === "bots") page.appendChild(viewBots());
      else if (store.route === "activity") page.appendChild(viewActivity());
      else if (store.route === "account") page.appendChild(viewAccount());
      else if (store.route === "coin") page.appendChild(viewCoin());
      else if (store.route === "audit") page.appendChild(viewAudit());
      else if (store.route === "search") page.appendChild(viewSearch());
      root.appendChild(page);
      if (["home", "bots", "activity", "account"].indexOf(store.route) >= 0) root.appendChild(viewTabs());
    }
    if (store.sheet) root.appendChild(viewSheet());
    if (store.toast) root.appendChild(el("div", { class: "toast", text: store.toast }));
  }

  function viewNav() {
    const r = store.route;
    if (r === "search") {
      return el("div", { class: "nav" }, [
        el("button", { class: "back-label", onClick: () => history.back() }, [ICO.back(), " Back"]),
        el("div", { class: "nav-title", text: "Search" }),
      ]);
    }
    if (r === "coin" || r === "audit") {
      return el("div", { class: "nav" }, [
        el("button", { class: "back-label", onClick: () => history.back() }, [ICO.back(), " Back"]),
        el("div", { class: "nav-title", text: r === "audit" ? "Audit" : "Coin" }),
      ]);
    }
    return el("div", { class: "nav" }, [
      el("button", { class: "nav-btn", onClick: () => go("account"), title: "Account" }, [
        el("div", { class: "avatar" }, [el("img", { src: "icons/icon-180.png", alt: "" })]),
      ]),
      el("div", { class: "nav-title" }, ["Grok Bot", el("span", { class: "chev", text: " ›" })]),
      el("button", { class: "nav-btn", onClick: () => go("search"), title: "Search" }, [ICO.search()]),
      el("button", { class: "nav-btn", onClick: () => openBell(), title: "Alerts" }, [
        ICO.bell(),
        el("i", { class: "bell-dot" + (store._bell ? " on" : "") }),
      ]),
    ]);
  }
  function viewTabs() {
    const items = [
      ["home", "Home", ICO.home],
      ["bots", "Bots", ICO.bots],
      ["activity", "Activity", ICO.activity],
      ["account", "Account", ICO.account],
    ];
    return el("nav", { class: "tabs" }, items.map(([id, lab, ico]) =>
      el("button", { class: "tab" + (store.route === id ? " on" : ""), onClick: () => go(id) }, [ico(), el("span", { text: lab })])
    ));
  }

  function viewSkeleton(route) {
    const box = el("div", { class: "pad" });
    if (route === "home") {
      box.appendChild(el("div", { class: "skel", style: { height: "72px", width: "70%", marginTop: "8px" } }));
      box.appendChild(el("div", { class: "skel", style: { height: "180px", marginTop: "16px" } }));
      box.appendChild(el("div", { class: "skel", style: { height: "180px", marginTop: "16px", borderRadius: "22px" } }));
      box.appendChild(el("div", { class: "skel", style: { height: "132px", marginTop: "22px" } }));
    } else {
      for (let i = 0; i < 4; i++) box.appendChild(el("div", { class: "skel", style: { height: "72px", marginTop: "12px" } }));
    }
    return box;
  }

  function viewSetup() {
    const wrap = el("div", { class: "setup" }, [
      el("h1", { text: "Grok Bot" }),
      el("p", { text: "Paste a fine-grained GitHub token with Contents read and write on the private desk‑data repo. It stays on this phone." }),
      el("div", { class: "field-lab", text: "desk‑data token" }),
      el("input", { class: "field", id: "token-field", type: "password", autocomplete: "off", spellcheck: "false", autocapitalize: "off" }),
      el("button", { class: "primary", id: "token-save", text: "Save", onClick: onSaveToken }),
      store.setupError ? el("div", { class: "setup-err", text: store.setupError }) : null,
    ]);
    return wrap;
  }
  async function onSaveToken() {
    const input = document.getElementById("token-field");
    const tok = (input && input.value || "").trim();
    const btn = document.getElementById("token-save");
    if (!tok) { store.setupError = "Paste a token first."; render(); return; }
    if (btn) btn.disabled = true;
    store.setupError = "";
    render();
    /* re-fill after render? we re-render and lose the field — validate before clearing. Don't re-render until done. */
    try {
      store.token = tok;
      const res = await fetch(contentsUrl("state.json", "main"), {
        headers: {
          Authorization: authHeader(tok),
          Accept: "application/vnd.github.raw",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
      });
      if (!res.ok) {
        store.token = readToken();
        if (res.status === 401 || res.status === 403) store.setupError = "Token was refused. It needs Contents read on desk-data.";
        else if (res.status === 404) store.setupError = "Connected, but state.json is missing on desk-data.";
        else store.setupError = "Could not read state.json (HTTP " + res.status + ").";
        render();
        const again = document.getElementById("token-field");
        if (again) again.value = tok;
        return;
      }
      const data = await res.json();
      writeToken(tok);
      if (input) input.value = "";
      store.state = data;
      store.loading = false;
      store.lastOkAt = Date.now();
      fetchedAt["state.json"] = Date.now();
      go("home");
      startPolling();
      refresh(true);
    } catch (err) {
      store.token = readToken();
      store.setupError = "Can't reach GitHub. Check the connection and try again.";
      render();
      const again = document.getElementById("token-field");
      if (again) again.value = tok;
    }
  }

  function paperBadge(mode) {
    const paper = !mode || mode === "PAPER" || (store.state && store.state.paper);
    return paper ? el("span", { class: "pill paper", text: "PAPER" }) : null;
  }

  function viewHome() {
    const s = store.state || {};
    const wrap = el("div", { class: "pad" });
    const hero = el("div", { class: "hero" });
    const balRow = el("div", { class: "balance-row" });
    balRow.appendChild(el("div", { class: "odo", id: "balance-odo" }));
    balRow.appendChild(paperBadge(s.mode));
    hero.appendChild(balRow);
    const todayPct = Number(s.today_pct) || 0;
    const todayCls = todayPct > 0 ? "up" : (todayPct < 0 ? "down" : "muted");
    const today = el("div", { class: "today-line" }, [
      el("span", { class: todayCls, text: pct(s.today_pct) + " today" }),
      el("span", { class: "pill mult", text: (Number(s.multiplier) || 0).toFixed(2).replace(/\.?0+$/, (m) => m === ".00" ? ".00" : m) + "×" }),
    ]);
    /* keep two decimals for 1.00× */
    today.querySelector(".pill").textContent = (Number(s.multiplier) || 0).toFixed(2) + "×";
    hero.appendChild(today);
    wrap.appendChild(hero);

    const chartWrap = el("div", { class: "chart-wrap" }, [el("canvas", { id: "equity-chart" })]);
    wrap.appendChild(chartWrap);
    const ranges = el("div", { class: "ranges" }, RANGES.map((r) =>
      el("button", { class: store.range === r ? "on" : "", text: r, onClick: () => setRange(r) })
    ));
    wrap.appendChild(ranges);

    wrap.appendChild(viewLiveCard(s));

    const bots = s.bots || [];
    const running = bots.filter((b) => b.status === "running" && !b.paused).length;
    wrap.appendChild(el("div", { class: "sec-head" }, [
      el("span", { text: "Bots · " + running + " running" }),
      el("a", { class: "sec-link", href: "#/bots", text: "See all" }),
    ]));
    wrap.appendChild(viewBotCarousel(bots));

    wrap.appendChild(el("div", { class: "sec-head" }, [
      el("span", { text: "Activity" }),
      el("a", { class: "sec-link", href: "#/activity", text: "See all" }),
    ]));
    const rows = s.activity || [];
    if (!rows.length) wrap.appendChild(el("div", { class: "empty", text: "Waiting for the first trade" }));
    else wrap.appendChild(listRows(rows.slice(0, 5)));
    return wrap;
  }

  function setRange(r) {
    store.range = r;
    render();
    loadChart(r, false).then(() => { render(); afterPaint(); }).catch(handlePollErr);
  }

  function viewLiveCard(s) {
    const card = el("div", { class: "live-card" });
    const frame = el("div", { class: "live-frame", onClick: () => go("screen") });
    const ph = el("div", { class: "ph", text: (s.screen && s.screen.paused) ? ("Paused" + (s.screen.reason ? " · " + s.screen.reason : "")) : "No frame yet" });
    frame.appendChild(ph);
    const imgA = el("img", { alt: "Live desk frame", id: "screen-a" });
    const imgB = el("img", { alt: "", id: "screen-b" });
    frame.appendChild(imgA);
    frame.appendChild(imgB);
    screenImgs[0] = imgA;
    screenImgs[1] = imgB;
    if (store.screenUrl) {
      imgA.src = store.screenUrl;
      imgA.classList.add("show");
      ph.style.display = "none";
    }
    const ageMs = store.screenFreshAt ? Date.now() - store.screenFreshAt : Infinity;
    const fresh = ageMs < 5000;
    const tag = el("div", { class: "live-tag" + (fresh ? " fresh" : "") }, [
      el("i", { class: "dot" }),
      el("span", { text: fresh ? "Live · Bot's computer" : (store.screenAt ? "Last frame " + fmtWhen(new Date(store.screenFreshAt || store.screenAt).toISOString()) : "Last frame —") }),
    ]);
    const lane = prettyLane(s.lane);
    const laneTag = el("div", { class: "lane-tag", text: lane.text, style: { color: lane.color } });
    frame.appendChild(tag);
    frame.appendChild(laneTag);
    card.appendChild(frame);

    const lo = s.last_order;
    if (lo) {
      const name = coinLabel(lo);
      const side = String(lo.side || "").toLowerCase() === "sell" ? "Sold" : "Bought";
      const usd = money(lo.fill_usd != null ? lo.fill_usd : lo.usd);
      const verified = lo.status === "done" && lo.screen_ok && lo.api_ok;
      const label = side + " " + name + " · " + usd + " · " + (verified ? "verified" : (lo.status || "open"));
      const checks = el("div", { class: "checks" }, [
        checkDot(lo.screen_ok, "screen"),
        checkDot(lo.api_ok, "api"),
        checkDot(lo.chain_ok, "chain"),
      ]);
      card.appendChild(el("div", { class: "last-order" }, [el("div", { text: label }), checks]));
    } else {
      card.appendChild(el("div", { class: "last-order muted", text: "No orders yet" }));
    }
    return card;
  }
  function checkDot(ok, label) {
    const yes = ok === true || ok === 1 || ok === "ok" || ok === "n/a";
    const node = el("div", { class: "check" + (yes ? " ok" : ""), title: label });
    if (yes) node.textContent = "✓";
    return node;
  }
  function paintScreen(url) {
    const a = document.getElementById("screen-a");
    const b = document.getElementById("screen-b");
    const fs = document.getElementById("screen-fs-img");
    if (fs && url) fs.src = url;
    if (!a || !b) return;
    const next = screenFront ^ 1;
    const show = next === 0 ? a : b;
    const hide = next === 0 ? b : a;
    const ph = show.parentNode && show.parentNode.querySelector(".ph");
    if (!url) return;
    const onload = () => {
      show.classList.add("show");
      hide.classList.remove("show");
      if (ph) ph.style.display = "none";
      screenFront = next;
    };
    show.onload = onload;
    show.src = url;
    if (show.complete) onload();
  }

  function viewBotCarousel(bots) {
    const row = el("div", { class: "carousel" });
    (bots || []).forEach((b) => row.appendChild(miniBot(b)));
    return row;
  }
  function miniBot(b) {
    const name = (b.name || "").toLowerCase();
    const killed = /kill|killed|reject/.test(String(b.status || "") + " " + String(b.detail || ""));
    const card = el("div", { class: "bot-card" + (killed ? " strike" : "") });
    const title = el("div", { class: "name", style: { color: b.color || BOT_COLOR[name] || "#fff" } }, [
      el("i", { class: "status-dot " + (b.paused ? "paused" : (b.status || "idle")) }),
      BOT_TITLE[name] || b.name,
    ]);
    card.appendChild(title);
    card.appendChild(el("div", { class: "sum", text: b.summary || "" }));
    if (name === "scanner") {
      card.appendChild(el("div", { class: "detail muted", text: b.detail || "feed" }));
      if (killed) card.appendChild(el("div", { class: "kill-reason", text: b.detail || "" }));
      else if (b.detail && /analyst/i.test(b.detail)) card.appendChild(el("div", { class: "detail", text: "→ Analyst" }));
    } else if (name === "analyst") {
      const strips = el("div", { class: "layers-mini" });
      for (let i = 0; i < 8; i++) strips.appendChild(el("i"));
      card.appendChild(strips);
      if (b.detail) card.appendChild(el("div", { class: "detail muted", text: b.detail }));
    } else if (name === "brain") {
      card.appendChild(el("div", { class: "detail", text: b.detail || "80+ = full size" }));
    } else if (name === "executor") {
      card.appendChild(el("div", { class: "detail", text: b.detail || "Waiting for a dip -15%" }));
      card.appendChild(el("div", { class: "wait-bar" }, [el("span")]));
    } else if (name === "risk") {
      const pills = el("div", { class: "detail", style: { display: "flex", gap: "6px", flexWrap: "wrap" } }, [
        el("span", { class: "pill red", text: "stop -25%" }),
        el("span", { class: "pill green", text: "trail 40%" }),
      ]);
      card.appendChild(pills);
    }
    return card;
  }

  function listRows(rows) {
    const box = el("div", { class: "list" });
    (rows || []).forEach((r) => {
      const href = r.href || (r.kind === "rejected" ? "audit" : "coin");
      const rightCls = /^-|Stopped/.test(String(r.value || "") + String(r.title || "")) ? "neg" : (/^\+|Bought|Sold/.test(String(r.value || "") + String(r.title || "")) && String(r.value || "").indexOf("+") >= 0 ? "pos" : "");
      const row = el("div", { class: "row", onClick: () => openActivity(r) }, [
        el("div", { class: "mid" }, [
          el("div", { class: "title", text: r.title || "" }),
          el("div", { class: "sub", text: [r.subtitle, r.bot ? titleBot(r.bot) : "", fmtTime(r.ts)].filter(Boolean).join(" · ") }),
        ]),
        el("div", { class: "right" + (String(r.value || "").indexOf("+") === 0 ? " pos" : (String(r.value || "").indexOf("-") === 0 ? " neg" : "")) , text: r.value || "" }),
      ]);
      box.appendChild(row);
    });
    return box;
  }
  function titleBot(n) { return BOT_TITLE[String(n || "").toLowerCase()] || n; }
  function openActivity(r) {
    if (!r || !r.mint) return;
    if (r.href === "audit" || r.kind === "rejected") go("audit", r.mint);
    else go("coin", r.mint);
  }

  function viewBots() {
    const wrap = el("div");
    const s = store.state || {};
    const openPos = (s.positions || []).length > 0;
    BOTS.forEach((name) => {
      const summary = (s.bots || []).find((b) => b.name === name) || {};
      const dec = store.decisions[name] || {};
      const paused = !!(summary.paused || dec.paused);
      const card = el("div", { class: "bot-full" });
      const sw = el("button", {
        class: "switch" + (paused ? "" : " on") + (name === "risk" && openPos ? " locked" : ""),
        title: "Pause",
        onClick: () => togglePause(name, paused, openPos),
      });
      card.appendChild(el("div", { class: "bot-full-head" }, [
        el("i", { class: "status-dot " + (paused ? "paused" : (summary.status || "idle")) }),
        el("div", { class: "name", style: { color: BOT_COLOR[name] }, text: BOT_TITLE[name] }),
        sw,
      ]));
      card.appendChild(el("div", { class: "count", text: (summary.summary || "") + (typeof summary.count === "number" ? " · today " + summary.count : "") }));
      if (name === "risk" && openPos) {
        card.appendChild(el("div", { class: "muted", style: { fontSize: "12px", marginBottom: "8px" }, text: "Risk is locked while a position is open" }));
      }
      const decisions = (dec.decisions || []).slice(0, 20);
      if (decisions.length) {
        const list = el("div", { class: "decisions list" });
        decisions.forEach((d) => {
          list.appendChild(el("div", { class: "row", onClick: () => openDecision(d) }, [
            el("div", { class: "mid" }, [
              el("div", { class: "title", text: coinLabel(d) }),
              el("div", { class: "sub", text: (d.verdict || "") + (d.reason ? " · " + d.reason : "") }),
            ]),
            el("div", { class: "right muted", text: fmtTime(d.ts) }),
          ]));
        });
        card.appendChild(list);
      } else {
        card.appendChild(el("div", { class: "empty", style: { padding: "12px" }, text: "No decisions yet" }));
      }
      card.appendChild(el("a", { class: "settings-link", href: "#/account", text: "Settings" }));
      wrap.appendChild(card);
    });
    return wrap;
  }
  function openDecision(d) {
    if (!d || !d.mint) return;
    const v = String(d.verdict || "").toLowerCase();
    if (v === "kill" || v === "reject" || v === "rejected") go("audit", d.mint);
    else go("coin", d.mint);
  }
  async function togglePause(name, currentlyPaused, openPos) {
    if (name === "risk" && openPos && !currentlyPaused) {
      toast("Risk cannot be paused while a position is open");
      return;
    }
    const ok = await sendCommand({ op: currentlyPaused ? "resume" : "pause", bot: name });
    if (ok && store.state && store.state.bots) {
      store.state.bots.forEach((b) => { if (b.name === name) { b.paused = !currentlyPaused; b.status = currentlyPaused ? "idle" : "paused"; } });
      render();
    }
  }

  function viewActivity() {
    const rows = (store.activity && store.activity.rows) || (store.state && store.state.activity) || [];
    if (!rows.length) return el("div", { class: "empty", text: "Nothing yet tonight" });
    const wrap = el("div");
    wrap.appendChild(listRows(rows));
    return wrap;
  }

  function viewAccount() {
    const s = store.state || {};
    const acc = store.account || {};
    const mode = acc.mode || s.mode || "PAPER";
    const wrap = el("div");
    wrap.appendChild(el("div", { class: "group-label", text: "Mode" }));
    const seg = el("div", { class: "seg list" }, [
      el("button", { class: mode === "PAPER" ? "on" : "", text: "PAPER", onClick: () => setMode("PAPER") }),
      el("button", { class: mode === "LIVE" ? "on" : "off", text: "LIVE", onClick: () => startLiveConfirm() }),
    ]);
    wrap.appendChild(seg);
    if (acc.live_locked || true) {
      /* LIVE stays locked; still offer the confirm sheet so the command can be refused by the box. */
    }
    wrap.appendChild(el("div", { class: "group-label", text: "Cash" }));
    const cashBox = el("div", { class: "list", style: { padding: "10px 14px 14px" } }, [
      el("div", { class: "cash-big", text: money(acc.cash != null ? acc.cash : s.balance) }),
      paperBadge(mode),
    ]);
    wrap.appendChild(cashBox);

    wrap.appendChild(el("div", { class: "group-label", text: "FOMO" }));
    const fomoRows = el("div", { class: "list" });
    const handle = acc.fomo_handle || "";
    fomoRows.appendChild(linkRow("Your FOMO profile", handle ? "@" + handle : "Open profile", () => {
      if (acc.profile_url) window.open(acc.profile_url, "_blank", "noopener");
    }));
    fomoRows.appendChild(linkRow("Invite a friend", "Share signup link", () => invite(acc.signup_url)));
    wrap.appendChild(fomoRows);

    wrap.appendChild(el("div", { class: "group-label", text: "Copy picks" }));
    wrap.appendChild(el("div", { class: "list" }, [
      el("div", { class: "row" }, [
        el("div", { class: "mid" }, [
          el("div", { class: "title", text: "Copy picks" }),
          el("div", { class: "sub", text: "Off until this setting lands with the chapter 3 prompt." }),
        ]),
        el("div", { class: "right muted", text: "Off" }),
      ]),
    ]));

    wrap.appendChild(el("div", { class: "group-label", text: "Pushes" }));
    const pushes = acc.pushes || {};
    const note = pushes.note || "Telegram only on plan B";
    const status = pushes.connected ? "Connected" : "Not connected";
    const pushList = el("div", { class: "list" });
    pushList.appendChild(el("div", { class: "row" }, [
      el("div", { class: "mid" }, [el("div", { class: "title", text: status }), el("div", { class: "sub", text: note })]),
    ]));
    pushList.appendChild(linkRow("Send test push", "Telegram handles pushes", () => toast("Pushes go through Telegram. Nothing was sent from the app.")));
    pushList.appendChild(linkRow("Watch in Grok Bot", "Computer preview", () => go("screen")));
    wrap.appendChild(pushList);

    const settings = store.settings || {};
    const groups = settings.groups || {};
    const items = settings.settings || {};
    Object.keys(groups).forEach((g) => {
      wrap.appendChild(el("div", { class: "group-label", text: GROUP_TITLE[g] || titleize(g) }));
      const box = el("div", { class: "list" });
      (groups[g] || []).forEach((key) => {
        if (key === "desk.mode") return; /* mode has its own control */
        box.appendChild(settingRow(key, items[key]));
      });
      wrap.appendChild(box);
    });

    wrap.appendChild(el("div", { class: "group-label", text: "Account" }));
    wrap.appendChild(el("div", { class: "list" }, [
      el("div", { class: "row", onClick: () => confirmForget() }, [
        el("div", { class: "mid" }, [el("div", { class: "title danger", text: "Forget token" })]),
      ]),
    ]));
    return wrap;
  }
  function linkRow(title, sub, fn) {
    return el("div", { class: "row", onClick: fn }, [
      el("div", { class: "mid" }, [el("div", { class: "title", text: title }), sub ? el("div", { class: "sub", text: sub }) : null]),
      el("div", { class: "right muted", text: "›" }),
    ]);
  }
  function settingRow(key, spec) {
    spec = spec || {};
    const type = spec.type || "float";
    const wrap = el("div", { class: "setting", dataset: { key: key } });
    const lab = el("div", { class: "lab" }, [el("b", { text: titleize(key) })]);
    wrap.appendChild(lab);
    if (type === "bool") {
      const sw = el("button", { class: "switch" + (spec.value ? " on" : ""), onClick: () => commitSetting(key, !spec.value) });
      lab.appendChild(sw);
      return wrap;
    }
    if (type === "enum" || (spec.choices && spec.choices.length)) {
      const seg = el("div", { class: "seg" });
      (spec.choices || []).forEach((c) => {
        seg.appendChild(el("button", { class: String(spec.value) === String(c) ? "on" : "", text: String(c), onClick: () => commitSetting(key, c) }));
      });
      wrap.appendChild(seg);
      return wrap;
    }
    if (type === "time") {
      const inp = el("input", { type: "time", value: spec.value || "" });
      inp.addEventListener("change", () => commitSetting(key, inp.value));
      wrap.appendChild(inp);
      return wrap;
    }
    if (type === "str") {
      const inp = el("input", { type: "text", value: spec.value == null ? "" : String(spec.value) });
      inp.addEventListener("change", () => commitSetting(key, inp.value));
      wrap.appendChild(inp);
      return wrap;
    }
    const min = spec.min != null ? Number(spec.min) : 0;
    const max = spec.max != null ? Number(spec.max) : 100;
    const step = type === "int" ? 1 : (max - min > 1000 ? 1 : 0.1);
    const num = el("input", { class: "num", type: "number", value: spec.value, min: String(min), max: String(max), step: String(step) });
    lab.appendChild(num);
    const range = el("input", { type: "range", min: String(min), max: String(max), step: String(step), value: spec.value });
    range.addEventListener("input", () => { num.value = range.value; });
    range.addEventListener("change", () => commitSetting(key, type === "int" ? parseInt(range.value, 10) : parseFloat(range.value)));
    num.addEventListener("change", () => commitSetting(key, type === "int" ? parseInt(num.value, 10) : parseFloat(num.value)));
    wrap.appendChild(range);
    return wrap;
  }
  async function commitSetting(key, value) {
    if (key === "desk.mode" && value === "LIVE") { startLiveConfirm(); return; }
    const ok = await sendCommand({ op: "settings", key: key, value: value });
    if (ok && store.settings && store.settings.settings && store.settings.settings[key]) {
      store.settings.settings[key].value = value;
      render();
    }
  }
  async function setMode(mode) {
    if (mode === "LIVE") { startLiveConfirm(); return; }
    await sendCommand({ op: "mode", value: "PAPER" });
  }
  function startLiveConfirm() {
    store.sheet = { kind: "live" };
    render();
  }
  function confirmForget() {
    store.sheet = { kind: "forget" };
    render();
  }
  async function invite(url) {
    if (!url) { toast("No signup link yet"); return; }
    if (navigator.share) {
      try { await navigator.share({ title: "FOMO", url: url }); return; } catch (e) { /* fall through */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch (e) {
      toast("Couldn't copy the link");
    }
  }
  function openBell() {
    store.sheet = { kind: "bell" };
    render();
  }

  function viewCoin() {
    const mint = store.param;
    const c = store.coin[mint];
    const wrap = el("div");
    if (!c) {
      wrap.appendChild(el("div", { class: "skel", style: { height: "200px", marginTop: "8px" } }));
      return wrap;
    }
    const head = el("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" } });
    const left = el("div");
    left.appendChild(el("div", { class: "coin-name", text: c.name || c.symbol || shortMint(c.mint) }));
    const metaBits = [c.symbol, "Solana", c.age].filter(Boolean).join(" · ");
    left.appendChild(el("div", { class: "coin-meta" }, [
      el("span", { text: metaBits }),
      el("span", { class: "pill", text: c.shield || "0/8" }),
      paperBadge((store.state && store.state.mode) || "PAPER"),
    ]));
    head.appendChild(left);
    wrap.appendChild(head);
    if (c.price == null) {
      wrap.appendChild(el("div", { class: "muted", style: { margin: "16px 0 4px" }, text: "No price yet" }));
    } else {
      wrap.appendChild(el("div", { class: "price-lg", text: money(c.price, 6) }));
    }
    if (c.change_since_entry != null) {
      const up = Number(c.change_since_entry) >= 0;
      wrap.appendChild(el("div", { class: up ? "pos" : "neg", text: (up ? "▲ " : "▼ ") + pct(c.change_since_entry) + " since entry" }));
    }
    wrap.appendChild(el("div", { class: "chart-wrap", style: { height: "160px" } }, [el("canvas", { id: "candle-chart" })]));
    wrap.appendChild(el("div", { class: "stats" }, [
      stat("Market cap", fmtCompact(c.market_cap)),
      stat("Liquidity", fmtCompact(c.liquidity)),
      stat("Holders", c.holders == null ? "—" : String(c.holders)),
    ]));
    if (c.position) {
      wrap.appendChild(el("div", { class: "list" }, [
        el("div", { class: "row" }, [
          el("div", { class: "mid" }, [
            el("div", { class: "title", text: "Your position · " + money(c.position.size_usd) + " in" }),
            el("div", { class: "sub", text: "Executor" }),
          ]),
        ]),
      ]));
    }
    wrap.appendChild(el("div", { class: "dual-btns" }, [
      el("button", { class: "btn-fomo", text: "Open on FOMO", onClick: () => c.link && window.open(c.link, "_blank", "noopener") }),
      el("button", { class: "btn-sell", text: "Sell now", onClick: () => openSell(c) }),
    ]));
    return wrap;
  }
  function stat(k, v) { return el("div", { class: "stat" }, [el("div", { class: "k", text: k }), el("div", { class: "v", text: v })]); }
  function fmtCompact(n) {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    const x = Number(n);
    if (x >= 1e6) return "$" + (x / 1e6).toFixed(1) + "M";
    if (x >= 1e3) return "$" + (x / 1e3).toFixed(1) + "K";
    return money(x, 0);
  }
  function openSell(c) {
    store.sheet = { kind: "sell", mint: c.mint, pct: 100, link: c.link };
    render();
  }

  function viewAudit() {
    const mint = store.param;
    const a = store.audit[mint];
    const wrap = el("div");
    if (!a) {
      wrap.appendChild(el("div", { class: "skel", style: { height: "240px" } }));
      return wrap;
    }
    wrap.appendChild(el("div", { class: "coin-name", text: a.name || a.symbol || shortMint(a.mint) }));
    const layers = a.layers || [];
    const list = el("div", { class: "audit-list" });
    for (let i = 1; i <= 8; i++) {
      const L = layers.find((x) => Number(x.n) === i) || { n: i, name: "Layer " + i, pass: null, value: "" };
      const pass = L.pass === true;
      const fail = L.pass === false;
      list.appendChild(el("div", { class: "audit-item" }, [
        el("div", { class: "disc" + (pass ? " pass" : "") + (fail ? " fail" : "") + (i === 1 ? " beam" : ""), text: pass ? "✓" : (fail ? "×" : String(L.n)) }),
        el("div", { class: "layer" }, [
          el("div", { class: "lname", text: L.name || ("Layer " + L.n) }),
          el("div", { class: "lval", text: L.value || (L.pass == null ? "No reading yet" : "") }),
        ]),
      ]));
    }
    wrap.appendChild(list);
    const social = a.social_note || (a.social == null ? "Social: off" : ("Social +" + (a.social_pts || 0)));
    wrap.appendChild(el("div", { class: "social-row", text: social }));
    if (a.link) {
      wrap.appendChild(el("button", { class: "primary", style: { marginTop: "16px" }, text: "Open on FOMO", onClick: () => window.open(a.link, "_blank", "noopener") }));
    }
    return wrap;
  }

  function viewSearch() {
    const wrap = el("div");
    const input = el("input", { class: "search-box", id: "search-input", type: "search", placeholder: "Name, symbol or mint", value: store.searchQ || "" });
    input.addEventListener("input", () => { store.searchQ = input.value; renderSearchResults(); });
    wrap.appendChild(input);
    wrap.appendChild(el("div", { id: "search-results" }));
    setTimeout(() => { const n = document.getElementById("search-input"); if (n) n.focus(); renderSearchResults(); }, 0);
    return wrap;
  }
  function allKnownCoins() {
    const map = {};
    const add = (row) => {
      if (!row || !row.mint) return;
      map[row.mint] = Object.assign({}, map[row.mint] || {}, row);
    };
    (store.state && store.state.positions || []).forEach(add);
    (store.state && store.state.activity || []).forEach(add);
    (store.activity && store.activity.rows || []).forEach(add);
    Object.keys(store.decisions).forEach((name) => {
      (store.decisions[name].decisions || []).forEach(add);
    });
    Object.values(store.coin).forEach(add);
    return Object.values(map);
  }
  function renderSearchResults() {
    const box = document.getElementById("search-results");
    if (!box) return;
    const q = String(store.searchQ || "").trim().toLowerCase();
    box.replaceChildren();
    if (!q) { box.appendChild(el("div", { class: "empty", text: "Search by name, symbol or mint" })); return; }
    const hits = allKnownCoins().filter((c) => {
      const blob = [c.name, c.symbol, c.mint, c.title].join(" ").toLowerCase();
      return blob.indexOf(q) >= 0;
    });
    if (!hits.length && q.length >= 32) {
      box.appendChild(el("div", { class: "list" }, [
        el("div", { class: "row", onClick: () => go("coin", store.searchQ.trim()) }, [
          el("div", { class: "mid" }, [el("div", { class: "title", text: "Open mint" }), el("div", { class: "sub", text: shortMint(store.searchQ.trim()) })]),
        ]),
      ]));
      return;
    }
    if (!hits.length) { box.appendChild(el("div", { class: "empty", text: "No matches" })); return; }
    const list = el("div", { class: "list" });
    hits.forEach((c) => {
      list.appendChild(el("div", { class: "row", onClick: () => go("coin", c.mint) }, [
        el("div", { class: "mid" }, [
          el("div", { class: "title", text: coinLabel(c) }),
          el("div", { class: "sub", text: shortMint(c.mint) }),
        ]),
      ]));
    });
    box.appendChild(list);
  }

  function viewScreenFs() {
    const wrap = el("div", { class: "screen-fs" });
    const s = store.state || {};
    const lo = s.last_order || {};
    const link = lo.link || (lo.mint && store.coin[lo.mint] && store.coin[lo.mint].link);
    wrap.appendChild(el("div", { class: "bar" }, [
      el("button", { class: "back-label", onClick: () => history.back() }, [ICO.back(), " Close"]),
      el("button", { class: "sec-link", text: "Open on FOMO", onClick: () => link && window.open(link, "_blank", "noopener"), style: { opacity: link ? 1 : 0.4, padding: "12px" } }),
    ]));
    const stage = el("div", { class: "stage", id: "screen-stage" });
    const img = el("img", { id: "screen-fs-img", alt: "Desk frame", src: store.screenUrl || "" });
    stage.appendChild(img);
    wrap.appendChild(stage);
    enablePinch(stage, img);
    return wrap;
  }
  function enablePinch(stage, img) {
    let scale = 1, start = 1, lastX = 0, lastY = 0, tx = 0, ty = 0;
    const apply = () => { img.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + scale + ")"; };
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    stage.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) { start = scale; }
      if (e.touches.length === 1) { lastX = e.touches[0].clientX; lastY = e.touches[0].clientY; }
    }, { passive: true });
    stage.addEventListener("touchmove", (e) => {
      if (e.touches.length === 2) {
        const d0 = dist(e.touches);
        if (!stage._d0) stage._d0 = d0;
        scale = Math.min(6, Math.max(1, start * (d0 / (stage._d0 || d0))));
        apply();
      } else if (e.touches.length === 1 && scale > 1) {
        tx += e.touches[0].clientX - lastX;
        ty += e.touches[0].clientY - lastY;
        lastX = e.touches[0].clientX;
        lastY = e.touches[0].clientY;
        apply();
      }
    }, { passive: true });
    stage.addEventListener("touchend", () => { stage._d0 = 0; if (scale <= 1) { scale = 1; tx = 0; ty = 0; apply(); } });
  }

  function viewSheet() {
    const sh = store.sheet || {};
    const back = el("div", { class: "sheet-back", onClick: (e) => { if (e.target === back) closeSheet(); } });
    const box = el("div", { class: "sheet" }, [el("div", { class: "grab" })]);
    if (sh.kind === "sell") {
      box.appendChild(el("h2", { text: "Sell now" }));
      [25, 50, 100].forEach((p) => {
        box.appendChild(el("button", { class: "choice" + (sh.pct === p ? " on" : ""), text: p + "%", onClick: () => { store.sheet.pct = p; render(); } }));
      });
      box.appendChild(el("button", { class: "confirm", text: "Confirm sell", onClick: () => confirmSell() }));
      box.appendChild(el("button", { class: "cancel", text: "Cancel", onClick: closeSheet }));
    } else if (sh.kind === "live") {
      box.appendChild(el("h2", { text: "Switch to LIVE" }));
      box.appendChild(el("div", { class: "muted", style: { textAlign: "center", marginBottom: "8px" }, text: "Type LIVE to confirm. The desk will refuse this until LIVE is unlocked." }));
      const inp = el("input", { id: "live-confirm", type: "text", placeholder: "LIVE", autocomplete: "off", autocapitalize: "characters" });
      const goBtn = el("button", { class: "confirm", id: "live-go", disabled: true, text: "Confirm LIVE", onClick: () => confirmLive() });
      inp.addEventListener("input", () => { goBtn.disabled = inp.value !== "LIVE"; });
      box.appendChild(inp);
      box.appendChild(goBtn);
      box.appendChild(el("button", { class: "cancel", text: "Cancel", onClick: closeSheet }));
    } else if (sh.kind === "forget") {
      box.appendChild(el("h2", { text: "Forget token" }));
      box.appendChild(el("div", { class: "muted", style: { textAlign: "center", margin: "0 0 12px" }, text: "Removes the desk-data token from this phone. The desk is unchanged." }));
      box.appendChild(el("button", { class: "confirm", text: "Forget token", onClick: () => { closeSheet(); forgetToken(); } }));
      box.appendChild(el("button", { class: "cancel", text: "Cancel", onClick: closeSheet }));
    } else if (sh.kind === "bell") {
      box.appendChild(el("h2", { text: "Alerts" }));
      box.appendChild(el("div", { class: "empty", text: "Pushes come through Telegram." }));
      box.appendChild(el("button", { class: "cancel", text: "Close", onClick: closeSheet }));
    }
    back.appendChild(box);
    return back;
  }
  async function confirmSell() {
    const sh = store.sheet || {};
    const ok = await sendCommand({ op: "sell", mint: sh.mint, pct: sh.pct || 100, confirm: true });
    if (ok) closeSheet();
  }
  async function confirmLive() {
    const inp = document.getElementById("live-confirm");
    if (!inp || inp.value !== "LIVE") return;
    const ok = await sendCommand({ op: "mode", value: "LIVE", confirm: "LIVE" });
    if (ok) closeSheet();
  }

  /* ---------- odometer + charts after paint ---------- */
  function afterPaint() {
    paintOdometer();
    const eq = document.getElementById("equity-chart");
    if (eq && window.DeskCharts) {
      equityCanvas = eq;
      window.DeskCharts.drawEquity(eq, store.chart[store.range] || { points: [], marks: [], start: (store.state && store.state.night_start_balance) || 0, range: store.range }, { reduced: reduced });
    }
    const cd = document.getElementById("candle-chart");
    if (cd && window.DeskCharts && store.route === "coin") {
      candleCanvas = cd;
      const c = store.coin[store.param] || {};
      window.DeskCharts.drawCandles(cd, { candles: c.candles || [], exit_line: c.exit_line });
    }
    if (store.screenUrl) paintScreen(store.screenUrl);
  }

  function paintOdometer() {
    const root = document.getElementById("balance-odo");
    if (!root) return;
    const n = store.state && store.state.balance != null ? Number(store.state.balance) : null;
    const text = n == null ? "—" : money(n);
    const next = String(text);
    if (reduced || !root.dataset.prev) {
      root.textContent = next;
      root.dataset.prev = next;
      return;
    }
    const prev = root.dataset.prev;
    if (prev === next) {
      if (!root.childNodes.length) root.textContent = next;
      return;
    }
    root.replaceChildren();
    const max = Math.max(prev.length, next.length);
    const p = prev.padStart(max, " ");
    const q = next.padStart(max, " ");
    for (let i = 0; i < max; i++) {
      if (!/\d/.test(q[i]) || !/\d/.test(p[i])) {
        root.appendChild(el("span", { class: "ch", text: q[i] === " " ? "" : q[i] }));
        continue;
      }
      const roll = el("span", { class: "roll" });
      const strip = el("span", { class: "strip" });
      const from = Number(p[i]);
      const to = Number(q[i]);
      let k = from;
      strip.appendChild(el("span", { text: String(k) }));
      const steps = [];
      while (k !== to) { k = (k + 1) % 10; steps.push(k); }
      if (!steps.length) { root.appendChild(el("span", { class: "ch", text: q[i] })); continue; }
      steps.forEach((d) => strip.appendChild(el("span", { text: String(d) })));
      roll.appendChild(strip);
      root.appendChild(roll);
      const delay = i * 30;
      requestAnimationFrame(() => {
        setTimeout(() => { strip.style.transform = "translateY(-" + steps.length + "em)"; }, delay);
      });
    }
    root.dataset.prev = next;
  }

  function handlePollErr(err) {
    store.error = (err && err.message) || "Desk offline";
    store.retryIn = Math.ceil(POLL_MS / 1000);
    render();
  }

  function startRetryClock() {
    clearInterval(retryTimer);
    retryTimer = setInterval(() => {
      if (store.retryIn > 0) {
        store.retryIn -= 1;
        if (store.error) {
          const b = document.querySelector(".banner");
          if (b && store.state) b.textContent = "Desk offline · retrying in " + store.retryIn + "s · last update " + fmtWhen(store.state.updated_at || new Date(store.lastOkAt).toISOString());
        }
      }
    }, 1000);
  }

  /* ---------- boot ---------- */
  captureFragment();
  store.token = readToken();
  parseRoute();
  if (!store.token) store.route = "setup";
  render();
  if (store.token) {
    refresh(true);
    startPolling();
  }
  startRetryClock();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  window.addEventListener("resize", () => afterPaint());
})();
