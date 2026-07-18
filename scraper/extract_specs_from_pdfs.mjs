/**
 * extract_specs_from_pdfs.mjs
 * ─────────────────────────────────────────────────────────────────
 * Pasul 2 din pipeline: extrage caracteristici tehnice structurate
 * din fișele tehnice PDF descărcate, folosind Gemini AI.
 *
 * Funcționare:
 *  1. Citește din fise_tehnice_scrape_log produsele cu status='found'
 *     și fisa_tehnica_processed=false
 *  2. Descarcă PDF-ul din Supabase Storage
 *  3. Extrage textul din PDF (folosind pdf-parse)
 *  4. Trimite textul la Gemini → returnează JSON structurat cu specs
 *  5. Salvează specs în products.specifications->fisa_tehnica_specs
 *  6. Marchează produsul ca procesat
 *
 * Rulare:
 *   node scraper/extract_specs_from_pdfs.mjs              # toate
 *   node scraper/extract_specs_from_pdfs.mjs --test 5     # primele 5
 *   node scraper/extract_specs_from_pdfs.mjs --dry-run    # fără scriere
 * ─────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Load .env ────────────────────────────────────────────────────────────────
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
  } catch { /* ok */ }
}
loadEnv();

const SUPABASE_URL    = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY  = process.env.GEMINI_API_KEY;
const BUCKET          = 'fise-tehnice';
const GEMINI_MODEL    = 'gemini-2.5-flash';

// ─── CLI flags ────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const testIdx    = args.indexOf('--test');
const TEST_LIMIT = testIdx >= 0 ? parseInt(args[testIdx + 1] || '5', 10) : null;
const FORCE      = args.includes('--force'); // reprocessează și cele deja extrase

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  SUPABASE_URL și SUPABASE_SERVICE_ROLE_KEY sunt necesare în .env');
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  console.error('❌  GEMINI_API_KEY este necesar în .env pentru extragerea specs AI');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ─── Statistici ───────────────────────────────────────────────────────────────
const stats = { total: 0, extracted: 0, noPdf: 0, errors: 0, cached: 0 };

// ─── Utilities ────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Extragere text din PDF ───────────────────────────────────────────────────

/**
 * Importăm pdf-parse dinamic (poate să nu fie instalat).
 * Dacă nu e disponibil, oferim instrucțiuni de instalare.
 */
async function extractTextFromPdfBuffer(buffer) {
  try {
    const m = await import('pdf-parse');
    if (m.PDFParse) {
      // Modern pdf-parse class-based API
      const parser = new m.PDFParse({ data: new Uint8Array(buffer) });
      const textResult = await parser.getText();
      await parser.destroy();
      return textResult.text || '';
    } else {
      // Traditional function-based API
      const pdfParse = m.default || m;
      if (typeof pdfParse !== 'function') {
        throw new Error('pdf-parse nu exportă o funcție validă');
      }
      const data = await pdfParse(Buffer.from(buffer));
      return data.text || '';
    }
  } catch (err) {
    throw new Error(`Eroare la parsarea PDF: ${err.message}`);
  }
}

// ─── Gemini: extragere specs structurate ─────────────────────────────────────

