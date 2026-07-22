# MaxBau Sales — Context Unic pentru Agentul AI

> **Acest fișier este SURSA UNICĂ DE ADEVĂR despre starea proiectului.**
> Claude Code îl citește AUTOMAT la fiecare sesiune nouă. Nu scana alte fișiere
> la început de sesiune — pornește de aici și deschide fișiere doar când task-ul o cere.
> **ACTUALIZEAZĂ Secțiunea 8 (Stadiul Curent) la finalul fiecărei sesiuni cu commits.**

---

## 1. Descrierea Proiectului

**Aplicație web B2B de vânzări pentru materiale de construcții MaxBau.**

React + TypeScript + Vite, cu:
- catalog de produse (~4.400 produse) cu prețuri, grile de discount pe client și fișe tehnice PDF
- modul unificat de ofertare (`NewQuote`) cu multi-variante, căutare inline și parser AI pentru mesaje WhatsApp
- asistent AI tehnic (consilier) care recomandă produse pe baza nevoii clientului
- import antemăsurători: parsare PDF-uri de devize tabulare ȘI planuri arhitecturale/structurale, cu expansiune de materiale prin BOM Engine
- pipeline de ingestie fișe tehnice: scraping maxbau.ro → Supabase Storage → extragere specs cu AI → embeddings vectoriale → căutare semantică

## 2. Stack Tehnic

| Layer | Tehnologie |
|---|---|
| Frontend | React 18 + TypeScript + Vite 5 |
| Styling | TailwindCSS v3 + shadcn/ui (Radix UI) |
| Backend | Supabase (PostgreSQL + pgvector + Edge Functions Deno + Storage) |
| AI | **Anthropic Claude** (OCR, parsare planuri, matching — via `ai-proxy`) + Google Gemini (chat consultant, `text-embedding-004` pentru vectori) |
| State/Routing | TanStack React Query v5, React Router DOM v6 |
| PDF/OCR | `pdf-parse`, `pdfjs-dist`, `tesseract.js` |
| Teste | Vitest (`npm run test`) + Playwright |
| Package manager | `npm` (`bun.lock`/`bun.lockb` sunt relicve Lovable — nu le șterge, ignoră-le) |
| Deploy frontend | Vercel (`vercel.json`) |

**Toate apelurile AI din browser trec prin Edge Function `ai-proxy`** (`src/utils/aiProxy.ts`,
provider `"anthropic"` sau `"gemini"`) — cheile API nu ajung niciodată în browser.

## 3. Supabase

- **Project ID**: `eklxkylfqlrkwoqtgpcw` — URL: `https://eklxkylfqlrkwoqtgpcw.supabase.co`
- Chei în `.env` (NU le expune niciodată); chei vechi Lovable în `.env.backup` (nu-l șterge)
- Migrarea din vechiul proiect Lovable este finalizată
- Edge Functions se deploy-uiesc **manual din Supabase Dashboard** (nu există Supabase CLI pe mașinile de lucru)

## 4. Structura Fișierelor Cheie

```
maxbau/
├── CLAUDE.md                   ← ești aici (sursa unică de adevăr)
├── .agents/AGENTS.md           ← doar pointer către CLAUDE.md (pentru alți agenți)
├── src/
│   ├── App.tsx                 ← router principal (vezi rutele în §5)
│   ├── pages/                  ← Catalog, NewQuote, MyQuotes, RecipeQuote, Consultant,
│   │                             AntemasuratorImport, ImportOcr, ProductDetail,
│   │                             AdminProducts, AdminDiscounts, AdminSuppliers, auth
│   ├── components/             ← ProductPicker, MultiProductPicker, EquivalentsDialog,
│   │                             CategoryTree, blocuri packaging, layout, ui/ (shadcn)
│   ├── hooks/                  ← useAuth, useAiMemory, use-toast, use-mobile
│   ├── lib/                    ← matchingEngine.ts, exportExcel.ts
│   ├── utils/                  ← aiProxy.ts, anthropic.ts (~1000 l), bomEngine.ts (~1080 l),
│   │                             floorPlanParser.ts (~800 l), searchUtils.ts, geminiVision.ts
│   ├── test/                   ← floorPlanParser.test.ts, bomEngine.test.ts (Vitest)
│   └── integrations/supabase/  ← client + tipuri generate
├── supabase/
│   ├── functions/              ← 9 Edge Functions Deno: ai-consultant, ai-find-equivalent,
│   │                             ai-product-info, ai-proxy, extract-pdf-specs,
│   │                             generate-product-embedding, ocr-whatsapp,
│   │                             scrape-maxbau, semantic-search
│   └── migrations/             ← 28 fișiere SQL ordonate (ultima: 20260713 fix_vector_index)
├── scraper/                    ← pipeline Node.js: scrape_fise_tehnice.mjs,
│                                 extract_specs_from_pdfs.mjs, generate_embeddings.mjs,
│                                 scrape_missing_fise.mjs, check_stats.mjs, migrate_data.mjs
└── scripts/                    ← utilitare DB: backfill_datasheets.js, bulk_extract_specs.js,
                                  discover_missing_datasheets.js, check_pdf_size.js
```

