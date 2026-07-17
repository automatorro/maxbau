/**
 * scrape_producer_fise.mjs
 * ─────────────────────────────────────────────────────────────────
 * Recuperare fișe tehnice de pe SITE-URILE PRODUCĂTORILOR, pentru
 * produsele care NU au fișă pe maxbau.ro (fisa_tehnica_url IS NULL
 * după rularea scrape_missing_fise.mjs).
 *
 * Funcționare:
 *  1. Ia produsele fără fisa_tehnica_url, grupate pe brand
 *  2. Pentru brandurile cu sursă configurată (BRAND_SOURCES):
 *     a. caută produsul pe site-ul producătorului (URL de căutare configurat)
 *     b. alege pagina de produs cu cea mai bună suprapunere de tokeni din denumire
 *     c. extrage link-urile PDF (fișă tehnică / declarație de performanță)
 *     d. descarcă → upload în bucket-ul `fise-tehnice` → update products + log
 *  3. PDF-urile ajung în ACELAȘI pipeline: extract_specs_from_pdfs.mjs le
 *     procesează la următoarea rulare cu --skip-done.
 *
 * Rulare:
 *   node scraper/scrape_producer_fise.mjs --list-brands   # branduri fără fișe + acoperire config
 *   node scraper/scrape_producer_fise.mjs --brand baumit --test 5
 *   node scraper/scrape_producer_fise.mjs --dry-run       # toate brandurile configurate, fără scriere
 *
 * NOTĂ: selectoarele/URL-urile din BRAND_SOURCES sunt best-effort și trebuie
 * validate cu --test pe fiecare brand înainte de rulare completă — site-urile
 * producătorilor se schimbă frecvent.
 * ─────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = resolve(__dirname, '../.env');
  try {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* system envs */ }
}
loadEnv();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET       = 'fise-tehnice';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Lipsesc VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY din .env');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ─── CLI flags ───────────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const DRY_RUN     = args.includes('--dry-run');
const LIST_BRANDS = args.includes('--list-brands');
const brandIdx    = args.indexOf('--brand');
const ONLY_BRAND  = brandIdx >= 0 ? (args[brandIdx + 1] || '').toLowerCase() : null;
const testIdx     = args.indexOf('--test');
const TEST_LIMIT  = testIdx >= 0 ? parseInt(args[testIdx + 1] || '5', 10) : null;

const REQUEST_DELAY = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Configurare surse pe brand ──────────────────────────────────────────────
/**
 * searchUrl: {q} este înlocuit cu termenul de căutare (URL-encoded).
 * productLinkPattern: regex pe href-uri din pagina de căutare → pagini de produs.
 * Adaugă branduri noi aici pe măsură ce le validezi cu --test.
 */
const BRAND_SOURCES = {
  baumit: {
    domain: 'https://baumit.ro',
    searchUrl: 'https://baumit.ro/cautare?q={q}',
    productLinkPattern: /href="((?:https?:\/\/baumit\.ro)?\/produse\/[^"]+)"/gi,
  },
  adeplast: {
    domain: 'https://www.adeplast.ro',
    searchUrl: 'https://www.adeplast.ro/?s={q}',
    productLinkPattern: /href="(https?:\/\/www\.adeplast\.ro\/[^"]*produs[^"]*)"/gi,
  },
  knauf: {
    domain: 'https://www.knauf.ro',
    searchUrl: 'https://www.knauf.ro/cautare?query={q}',
    productLinkPattern: /href="((?:https?:\/\/www\.knauf\.ro)?\/[^"]*produs[^"]*)"/gi,
  },
  isomat: {
    domain: 'https://www.isomat.ro',
    searchUrl: 'https://www.isomat.ro/?s={q}',
    productLinkPattern: /href="(https?:\/\/www\.isomat\.ro\/[^"]+)"/gi,
  },
  ceresit: {
    domain: 'https://www.ceresit.ro',
    searchUrl: 'https://www.ceresit.ro/ro/search.html?q={q}',
    productLinkPattern: /href="((?:https?:\/\/www\.ceresit\.ro)?\/ro\/produse\/[^"]+)"/gi,
  },
  weber: {
    domain: 'https://www.ro.weber',
    searchUrl: 'https://www.ro.weber/cautare?keys={q}',
    productLinkPattern: /href="((?:https?:\/\/www\.ro\.weber)?\/[^"]+)"/gi,
  },
  rockwool: {
    domain: 'https://www.rockwool.com',
    searchUrl: 'https://www.rockwool.com/ro/rezultate-cautare/?query={q}',
    productLinkPattern: /href="((?:https?:\/\/www\.rockwool\.com)?\/ro\/produse[^"]+)"/gi,
  },
  austrotherm: {
    domain: 'https://www.austrotherm.ro',
    searchUrl: 'https://www.austrotherm.ro/?s={q}',
    productLinkPattern: /href="(https?:\/\/www\.austrotherm\.ro\/[^"]+)"/gi,
  },
  sika: {
    domain: 'https://rou.sika.com',
    searchUrl: 'https://rou.sika.com/ro/search.html?q={q}',
    productLinkPattern: /href="((?:https?:\/\/rou\.sika\.com)?\/[^"]+)"/gi,
  },
  mapei: {
    domain: 'https://www.mapei.com',
    searchUrl: 'https://www.mapei.com/ro/ro/rezultatele-cautarii?q={q}',
    productLinkPattern: /href="((?:https?:\/\/www\.mapei\.com)?\/ro\/ro\/produse[^"]+)"/gi,
  },
};

