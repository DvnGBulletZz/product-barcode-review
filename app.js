// Product Scanner PWA — scan EAN, fetch Open Food Facts, score, show alternatives.
const OFF = 'https://world.openfoodfacts.org/api/v2';
const FIELDS = 'code,product_name,brands,image_front_small_url,nutriscore_grade,nova_group,additives_tags,nutriments,categories_tags';

let rules = null;
let reader = null;

const $ = (id) => document.getElementById(id);
const startBtn = $('startBtn'), stopBtn = $('stopBtn'), readerEl = $('reader'),
      statusEl = $('status'), resultEl = $('result');

// ---- load rules + register service worker ----
fetch('assets/rules.json').then(r => r.json()).then(j => rules = j).catch(() => rules = { additives: [], thresholds_per_100g: {}, nova_ultraprocessed_flag: 4 });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// ---- scanning ----
startBtn.onclick = async () => {
  reader = new ZXing.BrowserMultiFormatReader();
  readerEl.classList.remove('hidden');
  startBtn.classList.add('hidden');
  stopBtn.classList.remove('hidden');
  resultEl.innerHTML = '';
  try {
    await reader.decodeFromConstraints(
      { video: { facingMode: 'environment' } }, readerEl,
      (res) => { if (res) { stopScan(); lookup(res.getText()); } }
    );
  } catch (e) {
    const hint = !window.isSecureContext ? ' (geen HTTPS)'
      : window.navigator.standalone ? ' (open in Safari, niet vanaf beginscherm)'
      : '';
    show(`Camera mislukt: ${e.name || e.message}${hint}`);
    stopScan();
  }
};
stopBtn.onclick = stopScan;
function stopScan() {
  if (reader) { reader.reset(); reader = null; }
  readerEl.classList.add('hidden');
  stopBtn.classList.add('hidden');
  startBtn.classList.remove('hidden');
}

// ---- lookup ----
async function lookup(ean) {
  if (navigator.vibrate) navigator.vibrate(60);
  show('Bezig met zoeken… (' + ean + ')');
  try {
    const r = await fetch(`${OFF}/product/${ean}.json?fields=${FIELDS}`,
      { headers: { 'User-Agent': 'ProductScanner/0.1 (web)' } });
    const j = await r.json();
    if (j.status !== 1 || !j.product) { show(`Product niet gevonden (${ean}). Probeer een ander product.`); return; }
    statusEl.classList.add('hidden');
    render(j.product);
  } catch (e) { show('Netwerkfout. Controleer je verbinding.'); }
}

// ---- scoring ----
function analyze(p) {
  const n = p.nutriments || {};
  const t = rules.thresholds_per_100g || {};
  const flags = [];

  // additives
  for (const a of (rules.additives || [])) {
    if ((p.additives_tags || []).includes(a.code))
      flags.push({ severity: a.severity, text: `${a.name} — ${a.reason}` });
  }
  // ultra-processed
  if (p.nova_group >= (rules.nova_ultraprocessed_flag || 4))
    flags.push({ severity: 'high', text: 'Sterk bewerkt product (NOVA 4)' });
  // nutrient thresholds
  const lvl = (v, hi, mid) => v == null ? null : v >= hi ? 'high' : v >= mid ? 'medium' : 'low';
  const checks = [
    ['Veel suiker', lvl(n.sugars_100g, t.sugars_high, t.sugars_medium)],
    ['Veel zout', lvl(n.salt_100g, t.salt_high, t.salt_medium)],
    ['Veel verzadigd vet', lvl(n['saturated-fat_100g'], t.saturated_fat_high, t.saturated_fat_medium)],
  ];
  for (const [label, l] of checks) if (l === 'high' || l === 'medium') flags.push({ severity: l, text: label });

  // verdict
  const grade = (p.nutriscore_grade || '').toLowerCase();
  const hasHigh = flags.some(f => f.severity === 'high');
  let color = 'orange';
  if (hasHigh || grade === 'd' || grade === 'e') color = 'red';
  else if (!flags.length && (grade === 'a' || grade === 'b')) color = 'green';
  const label = color === 'green' ? 'Goede keuze' : color === 'orange' ? 'Matig' : 'Beter vermijden';
  return { flags, color, label };
}