## 5. Rute (din `src/App.tsx`)

- `/` (Index), `/login`, `/register`
- `/catalog`, `/catalog/product/:id`
- `/quote/new` și `/quote/:id/edit` → **NewQuote** (pagina unificată de ofertare)
- `/quote/smart` → redirect la `/quote/new` (SmartQuote a fost ȘTERS)
- `/quotes` (MyQuotes), `/recipe-quote` + `/wool-configurator` (RecipeQuote)
- `/quote/antemasuratori` (AntemasuratorImport), `/import` (ImportOcr)
- `/consultant` (chat AI)
- `/admin/products`, `/admin/discounts` (protejate cu AdminRoute)

## 6. Schema Bazei de Date (tabele principale)

| Tabelă | Scop |
|---|---|
| `products` | Catalog (name, price, category_id, supplier_id, specifications JSONB, fisa_tehnica_url) |
| `categories` | Categorii ierarhice — **maxim 2 niveluri**, nu adăuga al 3-lea |
| `product_embeddings` | Vectori 768D pgvector (index reparat în migrarea 20260713) |
| `quotes` / `quote_items` | Oferte; `quote_items.variant_name` adăugat 2026-07-10 |
| `product_prices`, `price_sheets`, `discount_rules`, `grile_pret` | Prețuri și discounturi pe client |
| `suppliers` | Furnizori (legați de products.supplier_id) |
| `echivalente_produse` | Mapare produse echivalente |
| `fise_tehnice_scrape_log`, `app_config` | Log scraping, configurări globale |

## 7. Comenzi Frecvente

```bash
npm install            # obligatoriu pe mașină nouă (node_modules nu sunt în repo)
npm run dev            # dev server
npm run build          # build producție
npm run test           # teste Vitest
node scraper/scrape_fise_tehnice.mjs --test 20
node scraper/extract_specs_from_pdfs.mjs --skip-done   # extragere specs (durează ore)
node scraper/generate_embeddings.mjs --skip-done
node scraper/check_stats.mjs                           # statistici progres DB
node scripts/discover_missing_datasheets.js            # găsește produse fără fișă tehnică
node scripts/backfill_datasheets.js                    # completează fisa_tehnica_url lipsă
```

## 8. Stadiul Curent al Proiectului

> Ultima actualizare: **2026-07-22**. Actualizează după fiecare sesiune importantă.

