
# Plan aprobat - Implementare Dashboard Max Bau Materiale

Planul a fost aprobat cu condițiile adăugate:
- **Cod intern** = câmp obligatoriu, unic, prezent în scraping și DB
- **Categorii și subcategorii** = structură arborescentă în DB
- **Denumire completă** = păstrată integral din site

## Ordinea implementării (faze):

### Faza 1: Lovable Cloud + DB Schema + Auth
1. Enable Lovable Cloud
2. Creare tabele: `categories` (cu parent_id), `products` (cu `cod_intern` NOT NULL UNIQUE, `denumire_completa`), `discount_rules`, `quotes`, `quote_items`
3. Auth cu email + parolă, profiles table, RLS policies
4. Pagini Login/Register + routing protejat

### Faza 2: Firecrawl Scraping
1. Conectare Firecrawl connector
2. Edge function `scrape-maxbau` — map + scrape maxbau.ro, extragere cod intern, denumire completă, categorie, subcategorie, preț, unitate
3. Pagină admin cu buton import + CRUD manual produse

### Faza 3: Dashboard + Catalog
1. Layout cu sidebar: Catalog, Ofertă nouă, Ofertele mele, Admin
2. Catalog cu navigare categorii/subcategorii, search, filtrare
3. Card produs cu cod intern, denumire, preț, imagine

### Faza 4: Sistem prețuri + Oferte
1. Matrice discounturi configurabilă (cantitate, plată, transport, promoții)
2. Quote builder: adăugare produse, cantități, discount per rând, preț editabil
3. Calcul automat total net + TVA 19% + total brut
4. Istoric oferte per reprezentant

### Faza 5: AI Generator oferte complexe
1. Edge function `generate-offer` cu Lovable AI Gateway (Gemini)
2. Input: tip proiect + dimensiuni → output: listă materiale cu cantități
3. Alternativă/echivalent per produs
4. Integrare în quote builder

### Faza 6: PDF Export
1. Generare PDF cu branding Max Bau
2. Header firmă, tabel produse, totaluri, date client

## Note tehnice cheie:
- Toate prețurile fără TVA, TVA = 19% calculat separat
- `cod_intern`: NOT NULL, UNIQUE, afișat peste tot
- Categorii cu self-reference `parent_id` pentru subcategorii
- Scraping extrage obligatoriu: cod intern, denumire completă, categorie, subcategorie
