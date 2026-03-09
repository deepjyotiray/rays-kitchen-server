const express = require("express");
const router = express.Router();

const LUNCH_WINDOW  = { start: "12:30 PM", end: "1:30 PM",  startMins: 12*60+30, endMins: 13*60+30 };
const DINNER_WINDOW = { start: "7:30 PM",  end: "8:30 PM",  startMins: 19*60+30, endMins:  20*60+30 };

const useAI = process.env.USE_AI_ETA === "true";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2";
const OLLAMA_URL = "http://localhost:11434/api/chat";

async function askOllama(prompt) {
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      messages: [
        { role: "system", content: "You are a kitchen delivery time estimator. Return ONLY a time in 12-hour format (e.g. '8:10 PM') within the given window. More items/variety = later. No explanation." },
        { role: "user", content: prompt }
      ]
    })
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const data = await res.json();
  return data.message?.content?.trim();
}

function computeEtaLocal(totalItems, uniqueCount, win) {
  // Score 0–1 based on order complexity, map into window
  const score = Math.min((totalItems / 10) * 0.6 + (uniqueCount / 5) * 0.4, 1);
  const etaMins = Math.round(win.startMins + score * (win.endMins - win.startMins));
  const h = Math.floor(etaMins / 60) % 12 || 12;
  const m = String(etaMins % 60).padStart(2, "0");
  const ampm = etaMins < 12 * 60 ? "AM" : "PM";
  return `${h}:${m} ${ampm}`;
}

router.post("/delivery-eta", async (req, res) => {
  const { items, orderDay } = req.body;

  if (!items || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: "items required" });
  }

  // Cap items to prevent prompt injection / abuse
  if (items.length > 50) {
    return res.status(400).json({ error: "Too many items" });
  }

  // Sanitize item fields before any AI usage
  const safeItems = items.map(i => ({
    name: String(i.name || "").slice(0, 80).replace(/[^ws,.-]/g, ""),
    qty: Math.max(1, Math.min(99, Number(i.qty) || 1)),
    category: String(i.category || "").slice(0, 40).replace(/[^ws-]/g, "")
  }));

  const t = new Date().getHours() * 60 + new Date().getMinutes();
  const lunchEndMins = 13 * 60 + 30;

  if (orderDay !== "today") {
    return res.json({ label: `Lunch window · ${LUNCH_WINDOW.start} – ${LUNCH_WINDOW.end}` });
  }

  const win = t < lunchEndMins ? LUNCH_WINDOW : DINNER_WINDOW;
  const windowLabel = t < lunchEndMins ? "Lunch" : "Dinner";
  const totalItems = safeItems.reduce((s, i) => s + i.qty, 0);
  const uniqueCount = new Set(safeItems.map(i => i.category).filter(Boolean)).size || 1;

  if (!useAI) {
    const time = computeEtaLocal(totalItems, uniqueCount, win);
    console.log(`[delivery-eta] local: "${time}" items=${totalItems} categories=${uniqueCount}`);
    return res.json({ label: `${windowLabel} · ${time}` });
  }

  const itemSummary = safeItems.map(i => `${i.qty}x ${i.name}`).join(", ");

  try {
    const time = await askOllama(`Order: ${itemSummary}. Total: ${totalItems} items, ${uniqueCount} categories. Window: ${win.start} – ${win.end}.`);
    console.log(`[delivery-eta] Ollama: "${time}" for: ${itemSummary}`);
    res.json({ label: `${windowLabel} · ${time}` });
  } catch (e) {
    console.error("[delivery-eta] Ollama failed, using local:", e.message);
    res.json({ label: `${windowLabel} · ${computeEtaLocal(totalItems, uniqueCount, win)}` });
  }
});

module.exports = router;
