const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf8');
const supabaseUrl = env.match(/VITE_SUPABASE_URL="(.*)"/)[1];
const supabaseKey = env.match(/VITE_SUPABASE_PUBLISHABLE_KEY="(.*)"/)[1];
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data: recipes } = await supabase.from('retete_constructii').select('*').ilike('recipe_name', '%Termosistem%');
  console.log('Recipes:', JSON.stringify(recipes, null, 2));

  const { data: products1 } = await supabase.from('products').select('*').ilike('denumire_completa', '%DuoContact%');
  console.log('Products DuoContact:', JSON.stringify(products1, null, 2));

  const { data: products2 } = await supabase.from('products').select('*').ilike('denumire_completa', '%GranoporTop%');
  console.log('Products GranoporTop:', JSON.stringify(products2, null, 2));

  const { data: products3 } = await supabase.from('products').select('*').ilike('denumire_completa', '%colt PVC%');
  console.log('Products Colt PVC:', JSON.stringify(products3, null, 2));
  
  const { data: products4 } = await supabase.from('products').select('*').ilike('denumire_completa', '%soclu aluminiu%');
  console.log('Products Soclu:', JSON.stringify(products4, null, 2));
}

run();
