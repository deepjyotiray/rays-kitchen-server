const { PDFDocument, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const fs = require("fs").promises;
const path = require("path");

const TEMPLATE_PATH = path.join(__dirname, "..", "public", "menuTemplate.pdf");
const FONTS_DIR     = path.join(__dirname, "..", "public", "fonts");

let cache = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

// Pre-load static assets once at startup
let _templateBytes, _boldFont, _italicFont;
async function loadAssets() {
  if (_templateBytes) return;
  [_templateBytes, _boldFont, _italicFont] = await Promise.all([
    fs.readFile(TEMPLATE_PATH),
    fs.readFile(path.join(FONTS_DIR, "PlayfairDisplay-Bold.ttf")),
    fs.readFile(path.join(FONTS_DIR, "PlayfairDisplay-Italic.ttf")),
  ]);
}

// PDF page: 595 x 842 pts (A4), origin = bottom-left
// Template image analysis: decorative header occupies top ~262pt
// Safe content area (cream body):
const AREA = { left: 62, right: 564, top: 575, bottom: 38 };
const AREA_W = AREA.right - AREA.left;   // ~502 pts
const AREA_H = AREA.top  - AREA.bottom;  // ~537 pts

const C = {
  title  : rgb(0.50, 0.08, 0.02),
  item   : rgb(0.12, 0.08, 0.04),
  price  : rgb(0.50, 0.08, 0.02),
  sub    : rgb(0.35, 0.22, 0.08),
  note   : rgb(0.40, 0.25, 0.05),
  divider: rgb(0.70, 0.58, 0.40),
  veg    : rgb(0.05, 0.48, 0.05),
  nonveg : rgb(0.65, 0.08, 0.05),
};

async function buildMenuPdf(menuData) {
  await loadAssets();
  const tmplDoc = await PDFDocument.load(_templateBytes, { updateMetadata: false });

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const [bold, italic] = await Promise.all([
    pdfDoc.embedFont(_boldFont),
    pdfDoc.embedFont(_italicFont),
  ]);
  const reg = bold; // use bold for all text

  const [tmplPage] = await pdfDoc.embedPdf(tmplDoc, [0]);

  const sections = Object.values(menuData).filter(s => {
    const hasItems = s.items?.length;
    const isAvailable = s.available !== false;
    console.log(`Section "${s.title}": hasItems=${hasItems}, available=${s.available}, isAvailable=${isAvailable}`);
    return hasItems && isAvailable;
  });

  for (const section of sections) {
    const page = pdfDoc.addPage([595, 842]);
    page.drawPage(tmplPage, { x: 0, y: 0, width: 595, height: 842 });

    let y = AREA.top;

    // Centered content band: indent 40pt from each side of AREA
    const CX       = AREA.left + 40;
    const CW       = AREA_W - 80;
    const TITLE_SZ = 20;
    const FONT_SZ  = 14;
    const LINE_H   = 15;

    // Header height
    const headerH = 22 + 10 + (section.subheading ? 16 : 0);
    const notesCount = section.note ? Object.values(section.note).flat().length : 0;
    const available = AREA_H - headerH - (notesCount * 14);

    // Calculate per-item row heights based on wrap, then scale up to fill space
    const itemRowHeights = section.items.map(item => {
      const priceW  = bold.widthOfTextAtSize(`Rs.${item.price}`, FONT_SZ);
      const nameW   = reg.widthOfTextAtSize(item.name, FONT_SZ);
      const rows    = Math.ceil(nameW / (CW - priceW - 24));
      return 30 + (rows > 1 ? (rows - 1) * LINE_H : 0);
    });
    const totalNatural = itemRowHeights.reduce((a, b) => a + b, 0) + section.items.length * 6;
    // Scale factor: expand rows to fill available space (cap at 2x natural)
    const scale = Math.min(available / totalNatural, 2);
    const GAP = Math.max(6, 6 * scale);

    // Section title — centered
    const titleW = bold.widthOfTextAtSize(section.title.toUpperCase(), TITLE_SZ);
    page.drawText(section.title.toUpperCase(), {
      x: AREA.left + (AREA_W - titleW) / 2, y,
      size: TITLE_SZ, font: bold, color: C.title,
    });
    y -= 22;

    // Underline
    page.drawLine({
      start: { x: CX, y }, end: { x: CX + CW, y },
      thickness: 1, color: C.title,
    });
    y -= 10;

    // Subheading — centered
    if (section.subheading) {
      page.drawText(section.subheading, {
        x: CX, y, size: 9, font: italic, color: C.sub, maxWidth: CW,
      });
      y -= 16;
    }

    let itemY = y;
    for (const item of section.items) {
      const priceStr = `Rs.${item.price}`;
      const priceW   = bold.widthOfTextAtSize(priceStr, FONT_SZ);
      const nameMaxW = CW - priceW - 24;
      const rowH     = Math.round(itemRowHeights[section.items.indexOf(item)] * scale);

      // stop drawing if we'd overflow the bottom boundary
      if (itemY - rowH < AREA.bottom) break;

      page.drawCircle({ x: CX + 5, y: itemY - 5, size: 4.5,
        color: item.veg ? C.veg : C.nonveg,
        borderColor: item.veg ? C.veg : C.nonveg, borderWidth: 1 });

      page.drawText(item.name, {
        x: CX + 16, y: itemY - 7,
        size: FONT_SZ, font: reg, color: C.item,
        maxWidth: nameMaxW,
        lineHeight: LINE_H,
      });
      page.drawText(priceStr, {
        x: CX + CW - priceW,
        y: itemY - 7,
        size: FONT_SZ, font: bold, color: C.price,
      });
      page.drawLine({
        start: { x: CX, y: itemY - rowH + 4 }, end: { x: CX + CW, y: itemY - rowH + 4 },
        thickness: 0.4, color: C.divider,
      });
      itemY -= rowH + GAP;
    }

    // Extras/notes
    if (section.note) {
      itemY -= 4;
      for (const extras of Object.values(section.note)) {
        for (const extra of extras) {
          page.drawText(`+ ${extra.item}  Rs.${extra.price}`, {
            x: CX, y: itemY, size: 10, font: italic, color: C.note,
          });
          itemY -= 14;
        }
      }
    }
  }

  return pdfDoc.save({ useObjectStreams: true });
}

async function getMenuPdf() {
  if (cache && Date.now() - cache.generatedAt < CACHE_TTL_MS) return cache.pdfBytes;
  const backendBase = process.env.ORDER_BACKEND_URL || "https://admin.healthymealspot.com";
  const resp = await fetch(`${backendBase}/menu?type=main`);
  if (!resp.ok) throw new Error("menu_fetch_failed");
  const json = await resp.json();
  const menuData = json.menu || json;
  console.log('healthySubs available:', menuData.healthySubs?.available);
  const pdfBytes = await buildMenuPdf(menuData);
  cache = { pdfBytes, generatedAt: Date.now() };
  return pdfBytes;
}

function invalidateCache() { cache = null; }

module.exports = { getMenuPdf, invalidateCache };