### Finalizat ✅
- **Extragere planuri structurale scanate via Anthropic Vision** (2026-07-22):
  - Bug fix blocant: pipeline-ul presupunea că PDF-urile de plan au text layer
    extractibil (`pdfjs.getTextContent()`). Planurile reale de șantier (print-to-PDF
    din CAD, ex. Bullzip PDF Printer) au **0 text items** — indiferent ce docType
    alegea userul, ajungeau la extractoare de text goale (Anthropic AI apelat cu
    string gol). Fix: detecție `textItems.length < 5` → rutare Vision.
  - `src/utils/pdfRasterize.ts` [NOU] — utilitar provider-agnostic: pdfjs → canvas
    → JPEG base64 la scale 2.5x (păstrează cotele cu 2-3 zecimale). Folosit
    exclusiv de fluxul Vision (nu duplică logica din `geminiVision.ts`, care
    rămâne dezactivat).
  - `src/utils/anthropic.ts` — 4 extractoare Vision noi cu tool schema dedicată:
    * `classifyStructuralPlanWithAnthropic()` — clasificator pe prima pagină
      (extras_armatura / plan_grafic_structural / plan_finisaje / sarpanta /
      necunoscut) + detectează rotația paginii + prezența casetei MATERIALE.
    * `extractStructuralExtrasFromImageWithAnthropic()` — cale A: tabel „Extras
      de armătură". Extrage rând-cu-rând (Poz/Ø/N/L/L_totală + footer per Ø),
      cu instrucțiuni explicite pentru text rotit 90°.
    * `extractStructuralAnnotationsFromImageWithAnthropic()` — cale B: planșa
      grafică cu adnotări individuale. Recunoaște 3 pattern-uri distincte
      (bară dreaptă `N×ØD L=X`, etrier `etr.ØD L=X` + `etr ØD/pas — N buc`,
      distribuție `NØD/pas L=X`).
    * `extractMaterialsBoxFromImageWithAnthropic()` — caseta „MATERIALE:" per
      planșă (clasa beton + marca oțel per element).
    * **Toate returnează date brute rând-cu-rând** — aritmetica NU e delegată
      modelului AI.
  - `src/utils/rebarAggregator.ts` [NOU] — motor pur (24 teste Vitest):
    * `STEEL_MASS_PER_METER` hardcoded (Ø6..Ø32) cu valorile exact tipărite
      pe footer-ul extraselor românești standard, + fallback teoretic pentru
      Ø nemapate.
    * `normalizeMarca()` — colapsează „B 500 C" / „BST500S" / „BST500" → „B500C".
    * `validateEntry()` — recalculează `N×L` și flag mismatch > 2% față de sursă.
    * `aggregateRebarEntries()` — agregă pe (marcă + Ø) peste toate fișierele
      unui import, colectează sourceFiles pentru trasabilitate.
    * `compareWithFooter()` — cross-check cu footer-ul tipărit, detectează:
      Ø absent din footer (BUG REAL Ø16 din Extras_centuri), Ø absent din calc,
      mismatch pe valoare > 2%, discrepanță pe total kg.
    * `applyFooterValidation()` — propagă `needsManualReview` + motivul înapoi
      pe totaluri (fără mutare).
  - `src/types/planTypes.ts` — 5 tipuri noi: `RawRebarEntry` (audit + re-agregare
    per fișier), `RebarTotalByMarcaDiametru`, `ConcreteTotalByClass` (opțional
    pentru viitor), `PlanMaterialsBox` (metadate MATERIALE), `StructuralImportResult`.
  - `src/pages/AntemasuratorImport.tsx` — `processStructuralPdf()` nouă:
    rasterizare → clasificare → extragere pe fiecare pagină → agregare
    deterministă → convertire la ExtractedItem[] și append în lista existentă.
    Selectorul „Plan Structură" e acum funcțional (înainte era identic cu
    „Plan Finisaje"). Info-box actualizat cu explicații pentru PDF cu/fără text.
  - **Șarpanta (R09/R10) explicit amânată** — spec §10 pct.3: structura tabelului
    centralizator pentru lemn nu a fost verificată încă, poate diferi semnificativ.
  - **Chestiuni deschise** (spec §10): volum beton pe clasă neconfirmat încă
    (Extras-urile primite conțin doar oțel); agregare per-proiect implementată
    prin acumulare de items la nivel de import — dacă utilizatorul încarcă mai
    multe PDF-uri structurale, fiecare produce items separat (viitor: re-agregare
    globală în UI).
