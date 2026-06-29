# MaxBau — Context Complet pentru Agentul AI

> **CITEȘTE ACEST FIȘIER INTEGRAL LA FIECARE SESIUNE NOUĂ.**
> Nu scana alte fișiere din proiect dacă nu ți se cere explicit. Toate informațiile relevante sunt aici.

---

## 1. Descrierea Proiectului

**Aplicație web de comerț B2B pentru materiale de construcții MaxBau.**

Este o aplicație React + TypeScript + Vite care integrează:
- un catalog de produse de construcții (~4.400 produse) cu prețuri și discount-uri pe grile de client
- un asistent AI tehnic (consilier) care recomandă produse pe baza nevoii clientului
- un pipeline de ingestie/procesare a fișelor tehnice PDF (scraping → stocare Supabase → extragere specs cu Gemini AI → embeddings vectoriale)

---

## 2. Stack Tehnic

| Layer | Tehnologie |
|---|---|
| Frontend | React 18 + TypeScript + Vite 5 |
| Styling | TailwindCSS v3 + shadcn/ui (Radix UI) |
| Backend | Supabase (PostgreSQL + Edge Functions Deno + Storage) |
| AI | Google Gemini (`gemini-2.0-flash` pentru chat, `text-embedding-004` pentru vectori) |
| ORM/client | `@supabase/supabase-js` v2 |
| State management | TanStack React Query v5 |
| Routing | React Router DOM v6 |
| PDF processing | `pdf-parse`, `pdfjs-dist`, `tesseract.js` (OCR) |
| Scraping | Node.js ESM scripts (`.mjs`) cu `node-fetch` și `jsdom` |
| Package manager | `npm` (există și `bun.lock` din istoria Lovable, dar se folosește npm) |

---

## 3. Supabase — Credențiale și Proiect Activ

- **Project ID**: `eklxkylfqlrkwoqtgpcw`
- **URL**: `https://eklxkylfqlrkwoqtgpcw.supabase.co`
- **Chei**: stocate în `.env` (nu le afișa niciodată în răspunsuri)
- **Backup chei vechi** (Lovable/proiect precedent): în `.env.backup`

> Proiectul a migrat dintr-un proiect Lovable mai vechi într-un proiect Supabase nou. Migrarea a fost finalizată.

---

## 4. Structura Fișierelor Cheie

```
maxbau/
├── .agents/AGENTS.md           ← ești aici
├── .env                        ← credențiale active (NU le expune)
├── .env.backup                 ← credențiale vechi Lovable (rollback)
├── INSTRUCTIUNI_MIGRARE.md     ← caietul de sarcini complet inițial
│
├── src/
│   ├── App.tsx                 ← router principal
│   ├── pages/                  ← paginile aplicației
│   ├── components/             ← componente UI reutilizabile
│   ├── hooks/                  ← custom React hooks
│   ├── integrations/supabase/  ← client Supabase + tipuri generate
│   └── utils/                  ← funcții utilitare
│
├── supabase/
│   ├── functions/              ← Edge Functions Deno (9 funcții)
│   │   ├── ai-consultant/      ← asistentul AI principal (chat)
│   │   ├── ai-find-equivalent/ ← găsire produse echivalente
│   │   ├── ai-product-info/    ← detalii produs pentru AI
│   │   ├── ai-proxy/           ← proxy generic Gemini
│   │   ├── extract-pdf-specs/  ← extrage specs din PDF via Gemini
│   │   ├── generate-product-embedding/ ← generare vector semantic
│   │   ├── ocr-whatsapp/       ← OCR pentru imagini WhatsApp
│   │   ├── scrape-maxbau/      ← scraper via Edge Function
│   │   └── semantic-search/    ← căutare semantică vectorială
│   └── migrations/             ← 25 fișiere SQL (structura BD)
│
└── scraper/                    ← scripturi Node.js pentru pipeline
    ├── scrape_fise_tehnice.mjs     ← descarcă PDF-uri → Supabase Storage
    ├── extract_specs_from_pdfs.mjs ← extrage specs cu Gemini AI
    ├── generate_embeddings.mjs     ← generează vectori pgvector
    ├── migrate_data.mjs            ← migrare date din Lovable vechi
    └── bulk_extract_via_edge_function.mjs
```

---

## 5. Schema Bazei de Date (tabele principale)

| Tabelă | Scop |
|---|---|
| `products` | Catalog produse (id, name, price, category_id, specifications JSONB, fisa_tehnica_url, etc.) |
| `categories` | Categorii produse (ierarhice) |
| `product_embeddings` | Vectori semantici 768D pentru fiecare produs (pgvector) |
| `product_prices` | Istoricul/grila de prețuri pe client |
| `price_sheets` | Fișe de prețuri negociate |
| `discount_rules` | Reguli de discount per categorie/client |
| `fise_tehnice_scrape_log` | Log-ul operațiunilor de scraping PDF |
| `app_config` | Configurări globale aplicație |
| `echivalente_produse` | Mapare produse echivalente |

