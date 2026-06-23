# Proiect: Pipeline Fișe Tehnice → AI Consilier Tehnic de Înaltă Clasă (MaxBau)

Acest document reprezintă **caietul de sarcini complet, specificația tehnică de arhitectură și stadiul curent al proiectului**. A fost creat pentru a permite noului agent Antigravity de pe laptopul personal să preia contextul proiectului de la zero și să continue implementarea fără a pierde nicio informație.

---

## 1. Cerința Inițială & Nevoia Aplicației

Trebuie realizat un pipeline automatizat care face scraping pe site-ul public **maxbau.ro** în vederea descărcării tuturor fișelor tehnice ale fiecărui produs în parte. 

Pe pagina fiecărui produs (de ex. produse cu fișe tehnice PDF), se află o iconiță PDF pentru fișa tehnică, ce conține un link de forma:
`https://cdn.contentspeed.ro/maxbau.websales.ro/cs-content/cs-docs/Fisa_tehnica_Adeziv_pentru_polistiren_Optim_Dekor_Rinoterm_Adeplast_25kg-14266-1743495198.pdf`

Datele, PDF-urile descărcate și specificațiile tehnice extrase trebuie stocate și indexate în **Supabase** pentru a fi folosite de asistentul AI al aplicației.

---

## 2. Viziunea Finală

Un AI care cunoaște **din sursă primară** (fișele tehnice oficiale ale producătorilor) fiecare caracteristică a fiecărui produs — și poate face matching tehnic real, nu estimări sau ghicit. Clientul descrie nevoia, AI-ul caută în baza de date de fișe tehnice și propune produse care respectă exact specificațiile cerute.

---

## 3. Arhitectura Sistemului (3 Straturi)

```
┌─────────────────────────────────────────────────────────────┐
│  STRATUL 1: INGESTIE DATE                                   │
│  Scraper → Download PDF → Stocare Supabase Storage          │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  STRATUL 2: PROCESARE AI                                    │
│  Gemini extrage specs structurate → Embeddings vectoriale   │
│  Fiecare produs = JSON de caracteristici + vector semantic  │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  STRATUL 3: AI CONSULTANT ÎMBUNĂTĂȚIT                       │
│  Caută produse prin embeddings → Compară specs reale        │
│  Propune compatibilități, echivalențe și sisteme complete   │
└─────────────────────────────────────────────────────────────┘
```

---

### STRATUL 1: Ingestie date (Scraper + Download PDF)
* **Sursă date**: Citire `sitemap.xml` maxbau.ro pentru extragerea a ~4.400 de link-uri de produs.
* **Scraping**: Fetch-uirea fiecărei pagini de produs, identificarea link-urilor PDF prin regex.
* **Stocare PDF**: Descărcarea fișierelor PDF fizice în **Supabase Storage** (bucket-ul `fise-tehnice`).
* **Înregistrare**: Actualizarea tabelei `products` (`fisa_tehnica_url`, `fisa_tehnica_storage_path`) și logare în tabela dedicată `fise_tehnice_scrape_log`.

### STRATUL 2: Procesare AI (Extragere specificații + Embeddings)
* **Parser local**: Citirea PDF-ului din Supabase Storage și extragerea textului brut folosind `pdf-parse`.
* **Gemini AI**: Trimiterea textului extras din fișa tehnică la Gemini cu un prompt structurat pentru a obține specificații tehnice în format JSON curat:
  ```json
  {
    "conductivitate_termica": "0.032 W/mK",
    "densitate": "15-20 kg/m³",
    "clasa_reactie_foc": "E",
    "rezistenta_la_compresiune": "100 kPa",
    "utilizare": ["exterior", "termosistem EPS"],
    "compatibil_cu": ["adeziv pe baza de ciment", "dibluri mecanice"],
    "temperatura_aplicare": "+5°C ... +30°C",
    "timp_uscare": "24h",
    "consum": "4-6 kg/mp",
    "ambalaj": "sac 25 kg",
    "norma": "EN 13163",
    "producator": "Adeplast"
  }
  ```
* **Embeddings vectoriale**: Construirea unui text descriptiv din aceste specificații structurate și generarea unui vector 768D (folosind Gemini `text-embedding-004`).
* **Stocare vector**: Salvarea vectorilor în tabela `product_embeddings` (folosind extensia `pgvector` în Supabase) pentru căutări semantice rapide.