// ─── Helpers text ────────────────────────────────────────────────────────────

function stripDiacritics(s) {
  return s.toLowerCase()
    .replace(/[ăâ]/g, 'a').replace(/î/g, 'i')
    .replace(/[șş]/g, 's').replace(/[țţ]/g, 't');
}

/** Termen de căutare: denumirea fără brand, cantități și dimensiuni. */
function buildSearchTerm(denumire, brand) {
  let term = stripDiacritics(denumire);
  if (brand) term = term.replace(new RegExp(stripDiacritics(brand), 'gi'), ' ');
  term = term
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|l|ml|gr|g|buc|bax|sac|palet|mp|mm|cm|m)\b/gi, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*x\s*\d+(?:[.,]\d+)?(?:\s*x\s*\d+(?:[.,]\d+)?)?\b/gi, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return term.split(' ').filter((w) => w.length > 2).slice(0, 5).join(' ');
}

function tokenOverlap(a, b) {
  const ta = new Set(stripDiacritics(a).split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  const tb = stripDiacritics(b);
  let hit = 0;
  for (const t of ta) if (tb.includes(t)) hit++;
  return ta.size > 0 ? hit / ta.size : 0;
}

async function fetchWithRetry(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MaxbauBot/1.0; +https://maxbau.ro)' },
        redirect: 'follow',
      });
      if (resp.ok || resp.status === 404) return resp;
    } catch (e) {
      if (i === tries - 1) throw e;
    }
    await sleep(1000 * (i + 1));
  }
  throw new Error(`fetch eșuat după ${tries} încercări: ${url}`);
}

/** Extrage link-uri PDF dintr-o pagină, preferând fișele tehnice. */
function extractPdfLinks(html, baseDomain) {
  const links = [];
  const re = /href="([^"]+\.pdf[^"]*)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let url = m[1];
    if (url.startsWith('//')) url = 'https:' + url;
    else if (url.startsWith('/')) url = baseDomain + url;
    else if (!url.startsWith('http')) url = baseDomain + '/' + url;
    links.push(url);
  }
  // Prioritate: nume de fișier care sugerează fișă tehnică
  const score = (u) => {
    const lower = u.toLowerCase();
    if (/fisa|tehnic|technical|datasheet|tds/.test(lower)) return 0;
    if (/declaratie|performanta|dop/.test(lower)) return 1;
    return 2;
  };
  return [...new Set(links)].sort((a, b) => score(a) - score(b));
}

// ─── Storage & DB (aceleași convenții ca scrape_missing_fise.mjs) ───────────