---

## 6. Arhitectura AI (Pipeline Fișe Tehnice)

```
maxbau.ro (sitemap ~4400 produse)
        ↓  scrape_fise_tehnice.mjs
Supabase Storage (bucket: fise-tehnice) ← PDF-uri fizice
        ↓  extract_specs_from_pdfs.mjs
products.specifications.fisa_tehnica_specs ← JSON structurat (Gemini)
        ↓  generate_embeddings.mjs
product_embeddings ← vectori 768D (text-embedding-004)
        ↓  semantic-search Edge Function
AI Consultant → răspunsuri bazate pe specs reale
```

---

## 7. Comenzi Frecvente

```bash
# Dev server
npm run dev

# Scraping PDF-uri (test pe 20 produse)
node scraper/scrape_fise_tehnice.mjs --test 20

# Extragere specs cu Gemini (test pe 10)
node scraper/extract_specs_from_pdfs.mjs --test 10

# Generare embeddings (test pe 10)
node scraper/generate_embeddings.mjs --test 10

# Migrare date din proiectul Lovable vechi
node scraper/migrate_data.mjs

# Build producție
npm run build

# Rulare teste
npm run test
```

---

## 8. Stadiul Curent al Proiectului

> **ACTUALIZEAZĂ ACEASTĂ SECȚIUNE** după fiecare sesiune de lucru importantă.

### Finalizat ✅
- Migrare completă din proiectul Lovable în noul proiect Supabase (`eklxkylfqlrkwoqtgpcw`)
- Toate cele 25 de migrări SQL aplicate și corectate (inclusiv extensia `http`, tabela `app_config`, deduplicare `echivalente_produse`)
- Pipeline scraping fișe tehnice complet scris (`/scraper`)
- 9 Edge Functions Deno implementate
- Configurare credențiale `.env` actualizată
- Creat sistem context persistent: `.agents/AGENTS.md` (citit automat la fiecare sesiune nouă)
- **Fix căutare diacritice** în Catalog și AdminProducts: creat `src/utils/searchUtils.ts`
  cu funcția `buildSearchOrConditions()` — generează variante cu/fără diacritice românești
  (ex: "vata bazaltica" găsește acum "Vată bazaltică" în DB)
- **Fix filtrul "Doar cu fișă tehnică"** în Catalog: verifică `fisa_tehnica_url IS NOT NULL`
  în loc de `fisa_tehnica_processed = true` (care era mereu false)

### În curs / Următor ⏳
- **Extragerea specs AI din fișele deja descărcate** — PDF-urile sunt în Storage, specs nu sunt extrase.
  Comandă de rulat din terminal (durează ore pentru toate produsele):
  ```bash
  node scraper/extract_specs_from_pdfs.mjs --skip-done
  ```
- Generare embeddings după extragerea specs:
  ```bash
  node scraper/generate_embeddings.mjs --skip-done
  ```
- Testare și validare Edge Function `semantic-search` cu date reale

### Cunoscut ca problematic ⚠️
- `bun.lock` și `bun.lockb` există în repo din istoricul Lovable, dar proiectul folosește `npm`. Nu șterge aceste fișiere, ignoră-le.
- `supabase-go.exe` și `supabase.exe` sunt binare locale, nu fac parte din codul aplicației.
- `fisa_tehnica_processed` (boolean în `products`) NU este sincronizat automat cu `specifications.fisa_tehnica_specs` (JSONB). Filtrul din Catalog verifică `fisa_tehnica_url IS NOT NULL`.

---

## 9. Reguli de Lucru pentru Agent

1. **Nu scana toate fișierele la începutul sesiunii** — folosește AGENTS.md ca punct de pornire.
2. **Nu expune niciodată cheile din `.env`** în răspunsuri sau artefacte.
3. **Nu șterge** `.env.backup`, `bun.lock`, `bun.lockb` sau executabilele `.exe` — sunt acolo intenționat.
4. **Actualizează secțiunea 8 AUTOMAT** la finalul oricărei sesiuni cu commits, fără a fi nevoie să ți se ceară explicit. La `/learn`, actualizarea Secțiunii 8 este primul lucru de propus.
5. **Migrările SQL** din `supabase/migrations/` sunt numerotate și ordonate — nu le reordona și nu le sterge.
6. **Edge Functions** rulează în runtime Deno — sintaxa importurilor este diferită față de Node.js (`import ... from "npm:..."` sau din URL-uri `esm.sh`).
7. Când user-ul menționează „asistentul AI" sau „consilerul tehnic", se referă la Edge Function `ai-consultant`.
8. **Căutare în Supabase-JS**: folosește întotdeauna `buildSearchOrConditions()` din `src/utils/searchUtils.ts` în loc de `ilike` simplu — acoperă diacriticele românești (ă, â, î, ș, ț).
