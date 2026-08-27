/**
 * scrape_missing_fise.mjs
 * ─────────────────────────────────────────────────────────────────
 * Recovery scraper for missing technical data sheets on maxbau.ro
 * 
 * Works by:
 *  1. Querying target products from the database where fisa_tehnica_url is null
 *  2. Mapping known product URLs from fise_tehnice_scrape_log
 *  3. For unmapped products, searching maxbau.ro for their internal code to find the page URL
 *  4. Scraping the resolved product page HTML to extract PDF links
 *  5. Downloading & uploading PDFs to Supabase Storage
 *  6. Updating the products table and the scrape log
 * ─────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ─── Config & Env ────────────────────────────────────────────────────────────

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
  } catch {
    // Fail silently - system envs will be used
  }
}
loadEnv();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌  SUPABASE_URL și SUPABASE_SERVICE_ROLE_KEY sunt necesare în .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ─── CLI flags ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const testIdx = args.indexOf('--test');
const TEST_LIMIT = testIdx >= 0 ? parseInt(args[testIdx + 1] || '10', 10) : null;

const CONCURRENCY = 3;
const BATCH_DELAY = 600;
const REQUEST_DELAY = 300;
const BUCKET = 'fise-tehnice';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8',
};

// ─── Stats ────────────────────────────────────────────────────────────────────

const stats = {
  total: 0,
  resolvedUrlFromSearch: 0,
  searchNotFound: 0,
  pdfFound: 0,
  pdfDownloaded: 0,
  noPdfFound: 0,
  errors: 0,
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
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

function extractPdfLinks(html) {
  const found = new Set();

  const hrefRe = /href=["']([^"']*\.pdf(?:\?[^"']*)?)/gi;
  let m;
  while ((m = hrefRe.exec(html)) !== null) {
    let url = m[1].trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      if (url.startsWith('/')) url = 'https://www.maxbau.ro' + url;
      else url = 'https://www.maxbau.ro/' + url;
    }
    if (url.includes('cdn.contentspeed.ro') || url.includes('maxbau')) {
      found.add(url);
    }
  }

  const srcRe = /src=["']([^"']*\.pdf(?:\?[^"']*)?)/gi;
  while ((m = srcRe.exec(html)) !== null) {
    let url = m[1].trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      if (url.startsWith('/')) url = 'https://www.maxbau.ro' + url;
      else url = 'https://www.maxbau.ro/' + url;
    }
    if (url.includes('cdn.contentspeed.ro') || url.includes('maxbau')) {
      found.add(url);
    }
  }

  const rawRe = /https?:\/\/(?:cdn\.contentspeed\.ro|www\.maxbau\.ro)\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]*)?/gi;
  while ((m = rawRe.exec(html)) !== null) {
    found.add(m[0]);
  }

  const all = [...found];
  const fisaTehnica = all.filter(u => /fisa|tehnica|datasheet|ft[-_]/i.test(u));
  return fisaTehnica.length > 0 ? fisaTehnica : all;
}

// ─── Search maxbau.ro for product URL ──────────────────────────────────────────

async function resolveProductUrlFromSearch(codIntern) {
  const searchUrl = `https://www.maxbau.ro/index.php?page=search&action=products&query=${codIntern}`;
  try {
    await sleep(REQUEST_DELAY);
    const resp = await fetchWithRetry(searchUrl);
    if (!resp.ok) return null;
    const html = await resp.text();

    const regex = new RegExp(`href=["']([^"']*-${codIntern}\\.html)["']`, 'i');
    const match = html.match(regex);
    if (match) {
      let productUrl = match[1];
      if (!productUrl.startsWith('http')) {
        if (productUrl.startsWith('/')) productUrl = 'https://www.maxbau.ro' + productUrl;
        else productUrl = 'https://www.maxbau.ro/' + productUrl;
      }
      return productUrl;
    }
  } catch (e) {
    console.error(`\n  ⚠️  Eroare căutare cod ${codIntern}: ${e.message}`);
  }
  return null;
}

// ─── PDF Storage & DB helpers ────────────────────────────────────────────────

async function downloadAndUploadPdf(pdfUrl, codIntern) {
  const resp = await fetchWithRetry(pdfUrl);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} la fetch PDF: ${pdfUrl}`);

  const contentType = resp.headers.get('content-type') || 'application/pdf';
  if (!contentType.includes('pdf') && !contentType.includes('octet-stream')) {
    throw new Error(`Răspuns non-PDF (${contentType}) pentru: ${pdfUrl}`);
  }

  const buffer = await resp.arrayBuffer();
  const urlPath = pdfUrl.split('?')[0];
  const originalName = urlPath.split('/').pop() || `fisa_tehnica_${codIntern}.pdf`;
  const storagePath = `${codIntern}/${originalName}`;

  if (!DRY_RUN) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: 'application/pdf',
        upsert: true,
      });
    if (error) throw new Error(`Upload Storage eșuat: ${error.message}`);
  }
  return storagePath;
}

async function saveResult({ productUrl, codIntern, fisaTehnicaUrl, storagePath, status }) {
  if (DRY_RUN) return;

  // Actualizare produs
  if (codIntern && (fisaTehnicaUrl || storagePath)) {
    const { error } = await supabase
      .from('products')
      .update({
        fisa_tehnica_url: fisaTehnicaUrl || null,
        fisa_tehnica_storage_path: storagePath || null,
      })
      .eq('cod_intern', codIntern);
    
    if (error) console.error(`\n  ❌ Eroare salvare DB produs ${codIntern}:`, error.message);
  }

  // Log in scrape log (dacă avem un productUrl)
  if (productUrl) {
    const { error } = await supabase
      .from('fise_tehnice_scrape_log')
      .upsert({
        product_url: productUrl,
        cod_intern: codIntern || null,
        fisa_tehnica_url: fisaTehnicaUrl || null,
        storage_path: storagePath || null,
        scraped_at: new Date().toISOString(),
        status,
      }, { onConflict: 'product_url' });
      
    if (error) console.error(`\n  ❌ Eroare scriere log ${codIntern}:`, error.message);
  }
}

// ─── Core Product Processor ──────────────────────────────────────────────────

async function processProduct(product, logUrl) {
  const codIntern = product.cod_intern;
  let productUrl = logUrl;

  try {
    // 1. Resolve URL from search if missing
    if (!productUrl) {
      productUrl = await resolveProductUrlFromSearch(codIntern);
      if (!productUrl) {
        stats.searchNotFound++;
        // Log dummy URL to cache the search failure
        const dummyUrl = `https://www.maxbau.ro/not_found/${codIntern}`;
        await saveResult({ productUrl: dummyUrl, codIntern, status: 'not_found' });
        process.stdout.write('S'); // Search not found
        return;
      }
      stats.resolvedUrlFromSearch++;
    }

    // 2. Fetch page and find PDFs
    await sleep(REQUEST_DELAY);
    const resp = await fetchWithRetry(productUrl);
    if (!resp.ok) {
      stats.errors++;
      await saveResult({ productUrl, codIntern, status: 'error' });
      process.stdout.write('E');
      return;
    }

    const html = await resp.text();
    const pdfLinks = extractPdfLinks(html);

    if (pdfLinks.length === 0) {
      stats.noPdfFound++;
      await saveResult({ productUrl, codIntern, status: 'not_found' });
      process.stdout.write('·'); // No PDF
      return;
    }

    // 3. Download & upload first PDF
    const pdfUrl = pdfLinks[0];
    stats.pdfFound++;

    let storagePath = null;
    try {
      storagePath = await downloadAndUploadPdf(pdfUrl, codIntern);
      stats.pdfDownloaded++;
      process.stdout.write('✓'); // Success
    } catch (dlErr) {
      console.log(`\n  ⚠️  Download eșuat pentru ${codIntern}: ${dlErr.message}`);
      process.stdout.write('U'); // URL only
    }

    await saveResult({
      productUrl,
      codIntern,
      fisaTehnicaUrl: pdfUrl,
      storagePath,
      status: 'found',
    });

  } catch (err) {
    stats.errors++;
    console.log(`\n  ❌ Eroare totală ${codIntern}: ${err.message}`);
    process.stdout.write('E');
    if (productUrl) {
      await saveResult({ productUrl, codIntern, status: 'error' });
    }
  }
}

// ─── Runner ──────────────────────────────────────────────────────────────────

async function runBatch(products, logMap) {
  for (let i = 0; i < products.length; i += CONCURRENCY) {
    const batch = products.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(p => processProduct(p, logMap.get(p.cod_intern))));
    if (i + CONCURRENCY < products.length) await sleep(BATCH_DELAY);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Catalog Engine — Recuperare Fișe Tehnice Lipsă');
  console.log('═══════════════════════════════════════════════════════');

  if (DRY_RUN) console.log('⚠️   DRY-RUN: Fără scriere în DB/Storage');
  if (TEST_LIMIT) console.log(`🔬  TEST: Limitare la primele ${TEST_LIMIT} produse`);
  console.log(`📡  Supabase: ${SUPABASE_URL}\n`);

  // 1. Fetch target products from DB
  console.log('🔍  Selectare produse lipsă din DB...');
  const { data: dbProds, error } = await supabase
    .from('products')
    .select('id, cod_intern, denumire_completa')
    .is('fisa_tehnica_url', null);

  if (error) {
    console.error('❌  Eroare selectare produse:', error.message);
    process.exit(1);
  }

  // Filtrare coduri temporare OCR/IMP
  let targets = (dbProds || []).filter(
    p => p.cod_intern && !p.cod_intern.startsWith('OCR-') && !p.cod_intern.startsWith('IMP-')
  );

  console.log(`📋  Găsite ${targets.length} produse eligibile (fără fișă tehnică) în DB.`);

  if (targets.length === 0) {
    console.log('🎉  Toate produsele au deja fișă tehnică!');
    process.exit(0);
  }

  // 2. Fetch known URLs from scrape log
  console.log('🗂️   Mapare URL-uri deja cunoscute din log...');
  const { data: logData, error: logError } = await supabase
    .from('fise_tehnice_scrape_log')
    .select('cod_intern, product_url')
    .not('product_url', 'is', null);

  if (logError) {
    console.error('⚠️   Nu s-a putut citi log-ul pentru mapare (va căuta toate produsele):', logError.message);
  }

  const logMap = new Map((logData || []).map(r => [r.cod_intern, r.product_url]));
  console.log(`    Mapped ${logMap.size} URL-uri existente.\n`);

  // Limitare test
  if (TEST_LIMIT) {
    // Încercăm să alegem un mix de produse care au/nu au URL-uri mapate pentru a testa ambele scenarii
    const withUrl = targets.filter(p => logMap.has(p.cod_intern));
    const withoutUrl = targets.filter(p => !logMap.has(p.cod_intern));
    targets = [
      ...withUrl.slice(0, Math.ceil(TEST_LIMIT / 2)),
      ...withoutUrl.slice(0, Math.floor(TEST_LIMIT / 2))
    ].slice(0, TEST_LIMIT);
  }

  stats.total = targets.length;
  console.log(`🚀  Procesăm ${stats.total} produse...`);
  console.log('Legendă: ✓=PDF salvat  U=URL selectat  ·=fără PDF  S=Negăsit la căutare  E=eroare\n');

  const startTime = Date.now();
  await runBatch(targets, logMap);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n\n═══════════════════════════════════════════════════════');
  console.log('  REZULTATE FINALE');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Total produse procesate      : ${stats.total}`);
  console.log(`  URL-uri noi prin căutare     : ${stats.resolvedUrlFromSearch}`);
  console.log(`  Produse negăsite la căutare  : ${stats.searchNotFound}`);
  console.log(`  Fișe tehnice PDF găsite      : ${stats.pdfFound}`);
  console.log(`  PDF-uri descărcate în Storage: ${stats.pdfDownloaded}`);
  console.log(`  Fără fișă tehnică în pagină  : ${stats.noPdfFound}`);
  console.log(`  Erori                        : ${stats.errors}`);
  console.log(`  Timp total                   : ${elapsed}s`);
  console.log('═══════════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('\n💥  Eroare fatală:', err.message);
  process.exit(1);
});
