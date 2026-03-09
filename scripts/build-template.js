const { PDFDocument } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Extract and compress the template image via Python, then build a lean template PDF
async function main() {
  const PUBLIC = path.join(__dirname, '..', 'public');

  // Use Python to extract + compress the image
  execSync(`python3 -c "
from PIL import Image
import zlib
data = open('${PUBLIC}/menuBlank.pdf','rb').read()
idx = data.find(b'18 0 obj')
ss = data.find(b'stream', idx) + 7
se = data.find(b'endstream', ss)
raw = zlib.decompress(data[ss:se].strip())
img = Image.frombytes('RGB', (1728, 2464), raw)
img2 = img.resize((864, 1232), Image.LANCZOS)
img2.save('${PUBLIC}/tmpl_bg.jpg', 'JPEG', quality=85, optimize=True)
print('done')
"`);

  const jpgBytes = fs.readFileSync(path.join(PUBLIC, 'tmpl_bg.jpg'));
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const jpgImage = await doc.embedJpg(jpgBytes);
  const page = doc.addPage([595, 842]);
  page.drawImage(jpgImage, { x: 0, y: 0, width: 595, height: 842 });
  const outBytes = await doc.save({ useObjectStreams: true });
  fs.writeFileSync(path.join(PUBLIC, 'menuTemplate.pdf'), Buffer.from(outBytes));
  console.log('Template PDF:', (outBytes.length / 1024).toFixed(0), 'KB');
}

main().catch(e => { console.error(e.message); process.exit(1); });
