import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load .env explicitly
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("LIPSESC VARIABILELE DE MEDIU SUPABASE!");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugSave() {
  console.log("Incepere test salvare in baza de date...");
  
  // Test insert exactly as in ImportOcr.tsx
  const cod = "TEST-OCR-" + Date.now();
  const denumire = "PRODUS TEST OCR";
  const pretLista = 99.99;
  const grile_pret = { cod_furnizor: "12345", cantitate_palet: "10" };
  
  console.log("Incercare INSERT produs:", { cod, denumire, pretLista, grile_pret });
  
  const { data, error } = await supabase
    .from("products")
    .insert({ 
      cod_intern: cod, 
      denumire_completa: denumire, 
      pret_lista: pretLista, 
      unit: null, 
      supplier_id: null, 
      grile_pret: grile_pret 
    })
    .select("id")
    .single();
    
  if (error) {
    console.error("EROARE LA INSERT:");
    console.error(JSON.stringify(error, null, 2));
    process.exit(1);
  }
  
  console.log("INSERT REUSIT! ID:", data.id);
  
  // Curatare test
  await supabase.from("products").delete().eq("id", data.id);
  console.log("Test curatat cu succes.");
}

debugSave();
