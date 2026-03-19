const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const { invalidateCache } = require("../services/menuPdf.service");
const { doubleCsrf } = require("csrf-csrf");

const router = express.Router();

// ADMIN_API_KEY is guaranteed present by server.js startup check
const ADMIN_KEY = process.env.ADMIN_API_KEY;

const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.SESSION_SECRET || process.env.ADMIN_API_KEY,
  cookieName: "__Host-psifi.x-csrf-token",
  cookieOptions: { sameSite: "strict", secure: process.env.NODE_ENV === "production", httpOnly: true },
});

// Skip CSRF for API-key-authenticated requests; enforce for session-based ones
function csrfUnlessApiKey(req, res, next) {
  if (req.headers["x-admin-key"]) return next();
  return doubleCsrfProtection(req, res, next);
}

// Expose CSRF token to the SPA
router.get("/admin/csrf-token", (req, res) => {
  res.json({ token: generateToken(req, res) });
});

const publicDir = path.join(__dirname, "..", "public");
const configPath = path.join(__dirname, "..", "config", "app-state.json");
const BACKEND_BASE = process.env.ORDER_BACKEND_URL || "https://admin.healthymealspot.com";

async function readJson(filePath, fallback = {}) {
  try {
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data);
  } catch (e) {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  const key = req.headers["x-admin-key"];
  if (key && key === ADMIN_KEY) return next();
  res.status(401).json({ error: "Unauthorized" });
}

/* === PUBLIC STATE (GET ONLY) === */
router.get("/state", async (_req, res) => {
  const state = await readJson(configPath, { kitchenClosedToday: false });
  res.json(state);
});

/* === ADMIN: STATE === */
router.post("/admin/state", requireAdmin, csrfUnlessApiKey, async (req, res) => {
  const current = await readJson(configPath, { kitchenClosedToday: false });
  const nextState = {
    ...current,
    kitchenClosedToday: !!req.body.kitchenClosedToday,
  };
  await writeJson(configPath, nextState);
  res.json(nextState);
});

/* === ADMIN: MENU LOAD/SAVE === */
router.get("/admin/menu", requireAdmin, async (req, res) => {
  const type = (req.query.type || "main").toLowerCase();
  if (!["main", "corporate", "motd"].includes(type)) {
    return res.status(400).json({ error: "Invalid menu type" });
  }
  try {
    const resp = await fetch(`${BACKEND_BASE}/admin/menu?type=${encodeURIComponent(type)}`, {
      headers: { "x-admin-key": ADMIN_KEY },
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch {
    res.status(502).json({ error: "MENU_BACKEND_UNAVAILABLE" });
  }
});

router.put("/admin/menu", requireAdmin, csrfUnlessApiKey, async (req, res) => {
  const type = (req.body.type || "").toLowerCase();
  if (!["main", "corporate", "motd"].includes(type)) {
    return res.status(400).json({ error: "Invalid menu type" });
  }

  const menu = req.body.menu;
  if (!menu || typeof menu !== "object")
    return res.status(400).json({ error: "Menu payload missing" });

  try {
    const resp = await fetch(`${BACKEND_BASE}/admin/menu`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": ADMIN_KEY,
      },
      body: JSON.stringify({ type, menu }),
    });
    const data = await resp.json();
    if (type === "main" && resp.ok) invalidateCache();
    res.status(resp.status).json(data);
  } catch {
    res.status(502).json({ error: "MENU_BACKEND_UNAVAILABLE" });
  }
});

module.exports = router;
