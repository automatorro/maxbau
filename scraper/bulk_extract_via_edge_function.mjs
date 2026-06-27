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

const SUPABASE_URL    = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Eroare: Lipsește SUPABASE_URL sau SUPABASE_SERVICE_ROLE_KEY în .env!");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false }
});

async function main() {
  console.log("Citesc produsele neprocesate care au fișe tehnice în storage...");
  
  const { data: products, error } = await supabase
    .from('products')
    .select('id, cod_intern, denumire_completa, fisa_tehnica_storage_path')
    .not('fisa_tehnica_storage_path', 'is', null)
    .neq('fisa_tehnica_processed', true);

  if (error) {
    console.error("Eroare la citire produse:", error);
    process.exit(1);
  }

  console.log(`Am găsit ${products.length} produse gata pentru extragere specs.`);

  const edgeUrl = `${SUPABASE_URL}/functions/v1/extract-pdf-specs`;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    console.log(`[${i+1}/${products.length}] Procesez [${p.cod_intern}] ${p.denumire_completa}...`);

    try {
      const resp = await fetch(edgeUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ productId: p.id })
      });

      const resBody = await resp.json();

      if (resp.ok && resBody.success) {
        console.log(`   🟢 Succes! Specificații extrase.`);
      } else {
        console.error(`   🔴 Eroare: ${resBody.error || resp.statusText}`);
      }
    } catch (err) {
      console.error(`   🔴 Eroare rețea:`, err.message);
    }

    // Așteaptă 1.5 secunde între cereri pentru a nu depăși cota Gemini API
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log("Procesare în masă finalizată!");
}

main();
