import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Incarcam variabilele de mediu din .env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const OLD_SUPABASE_URL = "https://rkzypnfumeusqxloapdb.supabase.co";
// Credentialele vechi ale bazei de date (din client.ts)
const OLD_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrenlwbmZ1bWV1c3F4bG9hcGRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMjAzNzksImV4cCI6MjA5MDg5NjM3OX0.FHbTpFqSt4GvLIylycHKjm8gxzgYn6_0FuAYsqQyGwI";

const NEW_SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://eklxkylfqlrkwoqtgpcw.supabase.co";
const NEW_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!NEW_SUPABASE_SERVICE_ROLE_KEY || NEW_SUPABASE_SERVICE_ROLE_KEY.includes("INLOCUIESTE")) {
  console.error("❌ EROARE: SUPABASE_SERVICE_ROLE_KEY nu este configurat in fisierul .env!");
  process.exit(1);
}

// Initializam clientii Supabase
// NOTA: Pentru baza veche, folosim anon key (are acces la select pe tabelele publice).
// Pentru baza noua, folosim SERVICE_ROLE_KEY pentru a trece de politicile de securitate (RLS) la insert.
const oldSupabase = createClient(OLD_SUPABASE_URL, OLD_SUPABASE_ANON_KEY);
const newSupabase = createClient(NEW_SUPABASE_URL, NEW_SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

// Ordinea tabelelor pentru migrare (respectand constrangerile de chei straine - Foreign Keys)
const TABLES_TO_MIGRATE = [
  { name: 'categories', description: 'Categorii de produse' },
  { name: 'products', description: 'Produse (si legaturile cu categoriile)' },
  { name: 'discount_rules', description: 'Reguli de discount' },
  { name: 'app_config', description: 'Configurari aplicatie' },
  { name: 'supplier_grile_pret', description: 'Grile de pret furnizori' }
];

async function migrateTable(tableName) {
  console.log(`\n--------------------------------------------------`);
  console.log(`📦 Incepe migrarea tabelei: ${tableName}...`);

  // 1. Citim datele din baza veche
  const { data: oldData, error: readError } = await oldSupabase
    .from(tableName)
    .select('*');

  if (readError) {
    console.error(`❌ Eroare la citirea datelor din tabela veche '${tableName}':`, readError.message);
    return false;
  }

  if (!oldData || oldData.length === 0) {
    console.log(`ℹ️ Tabela veche '${tableName}' nu contine date. Trecem mai departe.`);
    return true;
  }

  console.log(`📥 S-au citit ${oldData.length} inregistrari din baza veche.`);

  // 2. Pentru tabela products, eliminam campurile de search/embeddings daca exista (vor fi generate ulterior prin scraper)
  const cleanData = oldData.map(row => {
    const cleanRow = { ...row };
    // Daca noul format al bazei are constrangeri sau generam embeddings local, le putem lasa goale la inceput
    return cleanRow;
  });

  // 3. Introducem datele in baza noua (folosind upsert pentru a evita duplicatele)
  // Folosim bucati de 100 de inregistrari pentru a nu depasi limitele payload-ului
  const chunkSize = 100;
  let successfulInserts = 0;

  for (let i = 0; i < cleanData.length; i += chunkSize) {
    const chunk = cleanData.slice(i, i + chunkSize);
    const { error: writeError } = await newSupabase
      .from(tableName)
      .upsert(chunk, { onConflict: 'id' });

    if (writeError) {
      console.error(`❌ Eroare la scrierea chunk-ului in tabela noua '${tableName}':`, writeError.message);
      console.error(writeError);
      return false;
    }
    successfulInserts += chunk.length;
  }

  console.log(`✅ Tabela '${tableName}' a fost migrata cu succes! (${successfulInserts}/${oldData.length} randuri migrate)`);
  return true;
}

async function runMigration() {
  console.log("🚀 Pornire migrare date din baza veche Lovable in noua baza de date Supabase...");
  console.log(`Sursa: ${OLD_SUPABASE_URL}`);
  console.log(`Destinatie: ${NEW_SUPABASE_URL}`);

  const results = {};
  for (const table of TABLES_TO_MIGRATE) {
    const tableSuccess = await migrateTable(table.name);
    results[table.name] = tableSuccess ? "✅ SUCCES" : "❌ EȘUAT";
  }

  console.log("\n==================================================");
  console.log("📊 REZUMAT MIGRARE DATE:");
  Object.entries(results).forEach(([table, status]) => {
    console.log(`- Tabela '${table}': ${status}`);
  });
  console.log("==================================================");
  
  console.log("\nUrmătorii pași recomandați:");
  console.log("1. Rulează scraperul pentru descărcarea fișelor tehnice.");
  console.log("2. Generează embeddings pentru asistentul AI.");
}

runMigration().catch(err => {
  console.error("💥 Eroare neasteptata in timpul migrarii:", err);
});
