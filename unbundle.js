// Un-bundle the single-file index.html into plain HTML + per-file assets.
//
// Reads ./index.html, extracts the __bundler/manifest and __bundler/template
// payloads, decodes/gunzips each asset, writes them to ./dist/assets/, and
// produces ./dist/index.html with UUID placeholders rewritten to relative
// asset paths.
//
// Run: node unbundle.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = __dirname;
const SRC_HTML = path.join(ROOT, 'index.html');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_ASSETS = path.join(OUT_DIR, 'assets');

const MIME_EXT = {
  'image/svg+xml': 'svg',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/x-icon': 'ico',
  'application/javascript': 'js',
  'text/javascript': 'js',
  'text/css': 'css',
  'text/html': 'html',
  'application/json': 'json',
  'font/woff': 'woff',
  'font/woff2': 'woff2',
  'application/font-woff': 'woff',
  'application/font-woff2': 'woff2',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'application/octet-stream': 'bin',
};

function extractScript(html, type) {
  const re = new RegExp(`<script type="__bundler/${type}">([\\s\\S]*?)</script>`);
  const m = html.match(re);
  if (!m) throw new Error(`Missing <script type="__bundler/${type}">`);
  return m[1].trim();
}

function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const html = fs.readFileSync(SRC_HTML, 'utf8');
console.log(`Source HTML: ${fileSize(Buffer.byteLength(html))}`);

const manifest = JSON.parse(extractScript(html, 'manifest'));
let template = JSON.parse(extractScript(html, 'template'));
const extResources = (() => {
  try { return JSON.parse(extractScript(html, 'ext_resources')); }
  catch { return []; }
})();

const uuids = Object.keys(manifest);
console.log(`Manifest entries: ${uuids.length}`);
console.log(`External resources: ${extResources.length}`);

// Reset output dir
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_ASSETS, { recursive: true });

// Decode each asset and write to disk
const replacements = {};
let totalDecoded = 0;
for (const uuid of uuids) {
  const entry = manifest[uuid];
  const raw = Buffer.from(entry.data, 'base64');
  const bytes = entry.compressed ? zlib.gunzipSync(raw) : raw;
  const ext = MIME_EXT[entry.mime] || 'bin';
  const filename = `${uuid}.${ext}`;
  fs.writeFileSync(path.join(OUT_ASSETS, filename), bytes);
  replacements[uuid] = `assets/${filename}`;
  totalDecoded += bytes.length;
  console.log(`  ${entry.mime.padEnd(20)} ${fileSize(bytes.length).padStart(10)}  ${filename}`);
}
console.log(`Total decoded: ${fileSize(totalDecoded)}`);

// Replace every UUID with its asset path
for (const uuid of uuids) {
  template = template.split(uuid).join(replacements[uuid]);
}

// The original loader strips these because blob URLs from a file:// document
// have a null origin which trips SRI. We don't need them either since the
// served files are ours.
template = template
  .replace(/\s+integrity="[^"]*"/gi, '')
  .replace(/\s+crossorigin="[^"]*"/gi, '');

// Map ext_resources ids to their asset paths so any inline script that
// references window.__resources[id] still resolves.
const resourceMap = {};
for (const entry of extResources) {
  if (replacements[entry.uuid]) resourceMap[entry.id] = replacements[entry.uuid];
}
const resourceScript =
  '<script>window.__resources = ' +
  JSON.stringify(resourceMap).split('</' + 'script>').join('<\\/' + 'script>') +
  ';</' + 'script>';
const headOpen = template.match(/<head[^>]*>/i);
if (headOpen) {
  const i = headOpen.index + headOpen[0].length;
  template = template.slice(0, i) + '\n  ' + resourceScript + template.slice(i);
}

// Lift the OG/SEO/favicon block from the current static <head> in index.html
// (everything between </noscript> and </head>) and inject it before </head>
// in the unbundled template, so social previews keep working.
const headInject = (() => {
  const m = html.match(/<\/noscript>\s*([\s\S]*?)<\/head>/);
  if (!m) return '';
  return m[1].trim();
})();
if (headInject) {
  template = template.replace(/<\/head>/i, `  ${headInject}\n</head>`);
}

const outFile = path.join(OUT_DIR, 'index.html');
fs.writeFileSync(outFile, template);
console.log(`\nWrote ${outFile} (${fileSize(Buffer.byteLength(template))})`);

// Copy sibling files we still want at the deploy root
for (const name of ['privacy.html', 'terms.html', 'logo.svg', 'robots.txt', 'LICENSE']) {
  const src = path.join(ROOT, name);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(OUT_DIR, name));
    console.log(`Copied ${name}`);
  }
}

// Copy the existing /assets folder (favicons, og-image, etc.) into dist
// alongside the bundle's UUID-named files.
const srcAssets = path.join(ROOT, 'assets');
if (fs.existsSync(srcAssets)) {
  for (const name of fs.readdirSync(srcAssets)) {
    fs.copyFileSync(path.join(srcAssets, name), path.join(OUT_ASSETS, name));
  }
  console.log(`Copied existing assets/`);
}

console.log('\nDone. Test locally with:');
console.log('  python3 -m http.server -d dist 8080');
console.log('  open http://localhost:8080');
