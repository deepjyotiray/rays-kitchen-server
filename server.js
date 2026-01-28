const express = require("express");
const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "100kb" }));

function createRateLimiter({ windowMs = 60_000, max = 300 } = {}) {
  const buckets = new Map();
  return function rateLimit(req, res, next) {
    const key = req.ip || req.connection?.remoteAddress || "anon";
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || now - bucket.start >= windowMs) {
      buckets.set(key, { start: now, count: 1 });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({ error: "Too many requests" });
    }
    next();
  };
}

const generalLimiter = createRateLimiter({ windowMs: 60_000, max: 500 });
const apiLimiter = createRateLimiter({ windowMs: 60_000, max: 150 });

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
  if (cached && Date.now() - cached.ts < 24 * 60 * 60 * 1000) {
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

app.use(async (req, _res, next) => {
  ensureLogDir();
  const ip =
    (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
    req.ip ||
    req.connection?.remoteAddress ||
    "unknown";
  const ua = (req.headers["user-agent"] || "").toString().replace(/\s+/g, " ").slice(0, 300);
  const when = new Date().toISOString();
  let geo = "";
  try {
    geo = (await lookupGeo(ip)) || "";
  } catch {
    geo = "";
  }
  const line = `${when} ip=${ip} geo="${geo}" method=${req.method} path="${req.originalUrl}" ua="${ua}"\n`;
  fsSync.appendFile(ACCESS_LOG, line, { encoding: "utf8" }, () => {});
  next();
});

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

async function proxyMenu(type, res) {
  try {
    const resp = await fetchWithFallback(`/menu?type=${type}`);
    if (!resp.ok) throw new Error("MENU_API_FAILED");
    const data = await resp.json();
    res.set("Cache-Control", "no-store");
    res.json(data.menu || data);
  } catch (e) {
    const fileMap = {
      main: "menu.json",
      corporate: "corporate_menu.json",
      motd: "menuOfTheDay.json",
    };
    const localFile = fileMap[type] || fileMap.main;
    try {
      const filePath = path.join(publicPath, localFile);
      const raw = await fs.readFile(filePath, "utf8");
      res.set("Cache-Control", "no-store");
      res.json(JSON.parse(raw));
    } catch (err) {
      res.status(502).json({ error: "MENU_BACKEND_UNAVAILABLE" });
    }
  }
}

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

// Serve hosted invoice/receipt pages
app.get(["/invoice", "/invoice/"], (_req, res) => {
  res.sendFile(path.join(publicPath, "invoice", "index.html"));
});

app.get(["/receipt", "/receipt/"], (_req, res) => {
  res.sendFile(path.join(publicPath, "receipt", "index.html"));
});

console.log("Serving static from:", publicPath);

/* 1️⃣ Serve static assets */
app.use(express.static(publicPath));

/* Admin console */
app.get(["/admin", "/admin/"], (_req, res) => {
  res.sendFile(path.join(publicPath, "admin.html"));
});

/* 2️⃣ API routes */
app.use("/api", require("./routes/delivery.routes"));
app.use("/api", require("./routes/admin.routes"));

/* 3️⃣ SPA routes we actually serve */
app.get(["/", "/corporate"], (_req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

/* 4️⃣ Everything else: 404 */
app.use((req, res) => {
  res.status(404).send("Not found");
});

app.listen(8080, () => {
  console.log("Server running on http://localhost:8080");
});
