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
const oldSupabase = createClient(OLD_SUPABASE_URL, OLD_SUPABASE_ANON_KEY);
const newSupabase = createClient(NEW_SUPABASE_URL, NEW_SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

// Mapare user_id-uri din baza veche în baza nouă
const userIdMap = {};
let adminNewId = null;

// Autentificare la baza veche pentru a trece de politicile RLS (Row-Level Security)
async function authenticateOldDb() {
  const email = process.env.OLD_ADMIN_EMAIL;
  const password = process.env.OLD_ADMIN_PASSWORD;

  if (email && password) {
    console.log(`🔑 Autentificare la baza de date veche ca admin (${email})...`);
    const { error: authError } = await oldSupabase.auth.signInWithPassword({
      email,
      password
    });
    if (authError) {
      console.warn("⚠️ Conectarea ca admin a eșuat, se încearcă înregistrarea unui cont temporar:", authError.message);
    } else {
      console.log("✅ Autentificare ca admin pe baza veche reușită!");
      return;
    }
  }

  console.log("🔑 Autentificare la baza de date veche ca utilizator temporar...");
  const tempEmail = `migration_${Date.now()}_${Math.random().toString(36).substring(2, 7)}@example.com`;
  const tempPassword = `P@ssw0rdMigration_Strong_${Math.random().toString(36).substring(2, 7)}!`;
  const { error: authError } = await oldSupabase.auth.signUp({
    email: tempEmail,
    password: tempPassword
  });
  if (authError) {
    console.warn("⚠️ Avertisment la autentificarea pe baza veche:", authError.message);
  } else {
    console.log("✅ Autentificare cu succes pe baza veche ca utilizator temporar:", tempEmail);
  }
}

async function buildUserIdMap() {
  console.log("🔍 Construire hartă de mapare utilizatori după email...");
  
  // Citim profilurile din baza veche
  const { data: oldProfiles, error: oldError } = await oldSupabase
    .from('profiles')
    .select('user_id, email');
    
  if (oldError) {
    console.warn("⚠️ Nu s-au putut citi profilurile din baza veche:", oldError.message);
    return;
  }
  
  // Citim profilurile din baza nouă
  const { data: newProfiles, error: newError } = await newSupabase
    .from('profiles')
    .select('user_id, email');
    
  if (newError) {
    console.warn("⚠️ Nu s-au putut citi profilurile din baza nouă:", newError.message);
    return;
  }
  
  if (!oldProfiles || !newProfiles) return;
  
  // Asociem email -> user_id nou
  const newEmailToId = {};
  for (const p of newProfiles) {
    if (p.email) {
      newEmailToId[p.email.toLowerCase().trim()] = p.user_id;
    }
  }
  
  // Determinăm adminNewId din noul profil
  const adminEmail = (process.env.OLD_ADMIN_EMAIL || '').toLowerCase().trim();
  adminNewId = newEmailToId[adminEmail] || newProfiles[0]?.user_id || null;
  console.log(`👤 Admin new user ID în baza nouă: ${adminNewId}`);
  
  // Mapăm user_id vechi -> user_id nou
  for (const p of oldProfiles) {
    if (p.email) {
      const emailNorm = p.email.toLowerCase().trim();
      const newId = newEmailToId[emailNorm];
      if (newId) {
        userIdMap[p.user_id] = newId;
        console.log(`🔗 Mapare user_id: ${p.user_id} -> ${newId} pentru email ${p.email}`);
      }
    }
  }
}

// Ordinea tabelelor pentru migrare (respectand constrangerile de chei straine - Foreign Keys)
const TABLES_TO_MIGRATE = [
  { name: 'categories', description: 'Categorii de produse' },
  { name: 'suppliers', description: 'Furnizori' },
  { name: 'products', description: 'Produse (si legaturile cu categoriile)' },
  { name: 'price_sheets', description: 'Liste de preturi furnizori' },
  { name: 'price_sheet_items', description: 'Articole liste de preturi' },
  { name: 'quotes', description: 'Oferte (quotes)' },
  { name: 'quote_items', description: 'Elemente oferte (quote_items)' },
  { name: 'echivalente_produse', description: 'Echivalente produse' },
  { name: 'retete_constructii', description: 'Rețete de construcții' },
  { name: 'product_prices', description: 'Prețuri produse' },
  { name: 'discount_rules', description: 'Reguli de discount' },
  { name: 'app_config', description: 'Configurari aplicatie' },
  { name: 'supplier_grile_pret', description: 'Grile de pret furnizori' }
];

async function migrateTable(tableName) {
  console.log(`\n--------------------------------------------------`);
  console.log(`📦 Incepe migrarea tabelei: ${tableName}...`);

  // 1. Citim datele din baza veche cu paginare (deoarece Supabase are limita implicita de 1000 randuri per query)
  let oldData = [];
  let page = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const start = page * pageSize;
    const end = start + pageSize - 1;
    const { data: chunk, error: readError } = await oldSupabase
      .from(tableName)
      .select('*')
      .range(start, end);

    if (readError) {
      if (readError.message.includes("Could not find the table") || readError.message.includes("does not exist")) {
        console.log(`ℹ️ Tabela veche '${tableName}' nu exista in baza sursa. O omitem.`);
        return true;
      }
      console.error(`❌ Eroare la citirea datelor din tabela veche '${tableName}':`, readError.message);
      return false;
    }

    if (!chunk || chunk.length === 0) {
      hasMore = false;
    } else {
      oldData = oldData.concat(chunk);
      if (chunk.length < pageSize) {
        hasMore = false;
      } else {
        page++;
      }
    }
  }

  if (oldData.length === 0) {
    console.log(`ℹ️ Tabela veche '${tableName}' nu contine date. Trecem mai departe.`);
    return true;
  }

  console.log(`📥 S-au citit ${oldData.length} inregistrari din baza veche.`);

  // 2. Curatam datele inainte de insert
  const cleanData = oldData.map(row => {
    const cleanRow = { ...row };
    
    // Daca migram echivalente_produse, setam null la creat_de pentru a evita constraint error cu auth.users
    if (tableName === 'echivalente_produse') {
      cleanRow.creat_de = null;
    }
    
    // Daca migram quotes, mapam user_id la cel nou sau adminNewId ca fallback
    if (tableName === 'quotes') {
      const oldId = cleanRow.user_id;
      const newId = userIdMap[oldId] || adminNewId;
      if (newId) {
        cleanRow.user_id = newId;
      } else {
        console.warn(`⚠️ Nu s-a găsit user_id asociat în noua bază pentru quote ${cleanRow.id}`);
      }
    }
    
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

  await authenticateOldDb();
  await buildUserIdMap();

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
