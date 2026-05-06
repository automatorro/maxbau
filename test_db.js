import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
});

const supabaseUrl = env['VITE_SUPABASE_URL'];
const supabaseKey = env['VITE_SUPABASE_PUBLISHABLE_KEY'];

const supabase = createClient(supabaseUrl, supabaseKey);

async function testInsert() {
  console.log('Testing insert...');
  const { data, error } = await supabase
    .from('products')
    .insert({
      cod_intern: 'TEST-123',
      denumire_completa: 'TEST PRODUCT',
      pret_lista: 10,
      grile_pret: { test_col: 'value' }
    })
    .select('id');
    
  if (error) {
    console.error('INSERT ERROR:', error);
  } else {
    console.log('INSERT SUCCESS:', data);
    await supabase.from('products').delete().eq('cod_intern', 'TEST-123');
  }
}

testInsert();
