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
const supabaseKey = env['SUPABASE_SERVICE_ROLE_KEY'] || env['VITE_SUPABASE_PUBLISHABLE_KEY'];
const supabase = createClient(supabaseUrl, supabaseKey);

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const GENERIC_WORDS = new Set([
  'pro', 'placa', 'gri', 'grey', 'rosu', 'red', 'mm', 'cm', 'kg', 'buc', 'sac', 'bax', 
  'palet', 'cu', 'si', 'de', 'la', 'pentru', 'tencuiala', 'decorative', 'amorsa', 
  'profil', 'tabla', 'grosime', 'uz', 'general', 'uzual', 'alcalina', 'clasa', 'pachet'
]);

// Helper to clean product names for search
function cleanSearchTerm(name) {
  if (!name) return '';
  let term = name.trim();
  
  // Remove quantities like "25kg", "25 kg", "400 kg", "5L", "10 l"
  term = term.replace(/\b\d+(?:\.\d+)?\s*(?:kg|l|ml|gr|g|buc|bax|sac|palet|mp|m|cm|mm)\b/gi, '');
  
  // Remove dimension expressions like "100 x 4000 x 0.5" or "100x4000x0.5"
  term = term.replace(/\b\d+(?:\.\d+)?\s*[xX\u00D7]\s*\d+(?:\.\d+)?(?:\s*[xX\u00D7]\s*\d+(?:\.\d+)?)?\s*(?:mm|cm|m)?\b/gi, '');
  
  // Remove words containing dashes and special characters that might fail the search
  term = term.replace(/[#@*()]/g, '');

  // Keep first 4-5 words to avoid overly restrictive search
  const words = term.split(/\s+/).filter(w => w.length > 1);
  return words.slice(0, 5).join(' ');
}

// Helper to calculate similarity score between two strings (word overlap)
function getWordOverlap(str1, str2) {
  const w1 = str1.toLowerCase().split(/[\s-]+/).filter(w => w.length > 2 && !GENERIC_WORDS.has(w));
  const w2 = new Set(str2.toLowerCase().split(/[\s-]+/).filter(w => w.length > 2 && !GENERIC_WORDS.has(w)));
  
  if (w1.length === 0) return { overlap: 0, ratio: 0, queryWordsCount: 0 };
  
  let intersection = 0;
  w1.forEach(w => {
    if (w2.has(w)) intersection++;
  });
  
  return {
    overlap: intersection,
    ratio: intersection / w1.length,
    queryWordsCount: w1.length
  };
}

async function discover() {
  const args = process.argv.slice(2);
  let limit = 5; // Default limit to 5 for safety during testing
  args.forEach(arg => {
    if (arg.startsWith('--limit=')) {
      const val = arg.split('=')[1];
      if (val === 'all') {
        limit = 10000;
      } else {
        limit = parseInt(val, 10);
      }
    }
  });

  console.log('Querying active products missing fisa_tehnica_url...');
  const { data: products, error: prodError } = await supabase
    .from('products')
    .select('id, cod_intern, denumire_completa, brand, brand_slug, fisa_tehnica_url')
    .eq('is_active', true)
    .is('fisa_tehnica_url', null);

  if (prodError) {
    console.error('Error fetching products:', prodError);
    return;
  }

  // Fetch existing scrape logs to skip already logged ones
  console.log('Fetching scrape logs...');
  const { data: logs, error: logError } = await supabase
    .from('fise_tehnice_scrape_log')
    .select('cod_intern, status');

  if (logError) {
    console.error('Error fetching logs:', logError);
    return;
  }

  const loggedCods = new Set(logs.map(l => l.cod_intern).filter(Boolean));

  // Filter products that have no log or whose logs didn't succeed
  const eligibleProducts = products.filter(p => !loggedCods.has(p.cod_intern));
  
  console.log(`Found ${eligibleProducts.length} eligible products without datasheet and log entry.`);
  
  const toProcess = eligibleProducts.slice(0, limit);
  console.log(`Processing limit: ${toProcess.length} products.`);

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };

  let foundCount = 0;
  let notFoundCount = 0;

  for (const product of toProcess) {
    const originalName = product.denumire_completa;
    const cleanName = cleanSearchTerm(originalName);
    const cod = product.cod_intern || `IMP-${product.id.slice(0, 8).toUpperCase()}`;

    console.log(`\n----------------------------------------`);
    console.log(`Product ID: ${product.id}`);
    console.log(`Original Name: "${originalName}" (${cod})`);
    console.log(`Clean Search Term: "${cleanName}"`);

    if (cleanName.length < 3) {
      console.log('Search term too short, skipping.');
      await supabase.from('fise_tehnice_scrape_log').insert({
        cod_intern: cod,
        product_url: `local://db-product/${product.id}`,
        status: 'not_found'
      });
      notFoundCount++;
      continue;
    }

    try {
      // 1. Query search on maxbau.ro
      const searchUrl = `https://maxbau.ro/index.php?route=product/search&search=${encodeURIComponent(cleanName)}`;
      const res = await fetch(searchUrl, { headers });
      
      if (!res.ok) {
        console.error(`Search request failed (HTTP ${res.status}).`);
        continue;
      }

      const html = await res.text();
      
      // 2. Extract product page URLs ending in -NNNNN.html
      const hrefPattern = /href="([^"]*-\d{5,}\.html)"/gi;
      let match;
      const seenUrls = new Set();
      const candidates = [];

      while ((match = hrefPattern.exec(html)) !== null) {
        let href = match[1];
        if (href.includes("wishlists") || href.includes("cart") || href.includes("index.php")) continue;
        const fullUrl = href.startsWith("http") ? href : `https://maxbau.ro/${href.replace(/^\//, "")}`;
        
        if (!seenUrls.has(fullUrl)) {
          seenUrls.add(fullUrl);
          
          // Try to deduce product name from slug
          const slug = fullUrl.split('/').pop().replace(/-1?\d{5,}\.html$/, '').replace(/-/g, ' ');
          const { overlap, ratio, queryWordsCount } = getWordOverlap(cleanName, slug);
          
          // Enforce strict criteria
          let isValid = false;
          if (queryWordsCount <= 1) {
            isValid = overlap >= 1 && ratio >= 0.9; // exact match for single-word queries
          } else {
            isValid = overlap >= 2 && ratio >= 0.5; // at least 2 matching words and >= 50% overlap ratio
          }
          
          if (isValid) {
            candidates.push({
              url: fullUrl,
              slug,
              overlap,
              ratio
            });
          }
        }
      }

      // Sort candidates by overlap score and then ratio
      candidates.sort((a, b) => b.overlap - a.overlap || b.ratio - a.ratio);

      if (candidates.length === 0) {
        console.log('No strictly matching products found in search results.');
        await supabase.from('fise_tehnice_scrape_log').insert({
          cod_intern: cod,
          product_url: `local://db-product/${product.id}`,
          status: 'not_found'
        });
        notFoundCount++;
        continue;
      }

      const bestMatch = candidates[0];
      console.log(`Best matching product URL found: ${bestMatch.url} (overlap: ${bestMatch.overlap}, ratio: ${(bestMatch.ratio * 100).toFixed(0)}%)`);

      // 3. Fetch product page
      await delay(1000); // polite delay
      const prodPageRes = await fetch(bestMatch.url, { headers });
      if (!prodPageRes.ok) {
        console.error(`Failed to fetch product page (HTTP ${prodPageRes.status}).`);
        continue;
      }

      const prodHtml = await prodPageRes.text();
      
      // 4. Extract PDF URL
      const pdfMatch = prodHtml.match(/href="([^"]+\.pdf(?:\?[^"]+)?)"/i) || 
                       prodHtml.match(/src="([^"]+\.pdf(?:\?[^"]+)?)"/i) ||
                       prodHtml.match(/https?:\/\/[^\s"'<>)]+\.pdf(?:\?[^\s"'<>)]+)?/i);

      if (pdfMatch) {
        let pdfUrl = pdfMatch[1] || pdfMatch[0];
        if (!pdfUrl.startsWith('http')) {
          pdfUrl = pdfUrl.startsWith('/') ? `https://maxbau.ro${pdfUrl}` : `https://maxbau.ro/${pdfUrl}`;
        }
        
        console.log(`🎉 Found datasheet PDF URL: ${pdfUrl}`);
        
        // 5. Update DB and log success
        const { error: dbError } = await supabase
          .from('products')
          .update({ fisa_tehnica_url: pdfUrl })
          .eq('id', product.id);

        if (dbError) {
          console.error('Failed to update product fisa_tehnica_url in DB:', dbError.message);
        } else {
          console.log('Successfully updated product in database.');
          
          await supabase.from('fise_tehnice_scrape_log').insert({
            cod_intern: cod,
            fisa_tehnica_url: pdfUrl,
            product_url: bestMatch.url,
            status: 'found'
          });
          foundCount++;
        }
      } else {
        console.log('Product page loaded successfully, but no PDF link was found.');
        await supabase.from('fise_tehnice_scrape_log').insert({
          cod_intern: cod,
          product_url: bestMatch.url,
          status: 'not_found'
        });
        notFoundCount++;
      }

    } catch (err) {
      console.error(`Error processing product:`, err.message || err);
    }
    
    // Polite delay between products
    await delay(1500);
  }

  console.log(`\n=== Discovery Job Summary ===`);
  console.log(`Processed: ${toProcess.length}`);
  console.log(`Datasheets found & updated: ${foundCount}`);
  console.log(`Not found: ${notFoundCount}`);
}

discover();