// ---- render ----
function render(p) {
  const a = analyze(p);
  const n = p.nutriments || {};
  const stat = (v, unit) => v == null ? '–' : Math.round(v * 10) / 10 + (unit || '');
  const name = p.product_name || 'Onbekend product';
  const ns = (p.nutriscore_grade || '?').toUpperCase();

  resultEl.innerHTML = `
    <div class="card">
      <div class="row">
        ${p.image_front_small_url ? `<img src="${p.image_front_small_url}" style="width:56px;height:56px;object-fit:contain;border-radius:10px;background:#fff">` : ''}
        <div><div style="font-weight:700">${name}</div><div class="muted">${p.brands || ''}</div></div>
      </div>
      <div class="verdict" style="margin-top:14px"><span class="dot ${a.color}"></span>${a.label}</div>
      <div class="row" style="gap:6px;margin-top:8px">
        <span class="badge ${nsColor(p.nutriscore_grade)}">Nutri ${ns}</span>
        <span class="muted">NOVA ${p.nova_group || '?'}</span>
      </div>
      <div class="grid">
        <div class="stat"><b>${stat(n['energy-kcal_100g'])}</b><span>kcal /100g</span></div>
        <div class="stat"><b>${stat(n.sugars_100g, '')}</b><span>suiker g</span></div>
        <div class="stat"><b>${stat(n.salt_100g, '')}</b><span>zout g</span></div>
        <div class="stat"><b>${stat(n.fat_100g, '')}</b><span>vet g</span></div>
        <div class="stat"><b>${stat(n['saturated-fat_100g'], '')}</b><span>verz. vet g</span></div>
        <div class="stat"><b>${stat(n.proteins_100g, '')}</b><span>eiwit g</span></div>
      </div>
      ${a.flags.length ? `<h3>Let op</h3>${a.flags.map(f => `<div class="flag ${f.severity}">${f.text}</div>`).join('')}` : '<h3>Geen waarschuwingen 👍</h3>'}
    </div>
    <div id="alts" class="card"><div class="muted">Betere alternatieven zoeken…</div></div>`;

  loadAlternatives(p);
}

function nsColor(g) { g = (g || '').toLowerCase(); return (g === 'a' || g === 'b') ? 'green' : g === 'c' ? 'orange' : 'red'; }

async function loadAlternatives(p) {
  const cat = (p.categories_tags || []).slice(-1)[0]; // most specific
  const box = $('alts');
  if (!cat) { box.innerHTML = '<div class="muted">Geen categorie om alternatieven te zoeken.</div>'; return; }
  try {
    const url = `${OFF}/search?categories_tags=${encodeURIComponent(cat)}&sort_by=nutriscore_score&page_size=12&fields=${FIELDS}`;
    const j = await (await fetch(url)).json();
    const cur = (p.nutriscore_grade || 'z').toLowerCase();
    const better = (j.products || [])
      .filter(x => x.code !== p.code && x.nutriscore_grade && x.nutriscore_grade.toLowerCase() < cur && x.product_name)
      .slice(0, 5);
    box.innerHTML = '<h3 style="margin-top:0">Betere alternatieven</h3>' + (better.length
      ? better.map(x => `<div class="alt">
          ${x.image_front_small_url ? `<img src="${x.image_front_small_url}">` : '<div style="width:44px;height:44px"></div>'}
          <div style="flex:1"><div>${x.product_name}</div><div class="muted">${x.brands || ''}</div></div>
          <span class="badge ${nsColor(x.nutriscore_grade)}">${x.nutriscore_grade.toUpperCase()}</span></div>`).join('')
      : '<div class="muted">Geen betere alternatieven gevonden in deze categorie.</div>');
  } catch (e) { box.innerHTML = '<div class="muted">Alternatieven laden mislukt.</div>'; }
}

function show(msg) { statusEl.textContent = msg; statusEl.classList.remove('hidden'); }
