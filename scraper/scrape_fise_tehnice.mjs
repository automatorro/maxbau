/**
 * scrape_fise_tehnice.mjs
 * ─────────────────────────────────────────────────────────────────
 * Scraper fișe tehnice maxbau.ro → Supabase Storage
 *
 * Pași:
 *  1. Fetch sitemap.xml → extrage toate URL-urile de produs (.html)
 *  2. Filtrează produsele deja procesate (lookup în DB)
 *  3. Scraping paralel (concurență 3, delay 500ms/batch)
 *  4. Detectare link PDF fișă tehnică în pagina produsului
 *  5. Download PDF → upload în Supabase Storage (bucket: fise-tehnice)
 *  6. Update products.fisa_tehnica_url + fisa_tehnica_storage_path
 *  7. Insert în fise_tehnice_scrape_log
 *
 * Rulare:
 *   node scraper/scrape_fise_tehnice.mjs               # complet
 *   node scraper/scrape_fise_tehnice.mjs --test 20     # primele 20
 *   node scraper/scrape_fise_tehnice.mjs --dry-run     # fără scriere în DB
 *   node scraper/scrape_fise_tehnice.mjs --skip-done   # sare produsele deja procesate
 * ─────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ─── Config ───────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

// Citim .env manual (fără dependența de dotenv)
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
  } catch {
    // .env nu există — OK, folosim variabilele de mediu din sistem
  }
}
loadEnv();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌  SUPABASE_URL și SUPABASE_SERVICE_ROLE_KEY sunt necesare în .env');
  console.error('   Adaugă în .env:');
  console.error('   SUPABASE_SERVICE_ROLE_KEY=eyJ...');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ─── CLI flags ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN   = args.includes('--dry-run');
const SKIP_DONE = args.includes('--skip-done');
const testIdx   = args.indexOf('--test');
const TEST_LIMIT = testIdx >= 0 ? parseInt(args[testIdx + 1] || '10', 10) : null;

const CONCURRENCY  = 3;    // requesturi HTTP simultane
const BATCH_DELAY  = 600;  // ms între batch-uri
const REQUEST_DELAY = 300; // ms delay suplimentar per request
const SITEMAP_URL  = 'https://www.maxbau.ro/sitemap.xml';
const BUCKET       = 'fise-tehnice';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8',
};

// ─── Statistici globale ───────────────────────────────────────────────────────

const stats = {
  total: 0,
  skipped: 0,
  noDatasheet: 0,
  found: 0,
  downloaded: 0,
  errors: 0,
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function extractCodIntern(url) {
  const m = url.match(/-(\d{5,})\.html$/);
  return m ? m[1] : null;
}

/**
 * Caută link-uri PDF de fișă tehnică în HTML-ul paginii de produs.
 * Patterns acceptate:
 *   - cdn.contentspeed.ro/...  .pdf  (include "fisa" sau "tehnica" sau "ft")
 *   - Orice .pdf de pe domeniu CDN fără filtrare de cuvinte
 */
function extractPdfLinks(html) {
  const found = new Set();

  // Pattern 1: href-uri ce se termină cu .pdf (case-insensitive)
  const hrefRe = /href=["']([^"']*\.pdf(?:\?[^"']*)?)/gi;
  let m;
  while ((m = hrefRe.exec(html)) !== null) {
    const url = m[1].trim();
    if (url.includes('cdn.contentspeed.ro') || url.includes('maxbau')) {
      found.add(url);
    }
  }

  // Pattern 2: link-uri în src (uneori PDF-urile sunt în <object> sau <embed>)
  const srcRe = /src=["']([^"']*\.pdf(?:\?[^"']*)?)/gi;
  while ((m = srcRe.exec(html)) !== null) {
    const url = m[1].trim();
    if (url.includes('cdn.contentspeed.ro') || url.includes('maxbau')) {
      found.add(url);
    }
  }

  // Pattern 3: URL-uri absolute cu .pdf în text plat (pentru JSON embedded în HTML)
  const rawRe = /https?:\/\/cdn\.contentspeed\.ro\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]*)?/gi;
  while ((m = rawRe.exec(html)) !== null) {
    found.add(m[0]);
  }

  const all = [...found];

  // Prioritizează URLs care conțin 'fisa', 'tehnica', sau 'FT'
  const fisaTehnica = all.filter(u =>
    /fisa|tehnica|datasheet|ft[-_]/i.test(u)
  );
  return fisaTehnica.length > 0 ? fisaTehnica : all;
}

