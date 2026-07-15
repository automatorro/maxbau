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

const supabase = createClient(env['VITE_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);

async function run() {
  const { data } = await supabase
    .from('products')
    .select('fisa_tehnica_url, denumire_completa')
    .eq('cod_intern', '10400117')
    .single();

  console.log('Product:', data.denumire_completa);
  console.log('PDF URL:', data.fisa_tehnica_url);
  
  try {
    const res = await fetch(data.fisa_tehnica_url, { method: 'HEAD' });
    console.log('HTTP Status:', res.status);
    console.log('Content-Length:', res.headers.get('content-length'), 'bytes');
    console.log('Content-Type:', res.headers.get('content-type'));
  } catch (err) {
    console.error('Fetch failed:', err.message);
  }
}

run();
