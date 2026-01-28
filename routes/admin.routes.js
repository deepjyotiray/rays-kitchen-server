const express = require("express");
const fs = require("fs").promises;
const path = require("path");

const router = express.Router();

const ADMIN_KEY = process.env.ADMIN_API_KEY || "mrsray";

const publicDir = path.join(__dirname, "..", "public");
const configPath = path.join(__dirname, "..", "config", "app-state.json");

const MENU_FILES = {
  main: path.join(publicDir, "menu.json"),
  corporate: path.join(publicDir, "corporate_menu.json"),
  motd: path.join(publicDir, "menuOfTheDay.json"),
};

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
router.post("/admin/state", requireAdmin, async (req, res) => {
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
  const file = MENU_FILES[type];
  if (!file) return res.status(400).json({ error: "Invalid menu type" });

  const data = await readJson(file, null);
  if (!data) return res.status(404).json({ error: "Menu not found" });

  res.json({ type, menu: data });
});

router.put("/admin/menu", requireAdmin, async (req, res) => {
  const type = (req.body.type || "").toLowerCase();
  const file = MENU_FILES[type];
  if (!file) return res.status(400).json({ error: "Invalid menu type" });

  const menu = req.body.menu;
  if (!menu || typeof menu !== "object")
    return res.status(400).json({ error: "Menu payload missing" });

  await writeJson(file, menu);
  res.json({ success: true, type });
});

module.exports = router;