async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      const resp = await fetch(url, {
        ...options,
        headers: { ...BROWSER_HEADERS, ...(options.headers || {}) },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return resp;
    } catch (err) {
      if (i === retries - 1) throw err;
      await sleep(1000 * (i + 1));
    }
  }
}

// ─── Supabase Storage ─────────────────────────────────────────────────────────

async function ensureBucketExists() {
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some(b => b.name === BUCKET);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: 52428800, // 50MB
    });
    if (error) throw new Error(`Nu s-a putut crea bucket-ul '${BUCKET}': ${error.message}`);
    console.log(`✅  Bucket '${BUCKET}' creat.`);
  }
}

async function downloadAndUploadPdf(pdfUrl, codIntern) {
  const resp = await fetchWithRetry(pdfUrl);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} la fetch PDF: ${pdfUrl}`);

  const contentType = resp.headers.get('content-type') || 'application/pdf';
  if (!contentType.includes('pdf') && !contentType.includes('octet-stream')) {
    throw new Error(`Răspuns non-PDF (${contentType}) pentru: ${pdfUrl}`);
  }

  const buffer = await resp.arrayBuffer();

  // Extrage numele fișierului din URL
  const urlPath = pdfUrl.split('?')[0];
  const originalName = urlPath.split('/').pop() || `fisa_tehnica_${codIntern}.pdf`;
  const storagePath = `${codIntern}/${originalName}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) throw new Error(`Upload Storage eșuat: ${error.message}`);
  return storagePath;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function getAlreadyProcessed() {
  const { data } = await supabase
    .from('fise_tehnice_scrape_log')
    .select('product_url')
    .not('status', 'eq', 'error'); // re-procesăm erorile

  return new Set((data || []).map(r => r.product_url));
}

async function saveResult({ productUrl, codIntern, fisaTehnicaUrl, storagePath, status }) {
  if (DRY_RUN) return;

  // Update produsul dacă există
  if (codIntern && (fisaTehnicaUrl || storagePath)) {
    await supabase
      .from('products')
      .update({
        fisa_tehnica_url: fisaTehnicaUrl || null,
        fisa_tehnica_storage_path: storagePath || null,
      })
      .eq('cod_intern', codIntern);
  }

  // Log
  await supabase
    .from('fise_tehnice_scrape_log')
    .upsert({
      product_url: productUrl,
      cod_intern: codIntern || null,
      fisa_tehnica_url: fisaTehnicaUrl || null,
      storage_path: storagePath || null,
      scraped_at: new Date().toISOString(),
      status,
    }, { onConflict: 'product_url' });
}

// ─── Core: procesare pagină produs ───────────────────────────────────────────

async function processProduct(url) {
  const codIntern = extractCodIntern(url);

  try {
    await sleep(REQUEST_DELAY);
    const resp = await fetchWithRetry(url);

    if (!resp.ok) {
      stats.errors++;
      await saveResult({ productUrl: url, codIntern, status: 'error' });
      process.stdout.write('E');
      return;
    }

    const html = await resp.text();
    const pdfLinks = extractPdfLinks(html);

    if (pdfLinks.length === 0) {
      stats.noDatasheet++;
      await saveResult({ productUrl: url, codIntern, status: 'not_found' });
      process.stdout.write('·');
      return;
    }

    const pdfUrl = pdfLinks[0]; // ia prima (prioritar: fisa tehnica)
    stats.found++;

    let storagePath = null;

    try {
      storagePath = await downloadAndUploadPdf(pdfUrl, codIntern);
      stats.downloaded++;
      process.stdout.write('✓');
    } catch (dlErr) {
      // PDF găsit dar download eșuat — salvăm cel puțin URL-ul
      console.log(`\n  ⚠️  Download eșuat pentru ${codIntern}: ${dlErr.message}`);
      process.stdout.write('U'); // URL-only
    }

    await saveResult({
      productUrl: url,
      codIntern,
      fisaTehnicaUrl: pdfUrl,
      storagePath,
      status: 'found',
    });

  } catch (err) {
    stats.errors++;
    await saveResult({ productUrl: url, codIntern, status: 'error' });
    console.log(`\n  ❌ Eroare ${codIntern}: ${err.message}`);
    process.stdout.write('E');
  }
}

