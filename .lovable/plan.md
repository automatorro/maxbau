
# Import inteligent liste de prețuri furnizori

## Problema
Fiecare furnizor trimite liste de prețuri în format propriu: coloane diferite, foi multiple, cu/fără categorii, UM diferite, paletizări, etc. Nimic nu e standard.

## Soluția propusă

### 1. Tabel nou: `suppliers` (furnizori)
Păstrăm identitatea fiecărui furnizor și profilul lui de import:
- `id`, `name` (ex: "Baumit", "Weber", "Knauf")
- `ai_column_map` (JSONB) — mapping-ul de coloane învățat de AI la primul import și refolosit automat la importurile ulterioare (ex: `{"denumire": "Articol", "pret": "PV fara TVA", "um": "UM", "cod": "Cod articol"}`)
- `notes` — observații manuale

### 2. Extensie `price_sheets` — legare de furnizor
- Adăugăm coloana `supplier_id` (uuid, nullable, FK spre suppliers)
- Astfel fiecare listă importată e legată de furnizor, și poți vedea istoricul importurilor per furnizor

### 3. Suport multi-sheet în Excel
Acum se citește doar primul sheet. Schimbăm:
- Parsăm TOATE sheet-urile din workbook
- UI: dropdown de selecție sheet (sau "importă toate")
- Fiecare sheet poate deveni un price_sheet separat sau se combină

### 4. AI normalizare îmbunătățită (edge function `ai-product-info`, action `ocr-excel`)
Promptul AI primește și profilul furnizorului (dacă există `ai_column_map` salvat) pentru a ști deja cum arată structura. AI-ul va returna și:
- **column_map detectat** — ce coloană e denumire, preț, UM, cod, cantitate palet, etc.
- **categorii detectate** — dacă tabelul are rânduri de categorie (bold, fără preț), le marchează
- La primul import de la un furnizor nou, salvăm automat `ai_column_map` pentru reutilizare

### 5. Coloane suplimentare în `price_sheet_items`
Adăugăm câmpuri opționale pentru a stoca datele extra pe care le oferă unii furnizori:
- `cod_furnizor` (text) — codul produsului la furnizor
- `cantitate_palet` (text) — info paletizare
- `consum` (text) — consum orientativ
- `extra_data` (JSONB) — orice altceva non-standard (greutate, dimensiuni, etc.)

### 6. UI îmbunătățit pe pagina Import
- Selector furnizor (din lista `suppliers`, sau "Furnizor nou")
- Selector sheet din Excel (dacă sunt mai multe)
- AI detectează automat coloanele, dar userul poate corecta mapping-ul
- Coloanele extra (cod furnizor, paletizare, etc.) apar în tabel dacă există
- La salvare: price_sheet se leagă de supplier

### 7. Căutare produse prin cod furnizor
Odată ce avem `cod_furnizor` salvat în `price_sheet_items`, la importurile ulterioare putem face matching automat pe cod, nu doar pe denumire — mult mai precis.

## Ordine implementare

1. **Migrare DB**: creare tabel `suppliers`, adăugare `supplier_id` pe `price_sheets`, adăugare coloane pe `price_sheet_items`
2. **Update edge function**: AI returnează și column_map + categorii detectate; primește profil furnizor
3. **UI Import**: selector furnizor, selector sheet, mapping coloane vizual, coloane extra
4. **Pagină Furnizori** (simplă): listă furnizori, editare profil, vezi importuri anterioare

## Ce NU se schimbă
- Structura produselor (`products`) — rămâne neschimbată
- Matching engine existent — se extinde doar cu match pe `cod_furnizor`
- Logica de salvare price_sheet — se extinde, nu se înlocuiește
