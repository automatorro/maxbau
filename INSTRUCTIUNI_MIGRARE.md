# Status Migrare Bază de Date & Scraper MaxBau

Acest document conține contextul complet, statusul curent și instrucțiunile detaliate pentru continuarea lucrului de pe laptopul personal. A fost creat pentru ca noul agent Antigravity de pe laptopul personal să poată prelua instant contextul.

---

## 🎯 Obiectivul General
Mutarea bazei de date de pe instanța veche Supabase (gestionată de Lovable - `rkzypnfumeusqxloapdb`) pe noua instanță personală a clientului (`eklxkylfqlrkwoqtgpcw`), realizarea scraper-ului de fișe tehnice PDF, extragerea specificațiilor prin Gemini AI și generarea de embeddings vectoriale pentru asistentul tehnic AI.

---

## 🚀 Ce s-a realizat până acum
1. **Actualizare Credențiale în Proiect:**
   * Am înlocuit toate cheile de acces vechi cu cele noi în `.env` (pentru scraper), în `src/integrations/supabase/client.ts` (pentru aplicația web ca fallback) și în `supabase/config.toml` (pentru CLI).
   * Am salvat vechile credențiale în `.env.backup` în caz că este nevoie vreodată de un rollback rapid.
2. **Corectare & Pregătire Migrări SQL:**
   * Am identificat și rezolvat erorile din migrații:
     * În `20260504025448_fc2fa8ec...sql`: Am adăugat `DROP TABLE IF EXISTS public.echivalente_produse CASCADE;` pentru a preveni eroarea de relație existentă.
     * În `20260528110000_rpc_ai_product_info_http.sql`: Am adăugat `CREATE EXTENSION IF NOT EXISTS http;` pentru a activa extensia HTTP necesară tipului de date `http_response`.
     * În `20260606133253_4ca88281...sql`: Am adăugat definirea tabelei `public.app_config` și a regulilor RLS aferente, care lipseau din migrările oficiale.
3. **Script de Migrare Date:**
   * Am creat [`scraper/migrate_data.mjs`](file:///c:/Users/LucianCebuc/.gemini/antigravity/scratch/maxbau/scraper/migrate_data.mjs) care descarcă datele din baza veche și le încarcă automat în noua bază (respectând cheile străine).
4. **Scripturi Scraper & AI:**
   * `scraper/scrape_fise_tehnice.mjs` — Scraping sitemap maxbau, descărcare PDF în noul Supabase Storage bucket `fise-tehnice`.
   * `scraper/extract_specs_from_pdfs.mjs` — Extragere text PDF și generare JSON structurat cu specificații tehnice via Gemini AI.
   * `scraper/generate_embeddings.mjs` — Generare vectori 768D (Gemini text-embedding-004) și stocare în tabelul `product_embeddings` pentru căutare semantică.

---

## 📋 Status Migrări SQL
Toate cele 22 de migrări au fost corectate local. Ordinea completă de rulare pe noua bază de date este:
1. Migrările `1` până la `10` din `supabase/migrations/`
2. SQL-ul independent din rădăcină: **`migration_product_prices.sql`** (creează tabela `product_prices`)
3. Migrările `13` până la `22` din `supabase/migrations/` (ultima fiind `20260622190000_fise_tehnice_si_embeddings.sql` pe care am creat-o noi).

---

## 🏁 Pașii următori pe laptopul personal

1. **Rulează `git pull`** pentru a aduce toate modificările pe laptopul personal.
2. **Asigură-te că toate cele 22 de migrări SQL** (plus `migration_product_prices.sql`) au fost rulate cu succes pe noul tău proiect Supabase Dashboard.
3. **Rulează instalarea dependențelor** în terminal (deoarece ai deja Node.js pe laptopul personal):
   ```bash
   npm install
   npm install @supabase/supabase-js dotenv pdf-parse
   ```
4. **Mută datele din baza veche în cea nouă:**
   ```bash
   node scraper/migrate_data.mjs
   ```
   *(Verifică în terminal ca toate tabelele principale să raporteze `✅ SUCCES`)*.
5. **Rulează scraperul pentru a descărca fișele tehnice (test inițial pe 20 de produse):**
   ```bash
   node scraper/scrape_fise_tehnice.mjs --test 20
   ```
6. **Rulează extragerea de specificații cu Gemini:**
   ```bash
   node scraper/extract_specs_from_pdfs.mjs --test 5
   ```
7. **Rulează generarea de embeddings vectoriale pentru asistentul AI:**
   ```bash
   node scraper/generate_embeddings.mjs --test 5
   ```
