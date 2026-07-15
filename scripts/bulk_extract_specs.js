import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Read env file
const envContent = fs.readFileSync('./.env', 'utf-8');
const env = {};
envContent.split(/\r?\n/).forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    let val = match[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }
    env[match[1].trim()] = val;
  }
});

const supabaseUrl = env['VITE_SUPABASE_URL'];
const supabaseKey = env['VITE_SUPABASE_PUBLISHABLE_KEY'];
const email = env['OLD_ADMIN_EMAIL'];
const password = env['OLD_ADMIN_PASSWORD'];

const supabase = createClient(supabaseUrl, supabaseKey);

// Helper for delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Token refresh variables
let sessionToken = null;
let tokenExpiryTime = 0;

async function getSessionToken() {
  // If token is still valid for at least 5 minutes, reuse it
  if (sessionToken && Date.now() < tokenExpiryTime - 5 * 60 * 1000) {
    return sessionToken;
  }
  
  console.log(`\n[Auth] Authenticating/Refreshing session as admin (${email})...`);
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (authError) {
    throw new Error(`Authentication failed: ${authError.message}`);
  }

  sessionToken = authData.session.access_token;
  tokenExpiryTime = authData.session.expires_at * 1000;
  console.log(`[Auth] Session refreshed. Expiry: ${new Date(tokenExpiryTime).toISOString()}`);
  return sessionToken;
}

// Pre-flight PDF size check helper (returns size in bytes, or -1 if unknown/error)
async function getPdfSize(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (res.ok) {
      const len = res.headers.get('content-length');
      return len ? parseInt(len, 10) : -1;
    }
  } catch (err) {
    // Fallback: try GET with a range header or just fail silently
  }
  return -1;
}

async function main() {
  const args = process.argv.slice(2);
  let limit = null;
  args.forEach(arg => {
    if (arg.startsWith('--limit=')) {
      const val = arg.split('=')[1];
      if (val !== 'all') {
        limit = parseInt(val, 10);
      }
    }
  });

  // Initial authentication
  try {
    await getSessionToken();
  } catch (authErr) {
    console.error('Fatal Auth Error:', authErr.message);
    return;
  }

  console.log('\nQuerying products with unprocessed datasheets...');
  let query = supabase
    .from('products')
    .select('id, cod_intern, denumire_completa, fisa_tehnica_url, specifications')
    .eq('is_active', true)
    .not('fisa_tehnica_url', 'is', null)
    .eq('fisa_tehnica_processed', false);

  if (limit) {
    query = query.limit(limit);
    console.log(`Limit set to: ${limit}`);
  }

  const { data: products, error } = await query;

  if (error) {
    console.error('Error fetching products:', error);
    return;
  }

  console.log(`Found ${products.length} products to process.`);

  if (products.length === 0) {
    console.log('No products need processing.');
    return;
  }

  const CONCURRENCY = 2; // Process 2 PDFs in parallel
  const BATCH_DELAY_MS = 2500; // Wait 2.5 seconds between batches
  const MAX_PDF_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB Limit
  
  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < products.length; i += CONCURRENCY) {
    const batch = products.slice(i, i + CONCURRENCY);
    console.log(`\n--- Processing batch ${Math.floor(i / CONCURRENCY) + 1}/${Math.ceil(products.length / CONCURRENCY)} ---`);
    
    // Ensure token is fresh before starting the batch
    let currentToken;
    try {
      currentToken = await getSessionToken();
    } catch (authErr) {
      console.error('[Batch Auth Error] Skipping batch:', authErr.message);
      failCount += batch.length;
      continue;
    }

    await Promise.all(batch.map(async (product) => {
      const name = product.denumire_completa;
      const cod = product.cod_intern;
      const pdfUrl = product.fisa_tehnica_url;
      
      console.log(`[Start] Product: ${name} (${cod})`);
      
      // 1. Pre-flight PDF Size Check
      const sizeBytes = await getPdfSize(pdfUrl);
      if (sizeBytes > MAX_PDF_SIZE_BYTES) {
        const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(1);
        console.warn(`[Skip] Product: ${name} (${cod}) - PDF size too large (${sizeMb} MB). Skipping and marking processed.`);
        
        // Update database to mark processed with size error to prevent infinite retries
        const currentSpecs = product.specifications || {};
        const newSpecs = {
          ...currentSpecs,
          fisa_tehnica_specs: {
            _error: 'file_too_large',
            _size_bytes: sizeBytes,
            _skipped_at: new Date().toISOString()
          }
        };
        
        const { error: updateErr } = await supabase
          .from('products')
          .update({
            specifications: newSpecs,
            fisa_tehnica_processed: true
          })
          .eq('id', product.id);

        if (updateErr) {
          console.error(`  [DB Error] Failed to update skipped status for ${product.id}:`, updateErr.message);
        }
        
        skippedCount++;
        return;
      }

      // 2. Invoke Edge Function
      try {
        const startTime = Date.now();
        const funcUrl = `${supabaseUrl}/functions/v1/extract-pdf-specs`;
        const res = await fetch(funcUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentToken}`
          },
          body: JSON.stringify({ productId: product.id })
        });
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);

        if (!res.ok) {
          const errMsg = await res.text();
          console.error(`[Error] Product: ${name} (${cod}) failed in ${duration}s (HTTP ${res.status}). Reason:`, errMsg);
          failCount++;
        } else {
          const resJson = await res.json();
          if (resJson.error) {
            console.error(`[Error] Product: ${name} (${cod}) failed in ${duration}s. Reason:`, resJson.error);
            failCount++;
          } else {
            console.log(`[Success] Product: ${name} (${cod}) processed in ${duration}s.`);
            successCount++;
          }
        }
      } catch (err) {
        console.error(`[Exception] Product: ${name} (${cod}) failed:`, err.message || err);
        failCount++;
      }
    }));

    if (i + CONCURRENCY < products.length) {
      console.log(`Waiting ${BATCH_DELAY_MS / 1000}s before next batch...`);
      await delay(BATCH_DELAY_MS);
    }
  }

  console.log(`\n=== Extraction Job Summary ===`);
  console.log(`Total attempted: ${products.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Skipped (File too large): ${skippedCount}`);
  console.log(`Failed: ${failCount}`);
}

main();