const SPECS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    densitate:                { type: 'STRING', description: 'ex: "15-20 kg/m³" sau null' },
    conductivitate_termica:   { type: 'STRING', description: 'λ în W/(m·K), ex: "0.032 W/mK" sau null' },
    rezistenta_compresiune:   { type: 'STRING', description: 'ex: "100 kPa" sau "CS(10)100" sau null' },
    rezistenta_tractiune:     { type: 'STRING', description: 'ex: "≥0.08 N/mm²" sau null' },
    clasa_reactie_foc:        { type: 'STRING', description: 'ex: "E", "B1", "A1" sau null' },
    temperatura_aplicare_min: { type: 'STRING', description: 'ex: "+5°C" sau null' },
    temperatura_aplicare_max: { type: 'STRING', description: 'ex: "+30°C" sau null' },
    timp_uscare:              { type: 'STRING', description: 'ex: "24h", "48h la 20°C" sau null' },
    timp_maturare:            { type: 'STRING', description: 'ex: "28 zile" sau null' },
    consum:                   { type: 'STRING', description: 'ex: "4-6 kg/m²" sau "1.5 L/m²" sau null' },
    ambalaj:                  { type: 'STRING', description: 'ex: "sac 25 kg", "bidon 5L" sau null' },
    grosime_strat:            { type: 'STRING', description: 'ex: "8-20 mm" sau null' },
    rezistenta_la_apa:        { type: 'STRING', description: 'ex: "W1", "impermeabil", "hidrofug" sau null' },
    utilizare:                {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'ex: ["exterior", "termosistem EPS", "interior"]'
    },
    compatibil_cu:            {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'materiale/suporturi compatibile, ex: ["BCA", "beton", "cărămidă"]'
    },
    incompatibil_cu:          {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'materiale/suporturi incompatibile sau restricții'
    },
    norma_standard:           {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'ex: ["EN 998-1", "SR EN 13163"]'
    },
    clasa_utilizare:          { type: 'STRING', description: 'ex: "C1", "C2T", "W1" sau null' },
    continut_co2:             { type: 'STRING', description: 'amprenta de carbon dacă e specificată, sau null' },
    producator:               { type: 'STRING', description: 'ex: "Adeplast", "Baumit" sau null' },
    serie_produs:             { type: 'STRING', description: 'ex: "Optim Dekor Rinoterm" sau null' },
    garantie:                 { type: 'STRING', description: 'ex: "10 ani" sau null' },
    tip_produs:               { type: 'STRING', description: 'Tipul normalizat al produsului, ex: "adeziv gresie/faianță", "adeziv polistiren", "vată bazaltică", "tencuială decorativă", "membrană bituminoasă"' },
    alte_specificatii:        {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          caracteristica: { type: 'STRING', description: 'numele caracteristicii, ex: "Absorbție de apă"' },
          valoare:        { type: 'STRING', description: 'valoarea, ex: "< 1 kg/m²"' },
          um:             { type: 'STRING', description: 'unitatea de măsură sau null' },
        },
        required: ['caracteristica', 'valoare'],
      },
      description: 'TOATE celelalte caracteristici tehnice explicite din fișă care NU se încadrează în câmpurile de mai sus — fiecare fișă e diferită, nu pierde nimic',
    },
    rezumat_tehnic:           { type: 'STRING', description: 'Rezumat de 2-3 fraze cu principalele caracteristici și utilizare' },
  },
  required: ['rezumat_tehnic', 'utilizare', 'compatibil_cu', 'tip_produs', 'alte_specificatii'],
};

/**
 * Calculează valori numerice normalizate din specs-urile string (determinist,
 * fără AI) — folosite de motorul de echivalare pentru comparații exacte.
 */
export function computeValoriNumerice(specs) {
  const parse = (raw, conservative = 'min') => {
    if (raw === null || raw === undefined) return null;
    let s = String(raw).toLowerCase().replace(/,/g, '.');
    const cs = s.match(/cs\s*\(\s*10\s*\)\s*(\d+(?:\.\d+)?)/);
    if (cs) return parseFloat(cs[1]);
    s = s.replace(/[≥≤><~±]/g, '');
    const range = s.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/);
    if (range) {
      const a = parseFloat(range[1]);
      const b = parseFloat(range[2]);
      return conservative === 'min' ? Math.min(a, b) : Math.max(a, b);
    }
    const single = s.match(/(\d+(?:\.\d+)?)/);
    return single ? parseFloat(single[1]) : null;
  };

  const out = {};
  const compresiune = parse(specs.rezistenta_compresiune, 'min');
  if (compresiune !== null) out.rezistenta_compresiune_kpa = compresiune;
  const lambda = parse(specs.conductivitate_termica, 'max');
  if (lambda !== null && lambda < 5) out.conductivitate_termica_w_mk = lambda;
  const densitate = parse(specs.densitate, 'min');
  if (densitate !== null) out.densitate_kg_m3 = densitate;
  const tractiune = parse(specs.rezistenta_tractiune, 'min');
  if (tractiune !== null) out.rezistenta_tractiune_n_mm2 = tractiune;
  return out;
}

