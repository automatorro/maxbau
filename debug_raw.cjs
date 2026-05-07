const fs = require('fs');
const path = require('path');
const https = require('https');

const envPath = path.resolve(process.cwd(), '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
});

const supabaseUrl = env['VITE_SUPABASE_URL'];
const supabaseKey = env['VITE_SUPABASE_PUBLISHABLE_KEY'];

const postData = JSON.stringify({
  cod_intern: 'TEST-OCR-' + Date.now(),
  denumire_completa: 'PRODUS TEST OCR',
  pret_lista: 99.99,
  unit: null,
  supplier_id: null,
  grile_pret: { cod_furnizor: "12345", cantitate_palet: "10" }
});

const url = new URL(supabaseUrl + '/rest/v1/products');

const options = {
  hostname: url.hostname,
  path: url.pathname + url.search,
  method: 'POST',
  headers: {
    'apikey': supabaseKey,
    'Authorization': 'Bearer ' + supabaseKey,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log('STATUS:', res.statusCode);
    console.log('RESPONSE:', data);
  });
});

req.on('error', (e) => {
  console.error('REQUEST ERROR:', e);
});

req.write(postData);
req.end();