// ─── Batch runner cu concurență limitată ─────────────────────────────────────

async function runBatch(urls) {
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(url => processProduct(url)));
    if (i + CONCURRENCY < urls.length) await sleep(BATCH_DELAY);
  }
}

// ─── Fetch & parse sitemap ───────────────────────────────────────────────────

async function fetchProductUrls() {
  console.log('📥  Fetch sitemap...');
  const resp = await fetchWithRetry(SITEMAP_URL);
  if (!resp.ok) throw new Error(`Sitemap HTTP ${resp.status}`);

  const xml = await resp.text();

  // Extrage toate <loc>...</loc> care se termină cu .html
  const re = /<loc>(https?:\/\/[^<]+\.html)<\/loc>/gi;
  const urls = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    const url = m[1].trim();
    // Excludem paginile non-produs (articole, depozite etc.)
    if (!url.includes('/articole/') && !url.includes('/depozite')) {
      urls.push(url);
    }
  }

  // Deduplicate
  return [...new Set(urls)];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Maxbau.ro — Scraper Fișe Tehnice');
  console.log('═══════════════════════════════════════════════════════');

  if (DRY_RUN)    console.log('⚠️   DRY-RUN: nu se scrie în DB/Storage');
  if (TEST_LIMIT) console.log(`🔬  TEST: primele ${TEST_LIMIT} produse`);
  console.log(`📡  Supabase: ${SUPABASE_URL}`);
  console.log('');

  // Asigurăm existența bucket-ului
  if (!DRY_RUN) {
    console.log('🪣  Verificare bucket Supabase Storage...');
    await ensureBucketExists();
  }

  // Fetch sitemap
  let productUrls = await fetchProductUrls();
  console.log(`📋  ${productUrls.length} URL-uri de produs găsite în sitemap`);

  // Skip produse deja procesate
  if (SKIP_DONE) {
    const processed = await getAlreadyProcessed();
    const before = productUrls.length;
    productUrls = productUrls.filter(u => !processed.has(u));
    console.log(`⏭️   Sărite ${before - productUrls.length} produse deja procesate`);
  }

  // Limită test
  if (TEST_LIMIT) {
    productUrls = productUrls.slice(0, TEST_LIMIT);
  }

  stats.total = productUrls.length;
  console.log(`🚀  Procesăm ${stats.total} produse...\n`);
  console.log('Legendă: ✓=PDF salvat  U=URL only  ·=fără PDF  E=eroare\n');

  const startTime = Date.now();
  await runBatch(productUrls);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n\n═══════════════════════════════════════════════════════');
  console.log('  REZULTATE FINALE');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Total produse procesate : ${stats.total}`);
  console.log(`  Fișă tehnică găsită     : ${stats.found}`);
  console.log(`  PDF descărcat în Storage: ${stats.downloaded}`);
  console.log(`  Fără fișă tehnică       : ${stats.noDatasheet}`);
  console.log(`  Erori                   : ${stats.errors}`);
  console.log(`  Timp total              : ${elapsed}s`);
  console.log('═══════════════════════════════════════════════════════');

  if (stats.downloaded > 0 && !DRY_RUN) {
    console.log('\n✅  Pasul următor: rulează extragerea specs AI:');
    console.log('   node scraper/extract_specs_from_pdfs.mjs');
  }
}

main().catch(err => {
  console.error('\n💥  Eroare fatală:', err.message);
  process.exit(1);
});