- **Motor de echivalare DB-first cu bariere dure** (2026-07-17):
  - `src/lib/equivalentsEngine.ts` [NOU] — motor pur (21 teste Vitest): bariere de
    familie de produs (vată ≠ OSB ≠ fotovoltaice), de subtip/aplicație (adeziv gresie
    ≠ adeziv polistiren), de clasă EN (ierarhie C1→C2TE) și de cerințe numerice
    (kPa/W·mK/kg·m³) din `fisa_tehnica_specs`. Valoare documentată care nu satisface
    cerința → candidat ELIMINAT; nedocumentată → scor plafonat la 45 + avertisment.
  - `src/utils/equivalents.ts` [NOU] — `findEquivalents()`: cache normalizat (tokeni
    sortați, fără diacritice) → DB + motor local (zero tokeni AI) → fallback AI doar
    dacă DB-ul nu găsește nimic, cu rezultatele AI re-validate prin ACELEAȘI bariere.
    NewQuote și AntemasuratorImport folosesc acum acest punct unic de intrare
    (vechea „potrivire rapidă" negardată din import a fost eliminată).
  - Schema de extragere specs extinsă (scraper + Edge Function `extract-pdf-specs`):
    `tip_produs` (tip normalizat cu aplicație), `alte_specificatii` (listă liberă
    cheie/valoare/um — capturează TOT din fișe atipice), `valori_numerice` (calculate
    determinist în JS, fără AI). ⚠️ Necesită RE-EXTRACȚIE: `--force` la rulare.
  - `scraper/scrape_producer_fise.mjs` [NOU] — fișe de pe site-urile producătorilor
    pentru produse fără fișă pe maxbau.ro (10 branduri configurate în BRAND_SOURCES;
    validează cu `--list-brands` apoi `--brand X --test 5 --dry-run` înainte de rulare).
  - Edge Function `ai-find-equivalent` ȘTEARSĂ din repo (relicvă Lovable gateway,
    neapelată) — ⚠️ de retras manual și din Supabase Dashboard.
- Migrare completă Lovable → Supabase nou; 28 migrări SQL aplicate; 9 Edge Functions
- Căutare: diacritice românești (`searchUtils.buildSearchOrConditions()`), normalizare
  dimensiuni cu/fără spații ("60x40" ↔ "60 x 40"), logică AND la căutarea standard,
  căutare semantică AI extinsă la 100% din produse (2026-07-13)
- **Pagina unificată de ofertare `NewQuote`** (2026-07-10/11): multi-variante,
  multi-picker, layout split paralel cu căutare inline, parser AI pentru mesaje WhatsApp.
  SmartQuote șters, rutele vechi redirecționează.
- **OCR și parsare planuri revenite pe Anthropic** (2026-07-10): Gemini Vision eliminat
  complet din fluxul OCR/planuri din cauza costurilor API mari. Gemini rămâne pentru
  chat consultant și embeddings.
- **Parser planuri arhitecturale** (`floorPlanParser.ts`): detecție spațială 2D a camerelor,
  parsare hibridă (local întâi, fallback AI), suport planuri structurale/rezistență
  (armare placă, centuri), OCR Tesseract pentru zone suspecte. 35 teste Vitest.
- **BOM Engine** (`bomEngine.ts`): expansiune materiale din camere parsate — pereți
  rigips, tavane casetate (spec Saint Gobain T24), defaults inteligente; recalculare
  automată la ștergerea spațiilor; memorie localStorage în wizard-ul de import.
- **Scripturi datasheets** (2026-07-15): backfill URL-uri fișe tehnice, descoperire
  fișe lipsă, extragere specs în masă (`scripts/`).
- Fix categorii false din breadcrumbs scraper (max 2-3 niveluri) + curățenie DB retroactivă.
- **Prețuri EPS/XPS + pagina Rețete termosistem** (2026-07-20):
  - `scripts/update_eps_xps_pricing.mjs` [NOU] — script Node.js rulat local: compară
    Excel (EPS_baza_completa.xlsx + XPS_baza_completa.xlsx) cu DB, actualizează
    `pret_lista`, upsert `product_prices` per tip ofertă (Lista/Full Tir/MU+Capac/
    Livrare Directă) și salvează `specifications.{placi_bax,mp_bax,m3_bax}` prin
    merge JS (fără RPC). ⚠️ Necesită rulare locală cu `SUPABASE_SERVICE_ROLE_KEY`.
  - `GenericPackagingBlock.tsx` — pentru `systemType === "polystyrene"`: ambalare
    citită din `specifications` (placi_bax/mp_bax/m3_bax) fără niciun apel AI;
    selector tip preț (Lista/Full Tir/...) din `product_prices`; afișaj variante
    preț /m², /bax, /m³; paleți ascunși temporar; "baxuri" peste tot.
  - `RecipeQuote.tsx` — "pachete" → "baxuri" în nota_ai; linia PALET omisă la
    salvarea ofertei pentru rețete polystyrene.

### În curs / Următor ⏳
- **Rulare script prețuri EPS/XPS** (pe mașina locală cu .env complet):
  `node scripts/update_eps_xps_pricing.mjs --eps EPS_baza_completa.xlsx --xps XPS_baza_completa.xlsx`
  (fără `--execute` = tabel comparativ; cu `--execute` = aplică în DB)
- **RE-extragere specs cu schema nouă** (rulare locală, durează ore):
  `node scraper/extract_specs_from_pdfs.mjs` — scriptul detectează singur schema
  veche (fără `tip_produs`) și reprocesează doar ce trebuie, deci se poate
  întrerupe/relua oricând; `--force` doar pentru a reface TOT. Până la re-extracție
  barierele motorului de echivalare lucrează doar pe denumiri. Apoi
  `node scraper/generate_embeddings.mjs --skip-done`.
- **Deploy manual din Supabase Dashboard**: `extract-pdf-specs` (schemă nouă),
  `scrape-maxbau` (fix breadcrumbs) + retragerea `ai-find-equivalent`
- Completare fișe lipsă: `discover_missing_datasheets.js` → `scrape_missing_fise.mjs`
  → `scrape_producer_fise.mjs` (site-uri producători, validează brandurile întâi)
- Validare `semantic-search` cu date reale după generarea embeddings
- Tipuri Supabase negenerate după migrarea `variant_name` → 4 erori `tsc` preexistente
  (`exportExcel.ts`, `NewQuote.tsx`); build-ul Vite trece, dar regenerarea tipurilor
  ar curăța `tsc --noEmit`

### Cunoscut ca problematic ⚠️
- `fisa_tehnica_processed` (boolean) NU e sincronizat cu `specifications.fisa_tehnica_specs`;
  filtrul din Catalog verifică `fisa_tehnica_url IS NOT NULL`
- `extractTextFromPdf()` din `AntemasuratorImport.tsx` nu mai e apelată în fluxul PDF
  (înlocuită de `extractPdfTextItems()` din floorPlanParser) — nu o șterge
- Fișiere de lucru în root (`debug_*.ts/.cjs`, `*.sql`, `duplicates_report.json`,
  `.trae_tmp_diff.patch` etc.) sunt artefacte de sesiuni vechi — ignoră-le, nu le șterge
- `node_modules` nu sunt în repo — rulează `npm install` pe orice mașină nouă

## 9. Reguli de Lucru pentru Agent

1. **Pornește de la acest fișier** — nu scana repo-ul la început de sesiune.
2. **Nu expune cheile din `.env`** în răspunsuri, commits sau artefacte.
3. **Nu șterge** `.env.backup`, `bun.lock(b)`, executabilele `.exe` sau fișierele de lucru din root.
4. **Actualizează Secțiunea 8 AUTOMAT** la finalul oricărei sesiuni cu commits — inclusiv
   data din antetul secțiunii. Ține secțiunea compactă: consolidează intrările vechi în
   loc să adaugi la nesfârșit.
5. Migrările SQL sunt ordonate cronologic — nu le reordona/șterge; migrare nouă = fișier nou.
6. Edge Functions rulează pe Deno — importuri `npm:` sau `esm.sh`, nu sintaxă Node.
7. „Asistentul AI" / „consilierul tehnic" = Edge Function `ai-consultant`.
8. Pentru căutări Supabase folosește `buildSearchOrConditions()` din `searchUtils.ts`,
   nu `ilike` simplu (acoperă diacriticele ă, â, î, ș, ț).
9. Apeluri AI din frontend: doar prin `callAiProxy()` (`src/utils/aiProxy.ts`), niciodată
   direct cu chei API în browser.
10. **Git workflow**: la începutul sesiunii verifică sincronizarea cu remote
    (`git fetch origin main`). Modificările majore se commit-uiesc și se push-uiesc
    **direct în `main`** — nu crea branch-uri auxiliare (decizia user-ului, 2026-07-17).
