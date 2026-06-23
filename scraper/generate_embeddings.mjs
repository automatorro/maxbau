/**
 * generate_embeddings.mjs
 * ─────────────────────────────────────────────────────────────────
 * Pasul 3 din pipeline: generează embeddings vectoriale pentru
 * produsele cu specs extrase, pentru căutare semantică.
 *
 * Folosește Gemini text-embedding-004 (768 dimensiuni).
 *
 * Rulare:
 *   node scraper/generate_embeddings.mjs           # toate produsele cu specs
 *   node scraper/generate_embeddings.mjs --test 10
 *   node scraper/generate_embeddings.mjs --force   # regenerează toate
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
  } catch { /* ok */ }
}
loadEnv();

const SUPABASE_URL   = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!SUPABASE_URL || !SERVICE_KEY || !GEMINI_API_KEY) {
  console.error('❌  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY și GEMINI_API_KEY necesare');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const args       = process.argv.slice(2);
const FORCE      = args.includes('--force');
const testIdx    = args.indexOf('--test');
const TEST_LIMIT = testIdx >= 0 ? parseInt(args[testIdx + 1] || '10', 10) : null;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const stats = { total: 0, embedded: 0, skipped: 0, errors: 0 };

// ─── Construiește textul sursă pentru embedding ───────────────────────────────

function buildSpecsText(product) {
  const s = product.specifications?.fisa_tehnica_specs || {};
  const parts = [
    product.denumire_completa,
    product.brand ? `Brand: ${product.brand}` : null,

    s.rezumat_tehnic,

    s.utilizare?.length
      ? `Utilizare: ${s.utilizare.join(', ')}`
      : null,

    s.compatibil_cu?.length
      ? `Compatibil cu: ${s.compatibil_cu.join(', ')}`
      : null,

    s.incompatibil_cu?.length
      ? `Incompatibil cu: ${s.incompatibil_cu.join(', ')}`
      : null,

    s.conductivitate_termica
      ? `Conductivitate termică λ: ${s.conductivitate_termica}`
      : null,

    s.rezistenta_compresiune
      ? `Rezistență la compresiune: ${s.rezistenta_compresiune}`
      : null,

    s.clasa_reactie_foc
      ? `Clasă reacție foc: ${s.clasa_reactie_foc}`
      : null,

    s.consum ? `Consum: ${s.consum}` : null,
    s.ambalaj ? `Ambalaj: ${s.ambalaj}` : null,
    s.timp_uscare ? `Timp uscare: ${s.timp_uscare}` : null,
    s.temperatura_aplicare_min || s.temperatura_aplicare_max
      ? `Temperatură aplicare: ${s.temperatura_aplicare_min || ''} ... ${s.temperatura_aplicare_max || ''}`
      : null,

    s.norma_standard?.length
      ? `Norme: ${s.norma_standard.join(', ')}`
      : null,

    product.description ? `Descriere: ${product.description.slice(0, 500)}` : null,
  ].filter(Boolean);

  return parts.join('\n');
}

// ─── Gemini Embeddings API ────────────────────────────────────────────────────

async function generateEmbedding(text) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-embedding-2',
        content: { parts: [{ text: text.slice(0, 8000) }] },
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: 768
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini embedding error ${response.status}: ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.embedding?.values;
}

// ─── Core ─────────────────────────────────────────────────────────────────────

async function processProduct(product) {
  // Skip dacă deja are embedding și nu e --force
  if (!FORCE) {
    const { data: existing } = await supabase
      .from('product_embeddings')
      .select('id')
      .eq('product_id', product.id)
      .maybeSingle();

    if (existing) {
      stats.skipped++;
      process.stdout.write('○');
      return;
    }
  }

  const specsText = buildSpecsText(product);
  if (specsText.trim().length < 20) {
    stats.skipped++;
    process.stdout.write('·');
    return;
  }

  let embedding;
  try {
    embedding = await generateEmbedding(specsText);
  } catch (err) {
    stats.errors++;
    console.log(`\n  ❌ Embedding eroare ${product.cod_intern}: ${err.message}`);
    process.stdout.write('E');
    return;
  }

  const { error } = await supabase
    .from('product_embeddings')
    .upsert({
      product_id: product.id,
      embedding,
      specs_text: specsText,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'product_id' });

  if (error) {
    stats.errors++;
    console.log(`\n  ❌ DB eroare ${product.cod_intern}: ${error.message}`);
    process.stdout.write('E');
    return;
  }

  stats.embedded++;
  process.stdout.write('✓');

  // Rate limit Gemini: ~1500 RPM limita free tier
  await sleep(500);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Maxbau.ro — Generare Embeddings Vectoriale');
  console.log('═══════════════════════════════════════════════════════');
  if (FORCE) console.log('🔄  FORCE: regenerează toți vectorii');
  if (TEST_LIMIT) console.log(`🔬  TEST: primele ${TEST_LIMIT} produse`);
  console.log('');

  // Fetch produse cu specs extrase
  let query = supabase
    .from('products')
    .select('id, cod_intern, denumire_completa, brand, description, specifications')
    .eq('is_active', true)
    .eq('fisa_tehnica_processed', true)
    .not('specifications->fisa_tehnica_specs', 'is', null)
    .order('updated_at', { ascending: false });

  if (TEST_LIMIT) query = query.limit(TEST_LIMIT);

  const { data: products, error } = await query;

  if (error) {
    console.error('❌  Eroare:', error.message);
    process.exit(1);
  }

  if (!products?.length) {
    console.log('ℹ️   Nu există produse cu specs extrase.');
    console.log('    Rulează mai întâi: node scraper/extract_specs_from_pdfs.mjs');
    return;
  }

  stats.total = products.length;
  console.log(`🔢  ${stats.total} produse de vectorizat`);
  console.log('Legendă: ✓=embedding salvat  ○=deja există  ·=fără text  E=eroare\n');

  const startTime = Date.now();
  for (const product of products) {
    await processProduct(product);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n\n═══════════════════════════════════════════════════════');
  console.log('  REZULTATE');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Total                : ${stats.total}`);
  console.log(`  Embeddings generate  : ${stats.embedded}`);
  console.log(`  Deja existau (skip)  : ${stats.skipped}`);
  console.log(`  Erori                : ${stats.errors}`);
  console.log(`  Timp total           : ${elapsed}s`);
  console.log('═══════════════════════════════════════════════════════');

  if (stats.embedded > 0) {
    console.log('\n✅  Căutarea semantică este acum disponibilă!');
    console.log('   Consultantul AI poate găsi produse după caracteristici tehnice.');
  }
}

main().catch(err => {
  console.error('\n💥  Eroare fatală:', err.message);
  process.exit(1);
});
