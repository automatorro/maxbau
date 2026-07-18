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
// tip_produs = marker de schema NOUA (post-2026-07-17). Ne spune cate produse
// au deja specs utilizabile de motorul de echivalare cu bariere dure.
const { count: cuSchemaNoua } = await sb.from('products').select('*', { count: 'exact', head: true }).not('specifications->fisa_tehnica_specs->tip_produs', 'is', null);
// _no_text = PDF fara text extractibil; nu se poate face nimic mai mult
const { count: cuNoText } = await sb.from('products').select('*', { count: 'exact', head: true }).not('specifications->fisa_tehnica_specs->_no_text', 'is', null);

const cuSchemaVeche = Math.max(0, (cuSpecs || 0) - (cuSchemaNoua || 0) - (cuNoText || 0));

console.log(`Total produse:                     ${totalProduse}`);
console.log(`Cu fisa_tehnica_url:               ${cuFisaUrl}`);
console.log(`Cu fisa_tehnica_storage_path:      ${cuStoragePath}`);
console.log(`fisa_tehnica_processed = true:     ${procesate}`);
console.log(`Cu specs extrase (total):          ${cuSpecs}`);
console.log(`  ├─ schema NOUA (tip_produs)  :  ${cuSchemaNoua}`);
console.log(`  ├─ schema veche (de refacut) :  ${cuSchemaVeche}`);
console.log(`  └─ PDF fara text (_no_text)  :  ${cuNoText}`);
console.log(`FARA fisa tehnica (url null):      ${totalProduse - cuFisaUrl}`);