### STRATUL 3: AI Consultant Îmbunătățit (Edge Functions actualizate)
* **Căutare semantică**: Adăugarea unei funcții RPC `search_products_by_embedding` în baza de date.
* **Modificare Edge Functions (`ai-consultant`, `ai-find-equivalent`)**: Integrarea de tool calls în agentul AI pentru:
  1. Căutare după specificații reale (`search_products_by_specs`).
  2. Verificare compatibilități produse (`check_system_compatibility`).
  3. Căutare produse echivalente reale (`find_equivalent_products`).

---

## 4. Ce s-a realizat deja (Codul este în Proiect)

Toate elementele tehnice de mai jos au fost deja scrise și salvate în workspace:

1. **Scripturile de Scraping și Pipeline (în folderul `/scraper`):**
   * `scraper/scrape_fise_tehnice.mjs` — Scraper-ul complet care extrage URL-urile, detectează PDF-urile și le salvează în bucket-ul Supabase Storage. Suportă `--test N`, `--dry-run`, `--skip-done`.
   * `scraper/extract_specs_from_pdfs.mjs` — Scriptul care descarcă PDF-urile din Storage, citește textul și folosește Gemini AI pentru a popula specificațiile structurate ca JSON în tabela de produse.
   * `scraper/generate_embeddings.mjs` — Scriptul care generează vectorii semantici și îi salvează în `product_embeddings`.
   * `scraper/migrate_data.mjs` — **Script de migrare** creat pentru a copia toate datele existente (produse, categorii, reguli de discount, configurări) din baza veche Lovable în noul tău proiect Supabase.

2. **Configurarea Credențialelor noi:**
   * Am actualizat variabilele în `.env` cu credențialele noului tău proiect Supabase (`eklxkylfqlrkwoqtgpcw`).
   * Am actualizat fallback-urile din `src/integrations/supabase/client.ts`.
   * Am salvat vechile chei în `.env.backup` pentru siguranță și eventual rollback.

3. **Corectarea Migrărilor SQL local (în `supabase/migrations/`):**
   * Am rezolvat eroarea de duplicare pe tabela `echivalente_produse` din migrarea `20260504025448...sql`.
   * Am adăugat `CREATE EXTENSION IF NOT EXISTS http;` în migrarea `20260528110000...sql`.
   * Am adăugat crearea tabelei `public.app_config` în migrarea `20260606133253...sql`.

---

## 5. Ordinea Rulării pe laptopul personal (După `git pull`)

Deoarece pe laptopul personal ai deja Node.js instalat, pașii pentru a pune totul în funcțiune pe noul Supabase sunt următorii:

### Pasul A: Migrarea Structurii (SQL) în noul proiect Supabase
Rulează în **SQL Editor** în noul tău proiect Supabase Dashboard fișierele de migrare în următoarea ordine:
1. Toate fișierele din `supabase/migrations/` de la numărul `1` până la `10`.
2. Fișierul independent din rădăcina proiectului: **`migration_product_prices.sql`** (creează tabela `product_prices`).
3. Toate fișierele din `supabase/migrations/` de la numărul `13` până la `22` (care includ corecțiile noastre și migrarea de embeddings).

### Pasul B: Instalarea Dependențelor
Deschide terminalul pe laptopul personal în folderul proiectului și rulează:
```bash
npm install
npm install @supabase/supabase-js dotenv pdf-parse
```

### Pasul C: Migrarea Datelor din baza veche
Rulează scriptul pentru a umple noile tabele goale cu produsele și categoriile din baza Lovable:
```bash
node scraper/migrate_data.mjs
```
*(Verifică ca toate tabelele să raporteze `✅ SUCCES`)*

### Pasul D: Descărcarea Fișelor Tehnice (Scraping)
Descarcă PDF-urile în Supabase Storage (rulează mai întâi un test pe 20 de produse):
```bash
# Test
node scraper/scrape_fise_tehnice.mjs --test 20

# Rulare completă (durează câteva ore, folosește --skip-done dacă se întrerupe)
node scraper/scrape_fise_tehnice.mjs --skip-done
```

### Pasul E: Extragere Specs AI & Generare Embeddings
```bash
# Extragere specificații
node scraper/extract_specs_from_pdfs.mjs --test 10

# Generare vectori
node scraper/generate_embeddings.mjs --test 10
```

---

## 6. Planul de Verificare

### Automată
Rulează testele din scripturi cu flag-ul `--test` pentru a valida conexiunea la Supabase și la Gemini API.

### Manuală
1. Verifică în Supabase Storage că bucket-ul `fise-tehnice` este creat și conține fișierele PDF.
2. Verifică în tabela `products` că produsele au JSON-ul structurat în câmpul `specifications.fisa_tehnica_specs`.
3. Testează interogările semantice din bază utilizând asistentul AI actualizat din Edge Functions.
