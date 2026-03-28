require("dotenv").config();

// Fail fast on required secrets
if (!process.env.ADMIN_API_KEY) throw new Error("ADMIN_API_KEY env var is required");
if (!process.env.WHATSAPP_AGENT_SECRET) throw new Error("WHATSAPP_AGENT_SECRET env var is required");
if (process.env.WHATSAPP_AGENT_SECRET === 'change-this-secret') throw new Error("WHATSAPP_AGENT_SECRET is still the default placeholder — set the real value from whatsapp-agent config/settings.json api.secret");

const express = require("express");
const compression = require("compression");
const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");
const session = require("express-session");
const { rateLimit } = require("express-rate-limit");
const { SqliteSessionStore } = require("./services/sqliteSessionStore");

const app = express();
app.disable("x-powered-by");
const isProduction = process.env.NODE_ENV === "production";
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS) || 1;
app.set("trust proxy", isProduction ? trustProxyHops : 1);

function isEnvFlagEnabled(name) {
  return /^(1|true)$/i.test(String(process.env[name] || "").trim());
}

const enableGeoLogs = isEnvFlagEnabled("ENABLE_GEO_LOGS");
const skipMenuPdf = !isProduction && isEnvFlagEnabled("SKIP_MENU_PDF");
const disableAgentCalls = !isProduction && isEnvFlagEnabled("DISABLE_AGENT_CALLS");
const slowRequestThresholdMs = Number(process.env.SLOW_REQUEST_THRESHOLD_MS) || 1200;

function schedulePrune(task, intervalMs) {
  const timer = setInterval(task, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

function pruneExpiredEntries(map, isExpired, maxEntries = Infinity) {
  if (!(map instanceof Map) || map.size === 0) return;
  for (const [key, value] of map) {
    if (isExpired(value)) map.delete(key);
  }
  if (map.size <= maxEntries) return;
  const overflow = map.size - maxEntries;
  let removed = 0;
  for (const key of map.keys()) {
    map.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

/* Security headers */
app.use((_req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "0",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(self), camera=(), microphone=()",
    "Content-Security-Policy":
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https:; " +
      "font-src 'self'; " +
      "connect-src 'self' https://api.healthymealspot.com https://www.google-analytics.com https://nominatim.openstreetmap.org; " +
      "frame-ancestors 'none';",
  });
  next();
});
app.use(
  express.json({
    limit: "100kb",
    verify: (req, _res, buf) => {
      req.rawBody = buf; // keep raw body for signature verification on webhooks
    },
  })
);

app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= slowRequestThresholdMs) {
      console.warn(`[slow] ${req.method} ${req.originalUrl} -> ${res.statusCode} in ${elapsed}ms`);
    }
  });
  next();
});

/* Session middleware */
const sessionStore = isProduction ? new SqliteSessionStore() : undefined;
app.use(session({
  secret: process.env.SESSION_SECRET || (isProduction ? (() => { throw new Error('SESSION_SECRET is required in production'); })() : 'dev-only-insecure-secret'),
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

const generalLimiter = rateLimit({ windowMs: 60_000, max: 500, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60_000, max: 150, standardHeaders: true, legacyHeaders: false });
const userLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });

app.use(generalLimiter);

/* Host allowlist: block unexpected hosts */
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS ||
  "healthymealspot.com,www.healthymealspot.com,localhost,127.0.0.1").split(",").map(h => h.trim().toLowerCase()).filter(Boolean);
app.use((req, res, next) => {
  const host = (req.headers.host || "").toLowerCase().split(":")[0];
  if (host && !ALLOWED_HOSTS.includes(host)) {
    return res.status(403).send("Forbidden");
  }
  next();
});

/* Block obvious unwanted WordPress setup probes */
const blockedPaths = new Set([
  "/wp-admin/setup-config.php",
  "/wordpress/wp-admin/setup-config.php",
]);
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  const looksPhp = p.endsWith(".php");
  const wpProbe =
    p.startsWith("/wp-admin") ||
    p.startsWith("/wordpress/wp-admin") ||
    p.includes("wp-includes") ||
    p.includes("/wp-") ||
    p.includes("/wp/") ||
    p.includes("wlwmanifest") ||
    p.includes("xmlrpc");
  if (blockedPaths.has(p) || wpProbe || looksPhp) {
    return res.status(404).send("Not found");
  }
  next();
});

