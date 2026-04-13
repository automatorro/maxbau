## Obiectiv (ce livrează feature-ul)
- Un flux “Import OCR / Excel” ca funcționalitate principală (intrare în meniul principal + ecran dedicat).
- Upload fișiere (imagini/PDF/Excel), extragere tabel (nume produs, UM, cantitate, preț etc.), revizuire vizuală (imagine + highlight pe celulă) și editare.
- Matching pe denumire produs cu baza existentă; dacă nu e match sigur, aplicația propune candidați și întreabă explicit “este același produs?”.
- După confirmare: comparare preț extras vs preț existent (listă + eventual override-uri) și posibilitatea de override + salvare.
- Dacă nu există produs: creare produs nou în DB (după decizia userului) și apoi salvare preț.

## Plan pe faze (one phase at a time)

### Faza 1 — UX + workflow + stocare import (fără OCR real încă)
1. Navigație & UX
   - Adaug un item principal în sidebar: “Import OCR/Excel” (nu la Admin).
   - Pagina “Import” cu 3 pași clari: Upload → Revizuire/Editează → Potrivește & Salvează.
2. Stocare fișiere
   - Supabase Storage bucket: `imports` (imagini/PDF/Excel).
   - Metadate în DB: tabel `import_runs` (id, user_id, source, received_at, status, file_paths, created_at).
3. Model de date pentru rândurile extrase
   - Tabel `import_rows` (import_run_id, row_index, raw_name, normalized_name, unit, quantity, price, currency, raw_cells_json, confidence, bbox_json, status).
   - În UI: tabel editabil cu validări (preț numeric, UM text, etc.).
4. Simulare extragere
   - Pentru Excel: parsing local în browser și mapare coloane prin UI (userul alege ce coloană e “Denumire”, “Preț”, “UM”…).
   - Pentru imagini/PDF: în Faza 1 doar upload + “placeholder” (nu OCR), ca să stabilim tot UX-ul și schema.

Deliverable: ecran complet de import + editare + salvare “draft import”, fără încă OCR efectiv.

### Faza 2 — OCR real + “examinare după OCR” (imagini/PDF)
1. Motor OCR (alegem o variantă)
   - Varianta A (recomandată pentru acuratețe): OCR server-side (Supabase Edge Function) cu provider extern (Google Vision / Azure OCR / AWS Textract). Necesită chei/secrete în Supabase.
   - Varianta B (zero server secrets): OCR client-side (Tesseract WASM). Mai lent, acuratețe mai slabă, dar simplu ca deploy.
2. Extragere structură tabel
   - OCR returnează text + poziții (bbox) pe pagină.
   - Construim “grid inference”: grupare pe rânduri/coloane (heuristici) + scor de încredere pe celule.
3. UI de verificare
   - Panou stânga: imagine/pagină cu overlay (bbox).
   - Panou dreapta: tabelul extras; click pe celulă → highlight pe imagine.
   - Editarea celulelor (text/preț/UM) păstrează un “audit” (cine a modificat, ce).
4. Normalizare denumiri
   - `normalize(name)`: lower, remove diacritics, remove punctuație, collapse spaces, tokenizare.

Deliverable: OCR functional + review vizual + editare + salvare rânduri extrase.

### Faza 3 — Matching pe denumire + întrebarea “este același produs?”
1. Căutare candidați
   - Pentru fiecare `normalized_name`, căutăm în `products.denumire_completa`.
   - Implementare:
     - Dacă avem/activăm `pg_trgm` în Postgres: query cu similarity + top N.
     - Dacă nu: fuzzy matching în client pe un subset de produse (cu paginare/caching).
2. Decizie user
   - Pentru fiecare rând:
     - Auto-match dacă scor > prag (ex: 0.85) și diferența față de locul 2 e suficientă.
     - Altfel: UI cu propuneri + buton “Este același produs” / “Nu, produs nou” / “Ignoră rând”.
   - Exemplu: “adeziv flexibil flexuni” → propunere “Adeziv flexibil Baumit FlexUni 25 kg” cu confirmare explicită.
3. Creare produs nou
   - Dacă user alege “produs nou”: creează minim `products` (cod_intern generat, denumire_completa = denumirea editată/confirmată, unit dacă există, pret_lista optional 0 sau din import).
   - După creare, rândul se leagă de noul `product_id`.

Deliverable: fiecare rând ajunge fie mapat la `product_id`, fie marcat “new product”, fie ignorat.

### Faza 4 — Comparare prețuri + override + salvare
1. Comparare
   - În UI, pe rând afișăm:
     - Preț extras (editabil)
     - Preț existent în aplicație (din `products.pret_lista`)
     - Dacă există, și “preț special activ” (din `price_sheets` active + `price_sheet_items`)
     - Diferență absolută și procentuală
2. Reguli de salvare (cum persistăm override-ul)
   - Salvăm prețurile OCR ca o listă nouă în `price_sheets` + `price_sheet_items`, nu schimbăm `pret_lista`.
   - UI: “Salvează ca listă nouă” (nume listă, source=WhatsApp/Email, received_at) + opțiune “Setează activă după import”.
   - Pentru fiecare produs:
     - “Adaugă/înlocuiește prețul în listă”
     - sau “Nu salva override pentru acest rând”
3. Aplicare atomică
   - Un endpoint server-side (RPC / Edge Function) “apply_import_run” care:
     - creează price_sheet
     - upsert în price_sheet_items
     - creează produse noi selectate
     - marchează import_run = applied

Deliverable: un import aplicat produce o listă utilizabilă imediat în ofertare + rețete.

## Criterii de acceptanță (verificabile)
- Poți încărca o imagine/Excel, vezi tabelul extras, îl editezi și îl salvezi.
- Pentru rândurile ambigue, aplicația îți arată 3–5 candidați și te întreabă “este același produs?” înainte să lege produsul.
- După “Apply”, apare o listă nouă în “Liste speciale de preț”, poate fi setată activă și se vede în ofertare/rețete.
- Niciun produs existent nu se strică dacă nu are câmpuri noi.
