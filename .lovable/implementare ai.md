- Să transformi cereri ambigue/incomplete (mai ales din WhatsApp) în: (1) produs(e) candidate + (2) alternative echivalente/compatibile + (3) ofertă (linii, cantități, prețuri, termene), cu trasabilitate: „de ce am ales asta”.
## Arhitectură (pe scurt)
- Ingestie : WhatsApp / text liber / fișier / operator (copy-paste).
- Înțelegere cerere (AI) : extrage intenția + entități (categorie, brand, cod produs, utilizare, dimensiuni, cantitate, locație/livrare).
- Căutare & potrivire (Retrieval) : găsește produse candidate din catalog (chiar dacă inputul e „MPI”, „coltare”, „profil colț cu plasă”).
- Motor de alternative : propune echivalente (identice / foarte asemănătoare) din aceeași categorie, pe baza proprietăților.
- Motor de ofertare : compune oferta (inclusiv sugestii de accesorii/consumabile doar dacă sunt cerute în regulile tale de ofertare).
- Human-in-the-loop : operatorul confirmă rapid când scorul e sub prag sau când lipsesc date.
- Învățare din feedback : corecțiile operatorului devin reguli/sinonime/date de antrenare.
## Faza 0 — Pregătire date (fundamentală)
1. Catalog „curat” (surse)
   - Lista produse: denumire, SKU, brand, categorie, subcategorie.
   - Atribute normalizate (unde există): bază (var-ciment), granulatie, consum, rezistențe, interior/exterior, grosimi, ambalaj (kg), compatibilități.
   - Preț, stoc, termene (dacă e cazul).
2. Dicționar de sinonime & prescurtări (minim)
   - Ex: „MPI” → „Baumit MPI 25 (tencuială var-ciment)”
   - „coltare” → „profil colț” + disambiguare (cu plasă PVC / aluminiu / inox / fără plasă, dimensiuni).
3. Taxonomie / reguli de echivalență
   - Definiți „echivalent” pe categorii:
     - tencuieli: tip liant, utilizare, granulatie, ambalaj, clasa/performanțe, aplicare manuală/mecanizată
     - profile colț: material, tip plasă, lățime plasă, lungime, grosime, utilizare (ETICS/fațadă/interior)
4. Set de conversații reale (anonimizate)
   - 200–1000 mesaje WhatsApp cu „cerere → produs ales de operator → alternativă acceptată/respinsă” (pentru evaluare și tuning).
## Faza 1 — Înțelegerea cererii din text (WhatsApp)
Scop: să extragi structurat ce a spus clientul, chiar dacă e ambiguu.

- Clasificare intenție : cerere produs, cerere alternativă, cerere ofertă completă (cu cantități), întrebare preț/termen.
- Extracție entități (NER + reguli) :
  - produs/categorie, brand, cod (MPI, CT, etc.), dimensiuni (10x10, 2.5m), cantități (saci, buc, mp), locație, termen.
- Normalizare limbaj :
  - diacritice, greșeli, plural, forme regionale, prescurtări.
- Output standard (JSON intern) :
  - intent , category_hint , brand_hint , product_tokens , constraints , quantity , confidence , missing_fields .
Exemplu pentru „Vreau niste coltare”:

- intent: „cerere produs”
- category_hint: „profil colț”
- missing_fields: tip (cu plasă/fără), material, dimensiune, utilizare (fațadă/interior)
## Faza 2 — Potrivire produs (catalog search robust)
Scop: să găsești candidate bune chiar când inputul e slab.

- Căutare hibridă :
  - lexical (fuzzy) + semantic (embeddings) peste: denumire, descriere, atribute, sinonime.
- Re-ranking cu reguli :
  - dacă apare brand explicit, îl prioritizezi.
  - dacă apare cod (ex „MPI”), mapare directă + fallback.
- Scor de încredere :
  - Top 5 candidate + de ce au ieșit (match pe cod, categorie, atribute).
## Faza 3 — Motor de alternative (echivalențe)
Scop: să propui alternative „aceeași categorie + proprietăți similare/identice”.

1. Definiție „similaritate” pe categorie (chei de matching)
   - Exemplu tencuială var-ciment: liant, utilizare, aplicare, granulatie, consum, ambalaj.
   - Exemplu profile colț cu plasă: tip profil, lățime plasă, material, compatibilitate ETICS.
2. Ranking alternative
   - Identic (același produs alt ambalaj) → Echivalent (alt brand, aceleași chei) → Apropiat (diferențe mici, explicit marcate).
3. Explicabilitate
   - „Alternativă X: aceeași categorie, aceeași bază var-ciment, aceeași aplicare; diferă ambalaj 30kg vs 25kg”.
## Faza 4 — Motor de ofertare (individual + ofertă completă)
Scop: să generezi ofertă coerentă chiar când lipsesc detalii.

- Mod 1: ofertă produs individual
  - confirmi produsul (sau ceri clarificare dacă scor sub prag).
  - pui preț, disponibilitate, termen, transport (dacă se aplică).
- Mod 2: ofertă pe listă (mai multe poziții)
  - parsezi lista din WhatsApp (linii, cantități, unități).
  - creezi linii ofertă + echivalente opționale.
- Gestionare lipsuri
  - dacă lipsesc cantități/unități: generezi întrebări țintite (max 2–4) sau propui „estimare” doar dacă business-ul permite.
- Output
  - draft ofertă în formatul tău (PDF/HTML/CRM), plus structura internă.
## Faza 5 — Interfață operator (rapid, fără fricțiune)
- Panou „Mesaj client” (raw) + „Înțeles de AI” (structurat).
- Top candidate + alternative + motiv/scor.
- Butoane: Accept / Schimbă / Cere clarificare (cu template-uri scurte).
- Salvare feedback: „AI a ales greșit pentru că …” (devine date pentru îmbunătățire).
## Faza 6 — Evaluare, praguri și control de risc
- Metrici
  - Top-1 accuracy (produs corect), Top-3 coverage, timp mediu de ofertare, rata de clarificări, acceptare alternative.
- Praguri
  - dacă confidence < X : nu auto-propui, ci ceri clarificare sau trimiți la operator.
- Teste pe set real
  - minim: 200 conversații istorice ca set de validare.
## Faza 7 — Învățare continuă
- Log doar ce e necesar (fără date sensibile).
- Update săptămânal la sinonime/prescurtări (MPI, „coltare”, „plasă”, „adeziv polistiren” etc.).
- Fine-tuning / instrucțiuni custom doar după ce ai suficient feedback și un baseline bun cu retrieval.
# Livrabile concrete (ce ar trebui să rezulte)
- Dicționar sinonime/prescurtări + reguli pe categorii.
- Endpoint/serviciu „parse request” (WhatsApp → structură).
- Endpoint „match products” (structură → candidate).
- Endpoint „recommend alternatives” (produs → alternative explicate).
- Generator ofertă (draft) + UI de validare.
- Dashboard de metrici (calitate și timp).
Dacă vrei să îl fac și mai aplicat pe business-ul tău, următorul pas util este să definesc „cheile de echivalență” pentru primele 10 categorii care apar cel mai des la voi (ex: tencuieli, adezivi, profile, gleturi, amorse, plase, dibluri etc.) și să propun exact ce atribute trebuie normalizate în catalog pentru fiecare.