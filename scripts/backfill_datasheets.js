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

async function backfill() {
  console.log('Fetching products missing fisa_tehnica_url...');
  
  let allProducts = [];
  let page = 0;
  const PAGE_SIZE = 1000;
  let keepFetching = true;

  while (keepFetching) {
    const { data, error } = await supabase
      .from('products')
      .select('id, specifications, fisa_tehnica_url')
      .is('fisa_tehnica_url', null)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) {
      console.error('Error fetching products:', error);
      return;
    }

    allProducts.push(...data);
    console.log(`Fetched page ${page + 1} (${data.length} products). Total missing: ${allProducts.length}`);
    
    if (data.length < PAGE_SIZE) {
      keepFetching = false;
    } else {
      page++;
    }
  }

  // Filter products that have a datasheet URL in specifications
  const toUpdate = [];
  allProducts.forEach(p => {
    const specs = p.specifications || {};
    const url = specs.datasheet_url || specs.fisa_tehnica_url;
    if (url) {
      toUpdate.push({
        id: p.id,
        fisa_tehnica_url: url
      });
    }
  });

  console.log(`Found ${toUpdate.length} products to backfill.`);

  if (toUpdate.length === 0) {
    console.log('No products need backfilling.');
    return;
  }

  // Update one by one in batches (concurrency of 20)
  const CONCURRENCY = 20;
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < toUpdate.length; i += CONCURRENCY) {
    const batch = toUpdate.slice(i, i + CONCURRENCY);
    
    await Promise.all(batch.map(async (item) => {
      const { error } = await supabase
        .from('products')
        .update({ fisa_tehnica_url: item.fisa_tehnica_url })
        .eq('id', item.id);
      
      if (error) {
        console.error(`Failed to update product ${item.id}:`, error.message);
        failCount++;
      } else {
        successCount++;
      }
    }));
    
    if (i % 100 === 0 || i + CONCURRENCY >= toUpdate.length) {
      console.log(`Progress: ${successCount + failCount}/${toUpdate.length} processed...`);
    }
  }

  console.log(`\nBackfill complete!`);
  console.log(`Successfully updated: ${successCount}`);
  console.log(`Failed: ${failCount}`);
}

backfill();
