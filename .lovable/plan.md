
# Dashboard Max Bau Materiale - Plan de implementare

## Faza 1: Setup Backend (Lovable Cloud + Supabase)

### Tabele DB:
- **categories** — id, name, parent_id (pentru subcategorii), slug
- **products** — id, category_id, cod_intern (NOT NULL, UNIQUE), denumire_completa, description, unit, pret_lista (fără TVA), image_url, specifications (jsonb), created_at, updated_at
- **discount_rules** — id, category_id (nullable), product_id (nullable), rule_type (enum: quantity/payment/transport/promo), min_quantity, discount_percent, label, active
- **profiles** — id (FK auth.users), full_name, email, role (default 'sales_rep')
- **quotes** — id, user_id (FK profiles), client_name, client_phone, client_email, project_description, status (draft/sent/accepted), total_net, total_tva, total_gross, created_at
- **quote_items** — id, quote_id, product_id, cod_intern, denumire, quantity, unit, pret_unitar, discount_percent, pret_final, subtotal

### Auth:
- Email + password registration/login cu Supabase Auth
- RLS pe toate tabelele

## Faza 2: Scraping maxbau.ro (Firecrawl)

- Conectare Firecrawl connector
- Edge function `scrape-maxbau` care:
  1. Folosește Firecrawl Map pentru a descoperi toate URL-urile de produse de pe maxbau.ro
  2. Scrape fiecare pagină de produs extragând: **cod intern**, **denumire completă**, categorie, subcategorie, preț, unitate, specificații
  3. Inserează în DB (categories + products)
- Pagină admin cu buton "Import produse" + progress + actualizare manuală (CRUD)

## Faza 3: Dashboard UI

### Layout:
- Sidebar navigation: Catalog, Ofertă nouă, Ofertele mele, Admin produse
- Header cu user info + logout

### Catalog produse:
- Navigare pe categorii/subcategorii (tree)
- Search + filtrare
- Card produs cu cod intern, denumire, preț, imagine
- Vânzare individuală: selectare produs → cantitate → aplicare discount → adăugare în ofertă

### Generator oferte complexe (AI):
- Formular: tip proiect (termosistem, acoperiș, etc.), dimensiuni (suprafață, înălțime)
- Edge function `generate-offer` care trimite la Gemini (Lovable AI Gateway):
  - Contextul: catalogul de produse din DB
  - Input: dimensiunile + tipul proiectului
  - Output: lista de materiale cu cantități calculate
- Afișare rezultat ca tabel editabil: produs, cantitate, preț, discount, subtotal
- Buton "Alternativă" per produs → AI sugerează echivalente din catalog
- Editare liberă: schimbare cantitate, preț, adăugare/ștergere rând

### Sistem prețuri (fără TVA):
- Preț de listă din DB
- Matrice discounturi configurabilă (admin): praguri cantitate, tip plată, transport, promoții
- Preț editabil direct în ofertă (override manual)
- Calcul automat: subtotal per rând, total net, TVA 19%, total brut

### Generare ofertă:
- Vizualizare pe ecran cu toate detaliile + branding Max Bau
- Export PDF (jsPDF/react-pdf) cu header firmă, tabel produse, totaluri
- Istoric oferte per reprezentant

## Faza 4: Admin

- CRUD produse (editare preț, cod intern, denumire, categorie)
- Gestionare matrice discounturi
- Buton re-import/actualizare de pe site

## Structura fișiere principale:
```
src/
  pages/ — Login, Register, Dashboard, Catalog, NewQuote, MyQuotes, AdminProducts, AdminDiscounts
  components/ — ProductCard, QuoteBuilder, QuoteTable, AIOfferGenerator, PDFExport, DiscountMatrix, CategoryTree
  lib/api/ — firecrawl.ts, quotes.ts, products.ts
  integrations/supabase/ — client, types
supabase/functions/ — scrape-maxbau, generate-offer, firecrawl-*
```

## Note tehnice:
- Toate prețurile sunt fără TVA, TVA se calculează separat (19%)
- Cod intern = câmp obligatoriu, unic, vizibil peste tot
- Categorii cu subcategorii (parent_id self-reference)
- AI-ul primește catalogul ca context pentru a genera oferte precise
