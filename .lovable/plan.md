## Problema

În pagina **Configurator Rețete & Sisteme** (`src/pages/RecipeQuote.tsx`), câmpul „Discount global" se aplică doar liniilor de materiale auxiliare (`lines`), NU și **produsului principal** (vată/polistiren/gips etc., stocat în `woolCalc.woolTotalCost`).

Cum produsul principal este de obicei cea mai mare parte din valoarea ofertei, când aplici un discount total pare că „nu se aplică" — de fapt se reduce doar partea auxiliară, iar produsul principal rămâne la preț întreg.

### Locurile relevante
- `discount` (state) → aplicat pe linii în `useEffect [surface, discount]` (liniile 432-456).
- `totals` (liniile 537-547) → `net = suma liniilor + woolCalc.woolTotalCost + palletGuarantee`. Aici `woolTotalCost` intră fără discount.
- La salvare (liniile 588-601), produsul principal se salvează cu `pret_final = pretUnitar` (fără discount).

## Soluția

Aplicarea discountului global și pe produsul principal, coerent în afișare și la salvare. Garanția paleților (85 lei/palet) rămâne neafectată — este o taxă returnabilă, nu se discountează.

### Modificări în `src/pages/RecipeQuote.tsx`

1. **Totaluri** (`totals`, liniile 537-547): aplică `(1 - discount/100)` pe `woolCalc.woolTotalCost` la calculul `net`, astfel încât produsul principal + auxiliarele să fie reduse cu același procent.

2. **Rând sumar „Produs principal"** (liniile 1033-1034): afișează valoarea principală după discount (și, opțional, un rând care arată reducerea aplicată produsului principal când `discount > 0`).

3. **Salvare ofertă** (liniile 588-601): la salvarea produsului principal, setează `pret_final = pretUnitar * (1 - discount/100)`, adaugă `discount_percent` pe item și recalculează `subtotal` din prețul redus, ca oferta salvată să reflecte reducerea.

### Rezultat
Când modifici „Discount global", atât produsul principal cât și materialele auxiliare se reduc, iar „Total fără TVA" / „Total cu TVA" se actualizează corect. Garanția paleților rămâne neschimbată.
