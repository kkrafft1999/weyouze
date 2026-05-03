const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const vendor = path.join(root, 'src', 'renderer', 'vendor');
const fontsDir = path.join(vendor, 'fonts');

fs.mkdirSync(vendor, { recursive: true });
fs.mkdirSync(fontsDir, { recursive: true });

// ── JS-Vendor-Bibliotheken ──────────────────────────────────────────────────
fs.copyFileSync(
  path.join(root, 'node_modules', 'marked', 'lib', 'marked.umd.js'),
  path.join(vendor, 'marked.umd.js')
);
fs.copyFileSync(
  path.join(root, 'node_modules', 'dompurify', 'dist', 'purify.min.js'),
  path.join(vendor, 'purify.min.js')
);

// ── Inter-Webfont (doubleSlash UI-Design) ───────────────────────────────────
// Wir vendoren nur die tatsaechlich benoetigten Subsets/Weights, um das Bundle
// klein zu halten. Latin + Latin-Ext deckt Deutsch (Umlaute) ab.
//   400 = Body
//   500 = Medium (Welcome-CTA, Chips, Sekundaer-Buttons — Phase 5)
//   600 = Bold (Headlines, Pills, App-Brand)
//   700 = Heavy (Welcome-Headline H1 — Phase 5, fuer Hero-Wirkung)
const interSrc = path.join(root, 'node_modules', '@fontsource', 'inter');
const interFiles = [
  'inter-latin-400-normal.woff2',
  'inter-latin-500-normal.woff2',
  'inter-latin-600-normal.woff2',
  'inter-latin-700-normal.woff2',
  'inter-latin-ext-400-normal.woff2',
  'inter-latin-ext-500-normal.woff2',
  'inter-latin-ext-600-normal.woff2',
  'inter-latin-ext-700-normal.woff2',
];
for (const file of interFiles) {
  fs.copyFileSync(
    path.join(interSrc, 'files', file),
    path.join(fontsDir, file)
  );
}
// Lizenz mitliefern (OFL-1.1 verlangt das bei Weiterverbreitung).
fs.copyFileSync(
  path.join(interSrc, 'LICENSE'),
  path.join(fontsDir, 'inter-LICENSE.txt')
);