async function extractSpecsWithGemini(pdfText, productName, codIntern) {
  const prompt = `Ești expert în materiale de construcții. Analizează EXCLUSIV textul fișei tehnice de mai jos și extrage caracteristicile tehnice în formatul JSON cerut.

PRODUS: ${productName} (cod: ${codIntern})

TEXT FIȘĂ TEHNICĂ:
${pdfText.slice(0, 12000)}

INSTRUCȚIUNI:
- Extrage DOAR date explicite din text, NU inventa nimic
- Dacă o caracteristică nu apare în text, pune null (pentru string) sau [] (pentru array)
- Pentru "utilizare": include tipul aplicației (interior/exterior) și suportul/sistemul recomandat
- Pentru "compatibil_cu": listează materialele de suport sau produsele din sistem cu care e compatibil
- "tip_produs": tipul normalizat, incluzând aplicația (ex: "adeziv gresie/faianță" NU doar "adeziv")
- "alte_specificatii": TOATE caracteristicile tehnice explicite care nu au câmp dedicat — fiecare
  fișă tehnică e diferită; nu omite nimic măsurabil (rezistențe, toleranțe, clase, absorbții etc.)
- "rezumat_tehnic": 2-3 fraze clare despre ce este produsul, unde se folosește și principalele avantaje`;

  // Retry pentru erori tranzitorii (fetch failed, 429 rate limit, 5xx).
  // 3 încercări cu backoff 2s → 4s → 8s. Erorile client (4xx altele) nu se reîncearcă.
  const RETRY_DELAYS_MS = [2000, 4000, 8000];
  let response;
  let lastErr;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: SPECS_SCHEMA,
              temperature: 0.1,
            },
          }),
        }
      );
      // Rate limit sau server error → retry
      if (response.status === 429 || response.status >= 500) {
        lastErr = new Error(`HTTP ${response.status}`);
      } else {
        break; // orice altceva (ok sau 4xx definitiv) iese din retry
      }
    } catch (err) {
      // fetch failed = eroare de rețea (DNS, TCP, TLS, timeout)
      lastErr = err;
    }
    if (attempt < RETRY_DELAYS_MS.length) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
  if (!response) throw lastErr ?? new Error('Gemini fetch failed');

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini nu a returnat text');

  return JSON.parse(text);
}

// ─── Core: procesare produs ───────────────────────────────────────────────────