/* =============== ACCESS LOGGING WITH GEO (best-effort) =============== */
const LOG_DIR = path.join(__dirname, "logs");
const ACCESS_LOG = path.join(LOG_DIR, "access.log");
const geoCache = new Map(); // ip -> { data, ts }
const GEO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const GEO_CACHE_MAX_ENTRIES = 5000;

function ensureLogDir() {
  if (!fsSync.existsSync(LOG_DIR)) {
    fsSync.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function isPrivateIp(ip = "") {
  return (
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("172.16.") ||
    ip.startsWith("172.17.") ||
    ip.startsWith("172.18.") ||
    ip.startsWith("172.19.") ||
    ip.startsWith("172.2") || // covers 172.20-172.29
    ip.startsWith("172.3") || // covers 172.30-172.31
    ip.startsWith("127.") ||
    ip === "::1" ||
    ip.startsWith("fc") ||
    ip.startsWith("fd")
  );
}

async function lookupGeo(ip) {
  if (!ip || isPrivateIp(ip)) return null;
  const cached = geoCache.get(ip);
  if (cached && Date.now() - cached.ts < GEO_CACHE_TTL_MS) {
    return cached.data;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const resp = await fetch(`https://ipapi.co/${ip}/json/`, {
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) throw new Error("geo_fail");
    const data = await resp.json();
    const city = data.city || "";
    const region = data.region || "";
    const country = data.country_name || "";
    const loc = [city, region, country].filter(Boolean).join(", ");
    const info = loc || data.country || null;
    geoCache.set(ip, { data: info, ts: Date.now() });
    return info;
  } catch {
    return null;
  }
}

schedulePrune(() => {
  pruneExpiredEntries(geoCache, (entry) => !entry || Date.now() - entry.ts >= GEO_CACHE_TTL_MS, GEO_CACHE_MAX_ENTRIES);
}, 30 * 60 * 1000);

// ip -> { geo, firstSeen, lastSeen, count, lastMethod, lastPath, lastUa }
const accessMap = new Map();
const ACCESS_LOG_TTL_MS = 24 * 60 * 60 * 1000;

function flushAccessLog() {
  const now = Date.now();
  for (const [ip, entry] of accessMap) {
    if (now - entry.lastSeen > ACCESS_LOG_TTL_MS) accessMap.delete(ip);
  }
  if (accessMap.size === 0) return;
  ensureLogDir();
  const lines = [...accessMap.entries()]
    .map(([ip, e]) =>
      `ip=${ip} geo="${e.geo}" first=${e.firstSeen} last=${e.lastSeen} count=${e.count} method=${e.lastMethod} path="${e.lastPath}" ua="${e.lastUa}"`
    )
    .join("\n") + "\n";
  fsSync.writeFile(ACCESS_LOG, lines, { encoding: "utf8" }, () => {});
}

if (enableGeoLogs) {
  app.use(async (req, _res, next) => {
    const ip =
      (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
      req.ip ||
      req.connection?.remoteAddress ||
      "unknown";
    const now = new Date().toISOString();
    const existing = accessMap.get(ip);
    if (existing) {
      existing.lastSeen = now;
      existing.count += 1;
      existing.lastMethod = req.method;
      existing.lastPath = req.originalUrl;
      existing.lastUa = (req.headers["user-agent"] || "").toString().replace(/\s+/g, " ").slice(0, 300);
    } else {
      let geo = "";
      try { geo = (await lookupGeo(ip)) || ""; } catch { geo = ""; }
      accessMap.set(ip, {
        geo,
        firstSeen: now,
        lastSeen: now,
        count: 1,
        lastMethod: req.method,
        lastPath: req.originalUrl,
        lastUa: (req.headers["user-agent"] || "").toString().replace(/\s+/g, " ").slice(0, 300),
      });
    }
    next();
  });
  schedulePrune(flushAccessLog, 5 * 60 * 1000);
}

const BACKEND_BASE =
  process.env.ORDER_BACKEND_URL || "https://admin.healthymealspot.com";
const LOCAL_BACKEND = "http://localhost:3000";
const publicPath = path.join(__dirname, "public");

async function fetchWithFallback(pathAndQuery, opts = {}) {
  const primaryUrl = `${BACKEND_BASE}${pathAndQuery}`;
  const fallbackUrl =
    BACKEND_BASE === LOCAL_BACKEND ? null : `${LOCAL_BACKEND}${pathAndQuery}`;

  try {
    const resp = await fetch(primaryUrl, opts);
    if (resp.ok || !fallbackUrl) return resp;
    // fallback if primary is not ok
  } catch (e) {
    // ignore and try fallback
  }

  if (!fallbackUrl) throw new Error("FETCH_FAILED");

  const resp2 = await fetch(fallbackUrl, opts);
  return resp2;
}

const _menuCache = new Map(); // type -> { data, ts }
const MENU_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function proxyMenu(type, res) {
  const cached = _menuCache.get(type);
  if (cached && Date.now() - cached.ts < MENU_CACHE_TTL) {
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return res.json(cached.data);
  }
  try {
    const resp = await fetchWithFallback(`/menu?type=${type}`);
    if (!resp.ok) throw new Error("MENU_API_FAILED");
    const data = await resp.json();
    const menu = data.menu || data;
    _menuCache.set(type, { data: menu, ts: Date.now() });
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.json(menu);
  } catch (e) {
    res.status(502).json({ error: "MENU_BACKEND_UNAVAILABLE" });
  }
}

schedulePrune(() => {
  pruneExpiredEntries(_menuCache, (entry) => !entry || Date.now() - entry.ts >= MENU_CACHE_TTL, 12);
}, MENU_CACHE_TTL);

/* 0️⃣ Proxy dynamic data from orders backend */
app.use(
  ["/menu.json", "/corporate_menu.json", "/menuOfTheDay.json", "/api"],
  apiLimiter
);
app.get("/coupons.json", async (_req, res) => {
  try {
    const resp = await fetchWithFallback(`/coupons`);
    if (!resp.ok) throw new Error("COUPON_API_FAILED");
    const data = await resp.json();
    res.set("Cache-Control", "no-store");
    // normalize to legacy shape if needed
    const map = {};
    (data.coupons || []).forEach(c => {
      map[c.code] = {
        minOrder: Number(c.minOrder) || 0,
        discount: Number(c.discount) || 0,
        freeDelivery: !!c.freeDelivery,
        active: c.active !== false
      };
    });
    res.json(map);
  } catch (e) {
    res.status(502).json({ error: "COUPON_BACKEND_UNAVAILABLE" });
  }
});
app.get("/menu.json", (_req, res) => proxyMenu("main", res));
app.get("/corporate_menu.json", (_req, res) => proxyMenu("corporate", res));
app.get("/menuOfTheDay.json", (_req, res) => proxyMenu("motd", res));

app.get("/api/state", async (_req, res) => {
  try {
    const resp = await fetchWithFallback(`/state`);
    if (!resp.ok) throw new Error("STATE_API_FAILED");
    const data = await resp.json();
    res.set("Cache-Control", "no-store");
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: "STATE_BACKEND_UNAVAILABLE" });
  }
});

/* User API proxy */
function normalizeMobile(mobile) {
  if (!mobile) return mobile;
  const s = String(mobile).trim();
  return s.startsWith('+91') ? s : '+91' + s.replace(/^\+/, '');
}

app.post("/users/register", async (req, res) => {
  try {
    const body = { ...req.body, mobile: normalizeMobile(req.body.mobile) };
    const resp = await fetchWithFallback(`/users/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: "USER_BACKEND_UNAVAILABLE" });
  }
});

function requireUserAuth(req, res, next) {
  // Allow valid admin API key
  if (req.headers["x-admin-key"] && req.headers["x-admin-key"] === process.env.ADMIN_API_KEY) return next();
  // Allow authenticated session owner (can only access their own mobile)
  if (req.session && req.session.authenticated) {
    const requested = normalizeMobile(decodeURIComponent(req.params.mobile));
    if (req.session.mobile === requested) return next();
    return res.status(403).json({ error: "Forbidden" });
  }
  res.status(401).json({ error: "Unauthorized" });
}

app.get("/users/:mobile", userLimiter, requireUserAuth, async (req, res) => {
  const mobile = normalizeMobile(decodeURIComponent(req.params.mobile));
  if (!/^\+[0-9]{7,15}$/.test(mobile)) return res.status(400).json({ error: "Invalid mobile" });
  try {
    const resp = await fetchWithFallback(`/users/${encodeURIComponent(mobile)}`);
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (e) {
    res.status(502).json({ error: "USER_BACKEND_UNAVAILABLE" });
  }
});

app.get("/users/:mobile/orders", userLimiter, requireUserAuth, async (req, res) => {
  const mobile = normalizeMobile(decodeURIComponent(req.params.mobile));
  if (!/^\+[0-9]{7,15}$/.test(mobile)) return res.status(400).json({ error: "Invalid mobile" });
  try {
    const resp = await fetchWithFallback(`/users/${encodeURIComponent(mobile)}/orders`);
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (e) {
    res.status(502).json({ error: "USER_BACKEND_UNAVAILABLE" });
  }
});

// Serve hosted invoice/receipt pages
app.get(["/invoice", "/invoice/"], (_req, res) => {
  res.sendFile(path.join(publicPath, "invoice", "index.html"));
});

app.get(["/receipt", "/receipt/"], (_req, res) => {
  res.sendFile(path.join(publicPath, "receipt", "index.html"));
});

/* RTC route */
app.get("/rtc", (_req, res) => {
  console.log("RTC route accessed");
  res.sendFile(path.join(publicPath, "rtc.html"));
});

console.log("Serving static from:", publicPath);

/* RTC route before static assets */
app.get("/rtc", (_req, res) => {
  console.log("RTC route accessed");
  res.sendFile(path.join(publicPath, "rtc.html"));
});

/* Menu PDF — must be before static middleware */
let menuPdfService = null;
function getMenuPdfService() {
  if (!menuPdfService) {
    menuPdfService = require("./services/menuPdf.service");
  }
  return menuPdfService;
}

app.get("/menu.pdf", apiLimiter, async (_req, res) => {
  if (skipMenuPdf) {
    return res.status(503).json({ error: "Menu PDF generation is disabled in this environment" });
  }
  try {
    const { getMenuPdf } = getMenuPdfService();
    const pdfBytes = await getMenuPdf();
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=\"menu.pdf\"", "Cache-Control": "no-store" });
    res.send(Buffer.from(pdfBytes));
  } catch (e) {
    res.status(500).json({ error: "PDF generation failed" });
  }
});

/* 1️⃣ Serve static assets */
app.use(compression());
app.use(express.static(publicPath, { etag: false, lastModified: false, setHeaders: (res, filePath) => {
  if (filePath.endsWith('.html')) res.set('Cache-Control', 'no-store');
  else if (filePath.endsWith('blogs.json')) res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
} }));

/* Admin console with auth protection */
app.get(["/admin", "/admin/"], (req, res) => {
  // Check if user is authenticated via session or redirect to backend admin
  if (req.session && req.session.isAdmin) {
    res.redirect(`${BACKEND_BASE}/admin/`);
  } else {
    res.redirect(`${BACKEND_BASE}/admin/`);
  }
});

/* Chatbot API */
const { whatsappAuthGuard } = require('./services/whatsappAuth');
const { promptGuard } = require('./services/promptGuard');

async function askAgent(message, phone) {
  const r = await fetch(AGENT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-secret': AGENT_SECRET },
    body: JSON.stringify({ phone, message })
  });
  if (!r.ok) throw new Error('agent returned ' + r.status);
  const data = await r.json();
  return data.response || data.reply || '';
}

app.post("/api/chat-test", async (req, res) => {
  res.json({ test: "This route works!", body: req.body });
});

const { filterMessage } = require('./services/messageFilter');

app.post("/api/chat", async (req, res) => {
  try {
    const { message, phone } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });
    if (disableAgentCalls) return res.json({ response: "agent disabled in this environment" });

    const filtered = await filterMessage(message);
    if (filtered) return res.json({ response: filtered });

    // Auth gate — DB check in Node, no LLM involved
    if (phone) {
      const auth = whatsappAuthGuard(phone);
      if (!auth.allowed) return res.json({ response: auth.reply });
    }

    // Prompt guard — regex injection check in Node, no LLM involved
    const guard = promptGuard(message);
    if (guard.blocked) return res.json({ response: guard.reply });
    const agentResponse = await askAgent(message, phone).catch(e => { throw new Error(`Agent call failed: ${e.message}`); });

    const itemMatches = agentResponse.match(/• (.+?) — ₹(\d+)/g);
    if (itemMatches && itemMatches.length > 0) {
      const items = itemMatches.map(match => {
        const [, name, price] = match.match(/• (.+?) — ₹(\d+)/);
        return { name, price: parseInt(price) };
      });
      return res.json({ items });
    }

    res.json({ response: agentResponse });
  } catch (error) {
    require('fs').appendFileSync('/tmp/chat-error.log', `${new Date().toISOString()} - Error: ${JSON.stringify({msg: error.message, str: String(error), type: typeof error})}\n`);
    res.status(500).json({ error: String(error.message || error || "Chatbot unavailable") });
  }
});

/* Order WhatsApp notification */
const AGENT_URL = 'http://127.0.0.1:3001/send';
const AGENT_SECRET = process.env.WHATSAPP_AGENT_SECRET;

app.post("/api/notify-order", async (req, res) => {
  const incomingSecret = req.headers["x-secret"];
  if (!incomingSecret || incomingSecret !== AGENT_SECRET) return res.status(403).json({ error: "Forbidden" });
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ error: "Missing phone or message" });
  const mobile = String(phone).replace(/^\+91/, "").replace(/\D/g, "");
  if (!/^[0-9]{10}$/.test(mobile)) return res.status(400).json({ error: "Invalid phone" });
  try {
    const r = await fetch(AGENT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-secret": AGENT_SECRET },
      body: JSON.stringify({ phone: "+91" + mobile, message })
    });
    if (!r.ok) console.error("Order notify failed:", await r.text());
  } catch (err) {
    console.error("Order notify failed:", err.message);
  }
  res.json({ ok: true });
});

/* Image proxy — caches external images in-memory for 24h, serves from own domain */
const _imgCache = new Map(); // url -> { buf, ct, ts }
const IMG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const IMG_CACHE_MAX_ENTRIES = 250;
app.get("/api/img", async (req, res) => {
  const url = req.query.url;
  if (!url || !/^https:\/\/upload\.wikimedia\.org\//.test(url))
    return res.status(400).end();
  const cached = _imgCache.get(url);
  if (cached && Date.now() - cached.ts < IMG_CACHE_TTL_MS) {
    res.set({ 'Content-Type': cached.ct, 'Cache-Control': 'public, max-age=86400', 'X-Cache': 'HIT' });
    return res.send(cached.buf);
  }
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'HealthyMealSpot/1.0 (https://healthymealspot.com; kitchen@healthymealspot.com)' } });
    if (!r.ok) throw new Error('upstream ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get('content-type') || 'image/jpeg';
    _imgCache.set(url, { buf, ct, ts: Date.now() });
    res.set({ 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400', 'X-Cache': 'MISS' });
    res.send(buf);
  } catch {
    res.status(502).end();
  }
});

schedulePrune(() => {
  pruneExpiredEntries(_imgCache, (entry) => !entry || Date.now() - entry.ts >= IMG_CACHE_TTL_MS, IMG_CACHE_MAX_ENTRIES);
}, 60 * 60 * 1000);

app.get("/api/section-images", async (_req, res) => {
  try {
    const resp = await fetchWithFallback("/api/section-images");
    if (!resp.ok) throw new Error("SECTION_IMAGES_FAILED");
    const data = await resp.json();
    const proxied = {};
    Object.entries(data).forEach(([k, url]) => {
      proxied[k] = `/api/img?url=${encodeURIComponent(url)}`;
    });
    res.set("Cache-Control", "public, max-age=3600");
    res.json(proxied);
  } catch {
    res.json({});
  }
});

app.get("/api/item-images", async (_req, res) => {
  try {
    const data = await fs.readFile(path.join(publicPath, "item-images.json"), "utf8");
    res.set("Cache-Control", "public, max-age=3600");
    res.json(JSON.parse(data));
  } catch {
    res.status(404).json({});
  }
});

app.put("/api/item-images", async (req, res) => {
  const key = req.headers["x-admin-key"];
  if (!key || key !== process.env.ADMIN_API_KEY) return res.status(401).end();
  if (!req.body || typeof req.body !== "object") return res.status(400).json({ error: "Invalid payload" });
  await fs.writeFile(path.join(publicPath, "item-images.json"), JSON.stringify(req.body, null, 2), "utf8");
  res.json({ ok: true });
});

/* 2️⃣ API routes */
app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api", require("./routes/delivery.routes"));
app.use("/api", require("./routes/deliveryEta.routes"));
app.use("/api", require("./routes/admin.routes"));

app.post("/api/admin/menu-pdf/invalidate", (req, res) => {
  const key = req.headers["x-admin-key"];
  if (!key || !process.env.ADMIN_API_KEY || key !== process.env.ADMIN_API_KEY) return res.status(401).end();
  if (menuPdfService) menuPdfService.invalidateCache();
  _menuCache.clear();
  res.json({ ok: true });
});

/* 3️⃣ SPA routes we actually serve */
app.get(["/", "/corporate"], (_req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

/* Nutrition Hub routes */
app.get("/nutrition", (_req, res) => {
  res.sendFile(path.join(publicPath, "nutrition.html"));
});

/* Category filter pages */
const NUTRITION_CATEGORIES = new Set(['weight-loss','muscle-gain','medical','recipes','myths']);
app.get("/nutrition/:slug", (req, res) => {
  const file = NUTRITION_CATEGORIES.has(req.params.slug) ? "nutrition.html" : "article.html";
  res.sendFile(path.join(publicPath, file));
});

/* Consult Nutritionist */
app.get("/consult-nutritionist", (_req, res) => {
  res.sendFile(path.join(publicPath, "consult-nutritionist.html"));
});

/* Login / Profile */
app.get("/login", (_req, res) => res.sendFile(path.join(publicPath, "login.html")));
app.get("/profile-edit", (_req, res) => res.sendFile(path.join(publicPath, "profile-edit.html")));
app.get("/profile", (_req, res) => res.sendFile(path.join(publicPath, "profile.html")));

/* About */
app.get("/about", (_req, res) => {
  res.sendFile(path.join(publicPath, "about.html"));
});

/* Healthy Meals landing page */
app.get("/healthy-meals", (_req, res) => {
  res.sendFile(path.join(publicPath, "healthy-meals.html"));
});

/* SEO Tool pages */
app.get("/protein-calculator", (_req, res) => {
  res.sendFile(path.join(publicPath, "protein-calculator.html"));
});
app.get("/calorie-calculator", (_req, res) => {
  res.sendFile(path.join(publicPath, "calorie-calculator.html"));
});
app.get("/bmi-calculator", (_req, res) => {
  res.sendFile(path.join(publicPath, "bmi-calculator.html"));
});
app.get("/provider-pressure", (_req, res) => {
  res.redirect(301, "/is-there-a-mens-day");
});
app.get("/is-there-a-mens-day", (_req, res) => {
  res.sendFile(path.join(publicPath, "is-there-a-mens-day.html"));
});

/* Author / Nutritionist profile pages */
app.get("/nutritionist/:slug", (req, res) => {
  res.sendFile(path.join(publicPath, "nutritionist", "index.html"));
});

/* 4️⃣ Everything else: 404 */
app.use((req, res) => {
  res.status(404).send("Not found");
});

app.listen(8080, () => {
  console.log("Server running on http://localhost:8080");
});
