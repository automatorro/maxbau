# Scraper Fișe Tehnice Maxbau.ro

Pipeline complet: **Scraping PDF → Extragere specs AI → Embeddings vectoriale**

---

## Setup (o singură dată)

### 1. Adaugă cheile în `.env`

```env
SUPABASE_SERVICE_ROLE_KEY="eyJ..."   # din Supabase Dashboard → Settings → API
GEMINI_API_KEY="AIza..."             # din https://aistudio.google.com/app/apikey
```

### 2. Instalează dependența pdf-parse și dotenv

Poți folosi Node.js sau Bun:
```bash
# Dacă folosești Node.js:
npm install pdf-parse dotenv

# Dacă folosești Bun:
bun add pdf-parse dotenv
```

### 3. Migrarea structurii (SQL) în noul Supabase

Rulează în **SQL Editor** din Supabase Dashboard toate cele 22 de fișiere de migrare din folderul `supabase/migrations/` în ordine cronologică. 

De asemenea, poți folosi Supabase CLI dacă îl ai instalat:
```bash
npx supabase db push
```

### 4. Migrarea datelor din baza de date veche Lovable
Dacă dorești să muți produsele, categoriile, regulile de discount și configurările existente în noul tău proiect Supabase, rulează scriptul de migrare:
```bash
# Cu Node.js:
node scraper/migrate_data.mjs

# Cu Bun:
bun scraper/migrate_data.mjs
```

---

## Rulare pipeline

### Pasul 1 — Scraping fișe tehnice (2-4 ore)

```bash
# Test pe 20 produse înainte de rulare completă
node scraper/scrape_fise_tehnice.mjs --test 20

# Rulare completă (~4.400 produse)
node scraper/scrape_fise_tehnice.mjs

# Reluare după o întrerupere (sare produsele deja procesate)
node scraper/scrape_fise_tehnice.mjs --skip-done
```

**Ce face:**
- Fetch sitemap.xml → extrage ~4.400 URL-uri de produs
- Detectează link-uri PDF de fișă tehnică în fiecare pagină
- Descarcă PDF-urile în **Supabase Storage** (bucket `fise-tehnice`)
- Actualizează `products.fisa_tehnica_url` și `fisa_tehnica_storage_path`
- Loghează tot în `fise_tehnice_scrape_log`

**Output:**
```
✓ = PDF descărcat cu succes în Storage
U = URL găsit, dar download eșuat (salvat doar URL-ul)
· = Produsul nu are fișă tehnică
E = Eroare HTTP
```

---

### Pasul 2 — Extragere specs cu AI (3-6 ore)

```bash
# Test pe 5 produse
node scraper/extract_specs_from_pdfs.mjs --test 5 --dry-run

# Rulare completă
node scraper/extract_specs_from_pdfs.mjs
```

**Ce face:**
- Citește PDF-urile din Supabase Storage
- Extrage textul din PDF cu `pdf-parse`
- Trimite textul la **Gemini AI** → returnează JSON structurat cu:
  - Conductivitate termică, densitate, rezistență la compresiune
  - Clasă reacție foc, norme EN
  - Temperaturi de aplicare, timp de uscare
  - Compatibilități, utilizare, incompatibilități
  - Rezumat tehnic în română
- Salvează specs în `products.specifications.fisa_tehnica_specs`

---

### Pasul 3 — Generare embeddings vectoriale (30-60 min)

```bash
node scraper/generate_embeddings.mjs
```

**Ce face:**
- Construiește text descriptiv din specs fiecărui produs
- Generează vector 768D cu **Gemini text-embedding-004**
- Salvează în tabelul `product_embeddings`
- Activează căutarea semantică pentru consultantul AI

---

## Structura datelor stocate

### `products` (câmpuri adăugate)
| Câmp | Tip | Descriere |
|------|-----|-----------|
| `fisa_tehnica_url` | TEXT | URL CDN al PDF-ului |
| `fisa_tehnica_storage_path` | TEXT | Cale în Supabase Storage |
| `fisa_tehnica_processed` | BOOLEAN | Specs AI extrase? |
| `specifications.fisa_tehnica_specs` | JSONB | Specs structurate din PDF |

### `fise_tehnice_scrape_log`
Tracking complet al procesării fiecărui produs:
- `status`: `found` / `not_found` / `error` / `specs_extracted`

### `product_embeddings`
- `embedding`: vector(768) — pentru căutare semantică
- `specs_text`: textul sursă folosit

---

## Verificare rapidă

```bash
# Statistici după rulare
node -e "
import('@supabase/supabase-js').then(({createClient}) => {
  const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  sb.rpc('get_fise_tehnice_stats').then(({data}) => console.log(JSON.stringify(data, null, 2)));
});
"
```

---

## Flags disponibile

| Flag | Descriere |
|------|-----------|
| `--test N` | Procesează doar primele N produse |
| `--dry-run` | Fără scriere în DB/Storage |
| `--skip-done` | Sare produsele deja procesate (Pasul 1) |
| `--force` | Reprocessează inclusiv cele deja făcute (Pasul 2 & 3) |