async function downloadAndUploadPdf(pdfUrl, codIntern) {
  const resp = await fetchWithRetry(pdfUrl);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} la fetch PDF`);
  const contentType = resp.headers.get('content-type') || 'application/pdf';
  if (!contentType.includes('pdf') && !contentType.includes('octet-stream')) {
    throw new Error(`Răspuns non-PDF (${contentType})`);
  }
  const buffer = await resp.arrayBuffer();
  const originalName = pdfUrl.split('?')[0].split('/').pop() || `fisa_tehnica_${codIntern}.pdf`;
  const storagePath = `${codIntern}/${originalName}`;

  if (!DRY_RUN) {
    const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
      contentType: 'application/pdf',
      upsert: true,
    });
    if (error) throw new Error(`Upload Storage eșuat: ${error.message}`);
  }
  return storagePath;
}

async function saveResult({ codIntern, productUrl, pdfUrl, storagePath, status }) {
  if (DRY_RUN) return;
  if (codIntern && (pdfUrl || storagePath)) {
    const { error } = await supabase
      .from('products')
      .update({ fisa_tehnica_url: pdfUrl || null, fisa_tehnica_storage_path: storagePath || null })
      .eq('cod_intern', codIntern);
    if (error) console.error(`\n  ❌ Eroare update produs ${codIntern}: ${error.message}`);
  }
  if (productUrl) {
    await supabase.from('fise_tehnice_scrape_log').upsert(
      {
        product_url: productUrl,
        cod_intern: codIntern || null,
        fisa_tehnica_url: pdfUrl || null,
        storage_path: storagePath || null,
        scraped_at: new Date().toISOString(),
        status,
      },
      { onConflict: 'product_url' }
    );
  }
}

// ─── Procesare produs ────────────────────────────────────────────────────────

const stats = { found: 0, notFound: 0, lowConfidence: 0, errors: 0 };

async function processProduct(product, source) {
  const term = buildSearchTerm(product.denumire_completa, product.brand);
  if (!term) { stats.notFound++; return; }

  try {
    // 1. Căutare pe site-ul producătorului
    const searchUrl = source.searchUrl.replace('{q}', encodeURIComponent(term));
    await sleep(REQUEST_DELAY);
    const searchResp = await fetchWithRetry(searchUrl);
    if (!searchResp.ok) { stats.errors++; process.stdout.write('E'); return; }
    const searchHtml = await searchResp.text();

    // 2. Candidate: pagini de produs, ordonate după suprapunerea cu denumirea
    const candidates = [];
    let m;
    const re = new RegExp(source.productLinkPattern.source, source.productLinkPattern.flags);
    while ((m = re.exec(searchHtml)) !== null && candidates.length < 20) {
      let url = m[1];
      if (url.startsWith('/')) url = source.domain + url;
      candidates.push({ url, overlap: tokenOverlap(term, decodeURIComponent(url)) });
    }
    candidates.sort((a, b) => b.overlap - a.overlap);

    const best = candidates[0];
    if (!best || best.overlap < 0.4) {
      // Sub 40% suprapunere nu riscăm să atașăm fișa altui produs
      stats.lowConfidence++;
      process.stdout.write('·');
      return;
    }

    // 3. Extragere PDF din pagina de produs
    await sleep(REQUEST_DELAY);
    const pageResp = await fetchWithRetry(best.url);
    if (!pageResp.ok) { stats.errors++; process.stdout.write('E'); return; }
    const pdfLinks = extractPdfLinks(await pageResp.text(), source.domain);
    if (pdfLinks.length === 0) { stats.notFound++; process.stdout.write('·'); return; }

    // 4. Download + upload + save
    const pdfUrl = pdfLinks[0];
    let storagePath = null;
    try {
      storagePath = await downloadAndUploadPdf(pdfUrl, product.cod_intern);
    } catch (dlErr) {
      console.log(`\n  ⚠️  Download eșuat ${product.cod_intern}: ${dlErr.message}`);
    }
    await saveResult({
      codIntern: product.cod_intern,
      productUrl: best.url,
      pdfUrl,
      storagePath,
      status: 'found',
    });
    stats.found++;
    process.stdout.write('✓');
    if (DRY_RUN) {
      console.log(`\n  [DRY-RUN] ${product.cod_intern} "${product.denumire_completa}"`);
      console.log(`            pagină: ${best.url} (overlap ${(best.overlap * 100).toFixed(0)}%)`);
      console.log(`            PDF:    ${pdfUrl}`);
    }
  } catch (err) {
    stats.errors++;
    console.log(`\n  ❌ ${product.cod_intern}: ${err.message}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Produse fără fișă tehnică, grupate pe brand
  const { data: products, error } = await supabase
    .from('products')
    .select('cod_intern, denumire_completa, brand')
    .is('fisa_tehnica_url', null)
    .eq('is_active', true)
    .order('brand');
  if (error) { console.error('❌', error.message); process.exit(1); }

  const byBrand = new Map();
  for (const p of products || []) {
    const key = stripDiacritics(p.brand || 'necunoscut').trim();
    if (!byBrand.has(key)) byBrand.set(key, []);
    byBrand.get(key).push(p);
  }

  if (LIST_BRANDS) {
    console.log(`\n📊 ${products?.length ?? 0} produse fără fișă tehnică, pe branduri:\n`);
    const sorted = [...byBrand.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [brand, list] of sorted) {
      const configured = BRAND_SOURCES[brand] ? '✅ sursă configurată' : '—';
      console.log(`  ${String(list.length).padStart(5)}  ${brand}  ${configured}`);
    }
    console.log('\nAdaugă surse noi în BRAND_SOURCES pentru brandurile cu volum mare.');
    return;
  }

  const brandsToRun = ONLY_BRAND
    ? [ONLY_BRAND]
    : Object.keys(BRAND_SOURCES).filter((b) => byBrand.has(b));

  for (const brand of brandsToRun) {
    const source = BRAND_SOURCES[brand];
    if (!source) {
      console.log(`⚠️  Brandul "${brand}" nu are sursă configurată în BRAND_SOURCES — sari peste.`);
      continue;
    }
    let list = byBrand.get(brand) || [];
    if (TEST_LIMIT) list = list.slice(0, TEST_LIMIT);
    if (list.length === 0) { console.log(`— ${brand}: nimic de procesat`); continue; }

    console.log(`\n🏭 ${brand}: ${list.length} produse fără fișă${DRY_RUN ? ' [DRY-RUN]' : ''}`);
    for (const p of list) {
      await processProduct(p, source);
    }
  }

  console.log(`\n\n📊 Rezultate: ${stats.found} găsite, ${stats.lowConfidence} sub prag încredere, ${stats.notFound} fără PDF, ${stats.errors} erori`);
  if (stats.found > 0 && !DRY_RUN) {
    console.log('➡️  Rulează acum: node scraper/extract_specs_from_pdfs.mjs --skip-done');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