async function processProduct(logRow) {
  const { cod_intern, fisa_tehnica_url, storage_path, product_url } = logRow;

  // Încearcă să găsim produsul în DB
  const { data: product } = await supabase
    .from('products')
    .select('id, denumire_completa, specifications')
    .eq('cod_intern', cod_intern)
    .maybeSingle();

  // Verifică dacă deja e procesat CU SCHEMA NOUĂ (tip_produs există doar în
  // extracțiile post-2026-07-17). Produsele cu schema veche se reprocesează
  // automat, fără --force — astfel rularea se poate relua oricând de unde a rămas.
  const existingSpecs = product?.specifications?.fisa_tehnica_specs;
  const hasNewSchema = existingSpecs && (existingSpecs.tip_produs !== undefined || existingSpecs._no_text);
  if (!FORCE && hasNewSchema) {
    stats.cached++;
    process.stdout.write('○');
    return;
  }

  let pdfText = '';

  // 1. Încearcă din Supabase Storage
  if (storage_path) {
    try {
      const { data: fileData, error } = await supabase.storage
        .from(BUCKET)
        .download(storage_path);

      if (!error && fileData) {
        const arrayBuffer = await fileData.arrayBuffer();
        pdfText = await extractTextFromPdfBuffer(arrayBuffer);
      }
    } catch (err) {
      console.log(`\n  ⚠️  Eroare citire Storage ${cod_intern}: ${err.message}`);
    }
  }

  // 2. Fallback: download direct din URL-ul CDN
  if (!pdfText && fisa_tehnica_url) {
    try {
      const resp = await fetch(fisa_tehnica_url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MaxbauBot/1.0)',
        },
      });
      if (resp.ok) {
        const buffer = await resp.arrayBuffer();
        pdfText = await extractTextFromPdfBuffer(buffer);
      }
    } catch (err) {
      console.log(`\n  ⚠️  Eroare download PDF ${cod_intern}: ${err.message}`);
    }
  }

  if (!pdfText || pdfText.trim().length < 50) {
    stats.noPdf++;
    process.stdout.write('░');

    // Chiar dacă nu avem text, salvăm specs minime bazate pe denumire
    if (product && fisa_tehnica_url && !DRY_RUN) {
      await supabase.from('products').update({
        fisa_tehnica_url,
        fisa_tehnica_processed: true,
        specifications: {
          ...(product.specifications || {}),
          fisa_tehnica_specs: { _no_text: true, _url: fisa_tehnica_url },
        },
      }).eq('cod_intern', cod_intern);
    }
    return;
  }

  // 3. Extrage specs cu Gemini
  const productName = product?.denumire_completa || cod_intern;
  let specs;
  try {
    specs = await extractSpecsWithGemini(pdfText, productName, cod_intern);
    specs._extracted_at = new Date().toISOString();
    specs._pdf_chars = pdfText.length;
    specs.valori_numerice = computeValoriNumerice(specs);
  } catch (err) {
    stats.errors++;
    console.log(`\n  ❌ Gemini eroare ${cod_intern}: ${err.message}`);
    process.stdout.write('E');
    return;
  }

  if (DRY_RUN) {
    console.log(`\n  [DRY-RUN] Specs extrase pentru ${cod_intern} (${productName}):`);
    console.log(JSON.stringify(specs, null, 2));
    stats.extracted++;
    process.stdout.write('✓');
    return;
  }

  // 4. Salvează în DB
  const newSpecifications = {
    ...(product?.specifications || {}),
    fisa_tehnica_specs: specs,
    datasheet_url: fisa_tehnica_url,
  };

  if (product) {
    await supabase.from('products').update({
      fisa_tehnica_url,
      fisa_tehnica_storage_path: storage_path || null,
      fisa_tehnica_processed: true,
      specifications: newSpecifications,
    }).eq('cod_intern', cod_intern);
  }

  // 5. Update log
  await supabase.from('fise_tehnice_scrape_log')
    .update({
      processed_at: new Date().toISOString(),
      status: 'specs_extracted',
    })
    .eq('product_url', product_url);

  stats.extracted++;
  process.stdout.write('✓');

  // Rate limit față de Gemini API
  await sleep(1200);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Maxbau.ro — Extragere Specs AI din Fișe Tehnice');
  console.log('═══════════════════════════════════════════════════════');
  if (DRY_RUN) console.log('⚠️   DRY-RUN: nu se scrie în DB');
  if (TEST_LIMIT) console.log(`🔬  TEST: se oprește după ${TEST_LIMIT} extracții reale`);
  if (FORCE) console.log('🔄  FORCE: reprocessează și produsele deja extrase');
  console.log('');

  // Fetch produse de procesat din log. Includem și 'specs_extracted': acele
  // produse pot avea schema VECHE de specs — processProduct() decide per produs
  // (sare doar ce are deja schema nouă, cu tip_produs).
  const { data: rows, error } = await supabase
    .from('fise_tehnice_scrape_log')
    .select('cod_intern, fisa_tehnica_url, storage_path, product_url, status')
    .in('status', ['found', 'specs_extracted'])
    .not('fisa_tehnica_url', 'is', null)
    .order('scraped_at', { ascending: true });

  if (error) {
    console.error('❌  Eroare la citire log:', error.message);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log('ℹ️   Nu există produse de procesat.');
    console.log('    Rulează mai întâi: node scraper/scrape_fise_tehnice.mjs');
    return;
  }

  stats.total = rows.length;
  console.log(`📄  ${stats.total} fișe tehnice de procesat`);
  console.log('Legendă: ✓=specs extrase  ○=deja procesat  ░=fără text PDF  E=eroare\n');

  const startTime = Date.now();

  for (const row of rows) {
    // --test N = oprește-te după N EXTRACȚII reale (nu N rânduri — primele
    // rânduri pot fi skip-uri ○, care nu spun nimic despre calitatea extracției)
    if (TEST_LIMIT && stats.extracted >= TEST_LIMIT) break;
    await processProduct(row);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n\n═══════════════════════════════════════════════════════');
  console.log('  REZULTATE FINALE');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Total procesate          : ${stats.total}`);
  console.log(`  Specs extrase cu succes  : ${stats.extracted}`);
  console.log(`  Deja procesate (cache)   : ${stats.cached}`);
  console.log(`  Fără text PDF            : ${stats.noPdf}`);
  console.log(`  Erori Gemini             : ${stats.errors}`);
  console.log(`  Timp total               : ${elapsed}s`);
  console.log('═══════════════════════════════════════════════════════');

  if (stats.extracted > 0 && !DRY_RUN) {
    console.log('\n✅  Pasul următor: actualizează consultantul AI cu datele noi!');
  }
}

main().catch(err => {
  console.error('\n💥  Eroare fatală:', err.message);
  process.exit(1);
});
