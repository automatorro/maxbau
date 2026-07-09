import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(resolve(__dirname, '../.env'), 'utf-8');
const get = (k) => env.match(new RegExp(k + '=(.+)'))?.[1]?.trim().replace(/['"]/g, '');

const sb = createClient(get('VITE_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));

// Total scrape log
const { count: totalLog } = await sb.from('fise_tehnice_scrape_log').select('*', { count: 'exact', head: true });
console.log('=== SCRAPE LOG — total inregistrari:', totalLog, '===\n');

// Statusuri distincte - fetch sample
const { data: sample } = await sb.from('fise_tehnice_scrape_log').select('status').limit(2000);
const statusMap = {};
for (const row of sample) {
  statusMap[row.status] = (statusMap[row.status] || 0) + 1;
}
console.log('Statusuri (din primele 2000 inregistrari):');
for (const [status, count] of Object.entries(statusMap).sort((a,b) => b[1]-a[1])) {
  console.log(`  ${status.padEnd(25)}: ${count}`);
}

console.log('\n=== PRODUSE ===');
const { count: totalProduse } = await sb.from('products').select('*', { count: 'exact', head: true });
const { count: cuFisaUrl } = await sb.from('products').select('*', { count: 'exact', head: true }).not('fisa_tehnica_url', 'is', null);
const { count: cuStoragePath } = await sb.from('products').select('*', { count: 'exact', head: true }).not('fisa_tehnica_storage_path', 'is', null);
const { count: procesate } = await sb.from('products').select('*', { count: 'exact', head: true }).eq('fisa_tehnica_processed', true);
const { count: cuSpecs } = await sb.from('products').select('*', { count: 'exact', head: true }).not('specifications->fisa_tehnica_specs', 'is', null);

console.log(`Total produse:                     ${totalProduse}`);
console.log(`Cu fisa_tehnica_url:               ${cuFisaUrl}`);
console.log(`Cu fisa_tehnica_storage_path:      ${cuStoragePath}`);
console.log(`fisa_tehnica_processed = true:     ${procesate}`);
console.log(`Cu specs extrase:                  ${cuSpecs}`);
console.log(`FARA fisa tehnica (url null):      ${totalProduse - cuFisaUrl}`);
