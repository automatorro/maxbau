/**
 * Script: update_eps_xps_pricing.mjs
 *
 * Utilizare:
 *   node scripts/update_eps_xps_pricing.mjs                   <- arată tabelele comparative
 *   node scripts/update_eps_xps_pricing.mjs --execute         <- aplică actualizările în DB
 *
 * Citește fișierele Excel din argument sau le caută automat în uploads/:
 *   node scripts/update_eps_xps_pricing.mjs --eps <cale_eps.xlsx> --xps <cale_xps.xlsx>
 *
 * Ce face:
 *   1. Interogă DB: toate produsele EPS/XPS (products + product_prices)
 *   2. Parsează cele două fișiere Excel
 *   3. Afișează tabele comparative (EPS separat, XPS separat)
 *   4. Cu --execute: actualizează pret_lista + upsert product_prices per tip ofertă
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Citire .env ──────────────────────────────────────────────────────────────
const envPath = resolve(ROOT, '.env');
if (!existsSync(envPath)) {
  console.error('❌  Fișierul .env nu există. Creează-l cu VITE_SUPABASE_URL și SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const envText = readFileSync(envPath, 'utf-8');
const getEnv = (k) => envText.match(new RegExp(k + '\\s*=\\s*[\'"]?([^\\n\'"]+)[\'"]?'))?.[1]?.trim();

const SUPABASE_URL = getEnv('VITE_SUPABASE_URL');
const SERVICE_KEY  = getEnv('SUPABASE_SERVICE_ROLE_KEY');
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Lipsesc VITE_SUPABASE_URL sau SUPABASE_SERVICE_ROLE_KEY din .env');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Argumente CLI ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const EXECUTE        = args.includes('--execute');
const INSERT_HIRSCH  = args.includes('--insert-hirsch');
let epsPath = null, xpsPath = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--eps') epsPath = args[i + 1];
  if (args[i] === '--xps') xpsPath = args[i + 1];
}

// Cale implicită — fișierele din uploads
if (!epsPath) {
  const candidates = [
    resolve(ROOT, 'EPS_baza_completa.xlsx'),
    resolve(ROOT, 'uploads/EPS_baza_completa.xlsx'),
  ];
  epsPath = candidates.find(existsSync) || null;
}
if (!xpsPath) {
  const candidates = [
    resolve(ROOT, 'XPS_baza_completa.xlsx'),
    resolve(ROOT, 'uploads/XPS_baza_completa.xlsx'),
  ];
  xpsPath = candidates.find(existsSync) || null;
}

if (!epsPath || !xpsPath) {
  console.error('❌  Nu s-au găsit fișierele Excel. Specifică-le explicit:');
  console.error('    node scripts/update_eps_xps_pricing.mjs --eps <EPS.xlsx> --xps <XPS.xlsx>');
  process.exit(1);
}
console.log(`📄  EPS: ${epsPath}`);
console.log(`📄  XPS: ${xpsPath}`);

// ── Citire Excel ──────────────────────────────────────────────────────────────
function readExcel(path) {
  const wb = XLSX.readFile(path);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: null });
}

const epsRaw = readExcel(epsPath);
const xpsRaw = readExcel(xpsPath);

// ── Parse EPS ─────────────────────────────────────────────────────────────────
// Coloane: Producător, Tip ofertă, Rezistență, Grosime (mm),
//          Preț lei/m³, Plăci/bax, mp/bax, m³/bax, Preț lei/bax, Preț lei/mp
function parseEps(rows) {
  const products = {}; // key = "producator|rezistenta|grosime"
  for (const r of rows) {
    const prod    = String(r['Producător'] || '').trim();
    const tip     = String(r['Tip ofertă'] || '').trim();
    const rez     = String(r['Rezistență'] || '').trim();
    const grosime = Number(r['Grosime (mm)'] || 0);
    const pretM3  = Number(r['Preț lei/m³'] || 0);
    const placiB  = r['Plăci/bax'];
    const mpB     = r['mp/bax'];
    const m3B     = r['m³/bax'];
    const pretBax = Number(r['Preț lei/bax'] || 0);
    const pretMp  = Number(r['Preț lei/mp']  || 0);

    if (!prod || !tip || !rez || !grosime) continue;
    const key = `${prod}|${rez}|${grosime}`;
    if (!products[key]) {
      products[key] = {
        producator: prod, rezistenta: rez, grosime,
        placi_bax: placiB, mp_bax: mpB, m3_bax: m3B,
        preturi: {},
      };
    }
    products[key].preturi[tip] = { pretMp, pretBax, pretM3 };
  }
  return Object.values(products);
}

// ── Parse XPS ─────────────────────────────────────────────────────────────────
// Coloane: Producător, Tip ofertă, Grosime (mm), Preț €/m³,
//          Preț lei/m³, Plăci/bax, mp/bax, m³/bax, Preț lei/bax, Preț lei/mp
// Tip XPS: Fibran / Fibrostir L / Fibrostir Muchie Dreaptă
function parseXps(rows) {
  const products = {};
  for (const r of rows) {
    const prod    = String(r['Producător'] || '').trim();
    const tip     = String(r['Tip ofertă'] || '').trim();
    const grosime = Number(r['Grosime (mm)'] || 0);
    const pretEur = Number(r['Preț €/m³']   || 0);
    const pretM3  = Number(r['Preț lei/m³']  || 0);
    const placiB  = r['Plăci/bax'];
    const mpB     = r['mp/bax'];
    const m3B     = r['m³/bax'];
    const pretBax = Number(r['Preț lei/bax'] || 0);
    const pretMp  = Number(r['Preț lei/mp']  || 0);

    if (!prod || !tip || !grosime) continue;
    const key = `${prod}|${grosime}`;
    if (!products[key]) {
      products[key] = {
        producator: prod, grosime,
        placi_bax: placiB, mp_bax: mpB, m3_bax: m3B,
        preturi: {},
      };
    }
    products[key].preturi[tip] = { pretMp, pretBax, pretM3, pretEur };
  }
  return Object.values(products);
}

const epsProducts = parseEps(epsRaw);
const xpsProducts = parseXps(xpsRaw);

// ── Interogare DB ─────────────────────────────────────────────────────────────
async function fetchDbProducts() {
  // Caută toate produsele care conțin EPS sau XPS sau polistiren în denumire
  const { data, error } = await sb
    .from('products')
    .select('id, cod_intern, denumire_completa, pret_lista, unit, packaging, pack_quantity, manufacturer, brand, supplier_id, specifications, grile_pret')
    .or('denumire_completa.ilike.%EPS%,denumire_completa.ilike.%XPS%,denumire_completa.ilike.%polistiren%,denumire_completa.ilike.%polistirena%');

  if (error) {
    console.error('❌  Eroare la interogarea produselor:', error.message);
    process.exit(1);
  }

  // Extrage și product_prices pentru fiecare produs găsit
  const ids = (data || []).map(p => p.id);
  let priceRows = [];
  if (ids.length > 0) {
    const { data: pp, error: ppErr } = await sb
      .from('product_prices')
      .select('*')
      .in('product_id', ids);
    if (!ppErr) priceRows = pp || [];
  }

  const priceMap = {};
  for (const pp of priceRows) {
    if (!priceMap[pp.product_id]) priceMap[pp.product_id] = {};
    priceMap[pp.product_id][pp.price_type] = pp;
  }

  return { products: data || [], priceMap };
}

// ── Funcții de matching ───────────────────────────────────────────────────────
function normalize(s) {
  return String(s || '').toLowerCase()
    .replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
    .replace(/ș/g, 's').replace(/ț/g, 't').replace(/ş/g, 's').replace(/ţ/g, 't')
    .replace(/\s+/g, ' ').trim();
}

// Caută grosimea reală în mm din denumire.
// Evităm dimensiunile plăcii (ex: "600 x 1250 mm") și căutăm contextul "grosime".
function extractThicknessMm(name) {
  const n = normalize(name);
  // Prioritate maximă: "10 cm grosime" sau "grosime 10 cm"
  let m = n.match(/(\d+(?:[.,]\d+)?)\s*cm\s+grosime/);
  if (m) return Math.round(Number(m[1].replace(',', '.')) * 10);
  m = n.match(/grosime\s+(\d+(?:[.,]\d+)?)\s*cm/);
  if (m) return Math.round(Number(m[1].replace(',', '.')) * 10);
  // mm fără context dimensional — limităm la ≤400mm (grosimi reale de izolaţie)
  m = n.match(/(\d+)\s*mm/);
  if (m && Number(m[1]) <= 400) return Number(m[1]);
  // cm generic (fără keyword "grosime")
  m = n.match(/(\d+(?:[.,]\d+)?)\s*cm/);
  if (m) return Math.round(Number(m[1].replace(',', '.')) * 10);
  return null;
}

// Caută rezistența EPS: EPS50, EPS 100, EPS100 GRAFITAT etc.
function extractResistance(name) {
  const n = normalize(name).toUpperCase();
  const m = n.match(/EPS\s*(\d+)/);
  if (!m) return null;
  // "grafitat" sau "neopor" pot apărea oriunde în denumire (nu doar după număr)
  const hasGrafitat = n.includes('GRAFITAT') || n.includes('NEOPOR');
  return 'EPS' + m[1] + (hasGrafitat ? ' GRAFITAT' : '');
}

// Caută producătorul în denumire
const EPS_PRODUCERS = ['adeplast', 'hirsch', 'baumit'];
const XPS_PRODUCERS = ['fibran', 'fibrostir'];

function extractProducer(name, producers) {
  const n = normalize(name);
  for (const p of producers) {
    if (n.includes(normalize(p))) return p;
  }
  return null;
}

// Scor de match EPS: returneaz { score: 0-3, reasons }
function scoreEpsMatch(dbProduct, excelItem) {
  const name = normalize(dbProduct.denumire_completa);
  let score = 0;
  const reasons = [];

  // Producător
  const dbProducer = extractProducer(name, EPS_PRODUCERS);
  if (dbProducer && normalize(excelItem.producator).includes(dbProducer)) {
    score++;
    reasons.push(`prod:${dbProducer}`);
  }

  // Rezistență
  const dbRez = extractResistance(name);
  if (dbRez && dbRez === excelItem.rezistenta) {
    score++;
    reasons.push(`rez:${dbRez}`);
  }

  // Grosime
  const dbThick = extractThicknessMm(name);
  if (dbThick !== null && dbThick === excelItem.grosime) {
    score++;
    reasons.push(`gros:${dbThick}mm`);
  }

  return { score, reasons };
}

// Scor XPS
function scoreXpsMatch(dbProduct, excelItem) {
  const name = normalize(dbProduct.denumire_completa);
  let score = 0;
  const reasons = [];

  // Tip XPS în denumire
  const isXps = name.includes('xps');
  if (isXps) { score++; reasons.push('xps'); }

  // Producător
  const dbProducer = extractProducer(name, XPS_PRODUCERS);
  const excelProdNorm = normalize(excelItem.producator);
  if (dbProducer && excelProdNorm.includes(dbProducer)) {
    score++;
    reasons.push(`prod:${dbProducer}`);
  }
  // Fibrostir L vs Fibrostir Muchie Dreaptă — diferențiem după "muchie" / " l "
  if (dbProducer === 'fibrostir') {
    const excelHasMuchie = excelProdNorm.includes('muchie');
    const dbHasMuchie = name.includes('muchie');
    const excelIsL = excelItem.producator.trim().endsWith(' L') || excelItem.producator.trim() === 'Fibrostir L';
    const dbIsL = name.match(/fibrostir\s+l\b/);
    if ((excelHasMuchie && !dbHasMuchie) || (!excelHasMuchie && dbHasMuchie)) {
      score--; reasons.push('!subtip_fibrostir');
    }
    if ((excelIsL && !dbIsL) || (!excelIsL && dbIsL)) {
      score--; reasons.push('!subtip_L');
    }
  }

  // Grosime
  const dbThick = extractThicknessMm(name);
  if (dbThick !== null && dbThick === excelItem.grosime) {
    score++;
    reasons.push(`gros:${dbThick}mm`);
  }

  return { score, reasons };
}

function findBestMatch(dbProducts, excelItem, isXps) {
  let best = null, bestScore = -1;
  for (const p of dbProducts) {
    const { score, reasons } = isXps
      ? scoreXpsMatch(p, excelItem)
      : scoreEpsMatch(p, excelItem);
    if (score > bestScore) {
      bestScore = score;
      best = { product: p, score, reasons };
    }
  }
  // Scor minim pentru potrivire: 3/3 sau cel puțin 2 din 3 cu XPS
  const MIN_SCORE = isXps ? 2 : 3;
  return bestScore >= MIN_SCORE ? best : null;
}

// ── Afișare tabele comparative ────────────────────────────────────────────────
function pad(s, n, right = false) {
  const str = String(s ?? '');
  return right
    ? str.padStart(n).substring(0, n)
    : str.padEnd(n).substring(0, n);
}

function fmtPrice(n) {
  if (!n && n !== 0) return '—';
  return Number(n).toFixed(2);
}

function printEpsTable(epsExcel, dbAll, priceMap) {
  console.log('\n');
  console.log('═'.repeat(130));
  console.log('  TABEL COMPARATIV — POLISTIREN EXPANDAT EPS');
  console.log('═'.repeat(130));

  const header = [
    pad('Producător', 10), pad('Rezistență', 14), pad('Gros(mm)', 8),
    pad('mp/bax', 6), pad('bax', 4),
    pad('——— DIN EXCEL (lei/mp) ———', 40),
    pad('——— ÎN DB ———', 45),
    pad('Status', 18),
  ].join(' │ ');
  console.log(header);
  console.log('─'.repeat(130));

  const subHeader = [
    pad('', 10), pad('', 14), pad('', 8), pad('', 6), pad('', 4),
    pad('Lista', 8), pad('Full Tir', 8), pad('MU+Capac', 8), pad('Livr Dir', 8), pad('', 4),
    pad('Denumire DB', 40), pad('pret_lista', 10), pad('price_types', 22),
    pad('', 18),
  ].join(' │ ');
  console.log(subHeader);
  console.log('─'.repeat(130));

  let matched = 0, notFound = 0;
  const matchResults = [];

  for (const e of epsExcel) {
    const match = findBestMatch(dbAll, e, false);
    const pretLista   = fmtPrice(e.preturi['Lista']?.pretMp);
    const pretFullTir = fmtPrice(e.preturi['Full Tir']?.pretMp);
    const pretMu      = fmtPrice(e.preturi['MU+Capac']?.pretMp);
    const pretLivr    = fmtPrice(e.preturi['Livrare Directă']?.pretMp);

    let dbDenumire = '—', dbPretLista = '—', dbPriceTypes = '—', status = '';

    if (match) {
      matched++;
      dbDenumire  = match.product.denumire_completa;
      dbPretLista = fmtPrice(match.product.pret_lista);
      const pp = priceMap[match.product.id] || {};
      dbPriceTypes = Object.keys(pp).join(', ') || '(gol)';
      status = `✅ match (${match.score}/3)`;
    } else {
      notFound++;
      status = '❌ NEGĂSIT';
    }

    console.log([
      pad(e.producator, 10), pad(e.rezistenta, 14), pad(e.grosime, 8),
      pad(e.mp_bax, 6), pad(e.placi_bax, 4),
      pad(pretLista, 8), pad(pretFullTir, 8), pad(pretMu, 8), pad(pretLivr, 8), pad('', 4),
      pad(dbDenumire, 40), pad(dbPretLista, 10), pad(dbPriceTypes, 22),
      status,
    ].join(' │ '));

    matchResults.push({ excel: e, match, isXps: false });
  }

  console.log('─'.repeat(130));
  console.log(`  Total EPS: ${epsExcel.length} poziții Excel | ✅ ${matched} găsite în DB | ❌ ${notFound} negăsite`);
  return matchResults;
}

function printXpsTable(xpsExcel, dbAll, priceMap) {
  console.log('\n');
  console.log('═'.repeat(130));
  console.log('  TABEL COMPARATIV — POLISTIREN EXTRUDAT XPS');
  console.log('═'.repeat(130));

  const header = [
    pad('Producător', 24), pad('Gros(mm)', 8),
    pad('mp/bax', 6), pad('bax', 4),
    pad('——— DIN EXCEL (lei/mp) ———', 24),
    pad('——— ÎN DB ———', 45),
    pad('Status', 18),
  ].join(' │ ');
  console.log(header);
  console.log('─'.repeat(130));

  const subHeader = [
    pad('', 24), pad('', 8), pad('', 6), pad('', 4),
    pad('Lista', 10), pad('Livr Dir', 10), pad('', 4),
    pad('Denumire DB', 40), pad('pret_lista', 10), pad('price_types', 22),
    pad('', 18),
  ].join(' │ ');
  console.log(subHeader);
  console.log('─'.repeat(130));

  let matched = 0, notFound = 0;
  const matchResults = [];

  for (const e of xpsExcel) {
    const match = findBestMatch(dbAll, e, true);
    const pretLista = fmtPrice(e.preturi['Lista']?.pretMp);
    const pretLivr  = fmtPrice(e.preturi['Livrare Directă']?.pretMp);

    let dbDenumire = '—', dbPretLista = '—', dbPriceTypes = '—', status = '';

    if (match) {
      matched++;
      dbDenumire  = match.product.denumire_completa;
      dbPretLista = fmtPrice(match.product.pret_lista);
      const pp = priceMap[match.product.id] || {};
      dbPriceTypes = Object.keys(pp).join(', ') || '(gol)';
      status = `✅ match (${match.score}/3)`;
    } else {
      notFound++;
      status = '❌ NEGĂSIT';
    }

    console.log([
      pad(e.producator, 24), pad(e.grosime, 8),
      pad(e.mp_bax, 6), pad(e.placi_bax, 4),
      pad(pretLista, 10), pad(pretLivr, 10), pad('', 4),
      pad(dbDenumire, 40), pad(dbPretLista, 10), pad(dbPriceTypes, 22),
      status,
    ].join(' │ '));

    matchResults.push({ excel: e, match, isXps: true });
  }

  console.log('─'.repeat(130));
  console.log(`  Total XPS: ${xpsExcel.length} poziții Excel | ✅ ${matched} găsite în DB | ❌ ${notFound} negăsite`);
  return matchResults;
}

// ── Insert Hirsch (brand nou, fără cod intern real) ───────────────────────────
async function findOrCreateHirschSupplier() {
  const { data: existing } = await sb
    .from('suppliers')
    .select('id, name')
    .ilike('name', '%hirsch%')
    .maybeSingle();
  if (existing) {
    console.log(`   → Supplier existent: "${existing.name}" (${existing.id})`);
    return existing.id;
  }
  if (!EXECUTE) return null;
  const { data: created, error } = await sb
    .from('suppliers')
    .insert({ name: 'Hirsch Porozell', notes: 'Producător polistiren expandat EPS. Fișe tehnice: https://www.hirsch-porozell.ro/polistiren-pentru-constructii/' })
    .select('id')
    .single();
  if (error) { console.error('❌  Eroare creare supplier Hirsch:', error.message); return null; }
  console.log(`   ✅  Supplier Hirsch Porozell creat: ${created.id}`);
  return created.id;
}

async function findEpsCategory() {
  // Caută categoria cea mai specifică pentru polistiren expandat
  const { data: cats } = await sb
    .from('categories')
    .select('id, name, parent_id')
    .or('name.ilike.%polistiren expandat%,name.ilike.%EPS%,name.ilike.%polistiren%');
  if (!cats || cats.length === 0) return null;
  // Preferă categorii cu parent (subcategorie) și cu "expandat" sau "EPS" în nume
  const best = cats.find(c => c.parent_id && /expandat|EPS/i.test(c.name))
    || cats.find(c => /expandat|EPS/i.test(c.name))
    || cats.find(c => c.parent_id)
    || cats[0];
  console.log(`   → Categorie EPS selectată: "${best.name}" (${best.id})`);
  return best.id;
}

async function previewAndInsertHirsch(hirschItems, supplierId, categoryId) {
  if (hirschItems.length === 0) {
    console.log('   ℹ️   Nu există produse Hirsch nematchuite în Excel.');
    return;
  }

  console.log(`\n${'═'.repeat(100)}`);
  console.log(`  HIRSCH — ${hirschItems.length} produse de inserat (cod_intern temporar HIRSCH-xxx)`);
  console.log('═'.repeat(100));

  const toInsert = hirschItems.map(r => {
    const grosimeCm = r.excel.grosime / 10;
    // cod_intern temporar — se înlocuiește manual după primirea codurilor reale
    const codIntern = `HIRSCH-${r.excel.rezistenta.replace(/\s+/g, '-')}-${r.excel.grosime}mm`;
    const denumire  = `Polistiren expandat EPS Hirsch ${r.excel.rezistenta}, ${Number.isInteger(grosimeCm) ? grosimeCm : grosimeCm.toFixed(1)} cm grosime, 1000 x 500 mm`;
    const pretLista = r.excel.preturi['Lista']?.pretMp ?? null;
    return { codIntern, denumire, pretLista, excel: r.excel };
  });

  for (const item of toInsert) {
    console.log(`  ${EXECUTE ? '→' : '⬜'} ${item.codIntern.padEnd(30)} │ ${item.denumire}`);
  }

  if (!EXECUTE) {
    console.log(`\n💡  Adaugă --execute --insert-hirsch pentru a insera cele ${toInsert.length} produse.`);
    return;
  }

  console.log('\n🔄  Inserez produsele Hirsch...\n');
  let inserted = 0, errors = 0;

  for (const item of toInsert) {
    const specs = {
      placi_bax: item.excel.placi_bax,
      mp_bax:    item.excel.mp_bax,
      m3_bax:    item.excel.m3_bax,
      pending_cod_intern: true,  // marcat pentru completare ulterioară
    };

    // Insert produs
    const { data: newProd, error: insErr } = await sb
      .from('products')
      .insert({
        cod_intern:       item.codIntern,
        denumire_completa: item.denumire,
        pret_lista:       item.pretLista,
        unit:             'mp',
        brand:            'Hirsch Porozell',
        manufacturer:     'Hirsch Porozell',
        supplier_id:      supplierId || undefined,
        category_id:      categoryId || undefined,
        specifications:   specs,
        pack_quantity:    String(item.excel.placi_bax || ''),
      })
      .select('id')
      .single();

    if (insErr) {
      console.error(`  ❌  [${item.codIntern}] insert produs: ${insErr.message}`);
      errors++;
      continue;
    }

    inserted++;
    console.log(`  ✅  [${item.codIntern}] inserat → id: ${newProd.id}`);

    // Upsert product_prices
    for (const [tipOferta, pret] of Object.entries(item.excel.preturi)) {
      const { error: ppErr } = await sb
        .from('product_prices')
        .insert({
          product_id: newProd.id,
          price_type: tipOferta,
          price:      pret.pretMp,
          unit:       'mp',
          currency:   'RON',
          valid_from: new Date().toISOString().slice(0, 10),
        });
      if (ppErr) {
        console.error(`    ⚠️   [${item.codIntern}] ${tipOferta}: ${ppErr.message}`);
      } else {
        console.log(`    📋  ${tipOferta}: ${fmtPrice(pret.pretMp)} lei/mp`);
      }
    }
  }

  console.log(`\n✅  Hirsch: ${inserted} produse inserate | ❌ ${errors} erori`);
  console.log(`\n📌  Caută produsele fără cod real: SELECT cod_intern, denumire_completa FROM products WHERE cod_intern LIKE 'HIRSCH-%';`);
}

// ── Executare actualizări ─────────────────────────────────────────────────────
async function executeUpdates(allMatchResults) {
  console.log('\n\n🔄  Pornesc actualizarea prețurilor...\n');

  let updated = 0, skipped = 0, errors = 0;

  for (const { excel, match, isXps } of allMatchResults) {
    if (!match) { skipped++; continue; }

    const productId = match.product.id;
    const tipLabel  = isXps
      ? `XPS ${excel.producator} ${excel.grosime}mm`
      : `${excel.producator} ${excel.rezistenta} ${excel.grosime}mm`;

    // 1. Actualizează pret_lista cu prețul "Lista" (lei/mp)
    const listaEntry = excel.preturi['Lista'];
    if (listaEntry) {
      const { error } = await sb
        .from('products')
        .update({
          pret_lista: listaEntry.pretMp,
          unit: 'mp',
          updated_at: new Date().toISOString(),
        })
        .eq('id', productId);

      if (error) {
        console.error(`  ❌  [${tipLabel}] update products: ${error.message}`);
        errors++;
      }
    }

    // 2. Upsert product_prices pentru fiecare tip ofertă
    for (const [tipOferta, pret] of Object.entries(excel.preturi)) {
      // Caută înregistrarea existentă
      const { data: existing } = await sb
        .from('product_prices')
        .select('id')
        .eq('product_id', productId)
        .eq('price_type', tipOferta)
        .maybeSingle();

      const payload = {
        product_id:  productId,
        price_type:  tipOferta,
        price:       pret.pretMp,
        unit:        'mp',
        currency:    'RON',
        valid_from:  new Date().toISOString().slice(0, 10),
        valid_to:    null,
      };

      let err;
      if (existing?.id) {
        ({ error: err } = await sb
          .from('product_prices')
          .update({ price: pret.pretMp, valid_from: payload.valid_from })
          .eq('id', existing.id));
      } else {
        ({ error: err } = await sb
          .from('product_prices')
          .insert(payload));
      }

      if (err) {
        console.error(`  ❌  [${tipLabel}] ${tipOferta}: ${err.message}`);
        errors++;
      } else {
        console.log(`  ✅  [${tipLabel}] ${tipOferta}: ${fmtPrice(pret.pretMp)} lei/mp`);
        updated++;
      }
    }

    // 3. Stochează ambalare în specifications (merge cu specs existente)
    const existingSpecs = match.product.specifications || {};
    const mergedSpecs = {
      ...existingSpecs,
      placi_bax: excel.placi_bax,
      mp_bax:    excel.mp_bax,
      m3_bax:    excel.m3_bax,
    };
    const { error: specsErr } = await sb
      .from('products')
      .update({
        pack_quantity:  String(excel.placi_bax || ''),
        specifications: mergedSpecs,
      })
      .eq('id', productId);
    if (specsErr) {
      console.error(`  ⚠️   [${tipLabel}] specs update: ${specsErr.message}`);
    } else {
      console.log(`  📦  [${tipLabel}] ambalare: ${excel.placi_bax} buc/bax, ${excel.mp_bax} mp/bax, ${excel.m3_bax} m³/bax`);
    }
  }

  console.log(`\n✅  Finalizat: ${updated} înregistrări actualizate | ❌ ${errors} erori | ⏭  ${skipped} negăsite (sărite)`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log('\n🔍  Interoghez baza de date...');
const { products: dbProducts, priceMap } = await fetchDbProducts();
console.log(`   → ${dbProducts.length} produse găsite cu EPS/XPS/polistiren în DB`);

// Separă EPS de XPS în DB
const dbEps = dbProducts.filter(p => /EPS/i.test(p.denumire_completa) && !/XPS/i.test(p.denumire_completa));
const dbXps = dbProducts.filter(p => /XPS/i.test(p.denumire_completa));
const dbAmbele = dbProducts; // folosim tot catalogul pentru matching (unele pot fi marcate diferit)

console.log(`   → ${dbEps.length} produse EPS | ${dbXps.length} produse XPS\n`);

// Tabelele comparative
const epsResults = printEpsTable(epsProducts, dbAmbele, priceMap);
const xpsResults = printXpsTable(xpsProducts, dbAmbele, priceMap);
const allResults = [...epsResults, ...xpsResults];

// Sumar produse negăsite
const notFoundEps = epsResults.filter(r => !r.match);
const notFoundXps = xpsResults.filter(r => !r.match);

if (notFoundEps.length > 0) {
  console.log('\n⚠️   PRODUSE EPS NEGĂSITE ÎN DB (necesită verificare manuală):');
  for (const r of notFoundEps) {
    console.log(`     • ${r.excel.producator} | ${r.excel.rezistenta} | ${r.excel.grosime}mm`);
  }
}
if (notFoundXps.length > 0) {
  console.log('\n⚠️   PRODUSE XPS NEGĂSITE ÎN DB (necesită verificare manuală):');
  for (const r of notFoundXps) {
    console.log(`     • ${r.excel.producator} | ${r.excel.grosime}mm`);
  }
}

// Arată câte potriviri avem
const totalMatched = allResults.filter(r => r.match).length;
const totalAll     = allResults.length;
console.log(`\n📊  SUMAR: ${totalMatched}/${totalAll} poziții Excel au corespondent în DB`);

// ── Hirsch insert (separat de update-ul produselor existente) ─────────────────
if (INSERT_HIRSCH) {
  console.log('\n\n🏭  INSERARE PRODUSE HIRSCH (brand nou)');
  console.log('─'.repeat(60));
  const hirschUnmatched = epsResults.filter(
    r => !r.match && normalize(r.excel.producator).includes('hirsch')
  );
  const supplierId = await findOrCreateHirschSupplier();
  const categoryId = await findEpsCategory();
  await previewAndInsertHirsch(hirschUnmatched, supplierId, categoryId);
}

if (!EXECUTE) {
  console.log('\n💡  Rulează cu --execute pentru a aplica actualizările:');
  console.log(`    node scripts/update_eps_xps_pricing.mjs --eps "${epsPath}" --xps "${xpsPath}" --execute`);
  if (INSERT_HIRSCH) {
    console.log(`    (adaugă și --insert-hirsch pentru a insera produsele Hirsch noi)`);
  } else {
    console.log(`\n💡  Pentru a adăuga produsele Hirsch noi în DB:`);
    console.log(`    node scripts/update_eps_xps_pricing.mjs --eps "${epsPath}" --xps "${xpsPath}" --insert-hirsch`);
  }
} else {
  await executeUpdates(allResults);
}
