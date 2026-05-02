
# Plan: Fix Import OCR/Excel + AI SmartQuote On-Demand

## Etapa 1: Fix Import OCR/Excel

Probleme curente identificate în `ImportOcr.tsx` (1113 linii):
- Funcționalitatea de bază e implementată dar sunt probleme de UX
- Sugestiile Select pot avea value gol dacă un product ID nu e găsit în `productsById` (cauza potențială a erorii `Select.Item` cu value gol)
- Auto-detect coloană preț lipsește (doar coloana denumire e detectată automat)

### Modificări:

**1. Fix Select.Item cu value gol** (linia 344-353 în InlineProductSearch)
- Filtrează sugestiile care nu au un produs valid în `productsById` înainte de render
- Previne eroarea Radix "Select.Item must have a value prop that is not an empty string"

**2. Auto-detect coloană preț**
- Adaugă funcție `guessPriceColumnIndex()` care caută keywords: "pret", "price", "tarif", "lei", "eur", "ron"
- Se aplică automat la import, similar cu `guessNameColumnIndex`

**3. Detectare automată header row**
- Dacă primul rând conține text tipic de header (nu numere), îl setează ca header
- Fallback pe rândul 0

**4. UX improvements**
- La import, auto-scroll la secțiunea 3 (tabelul)
- Badge-urile de sugestii să arate și scorul de matching vizual (culoare gradient)

Fișiere modificate: `src/pages/ImportOcr.tsx`

---

## Etapa 2: AI SmartQuote On-Demand + Cache

Când operatorul caută echivalente în SmartQuote, AI caută pe internet date tehnice doar pentru produsele candidate.

### Arhitectură:

```text
SmartQuote UI → Edge Function "ai-product-info" → Lovable AI Gateway
                                                  (google/gemini-3-flash-preview)
                                                  ↓
                                          Răspuns structurat:
                                          - consum/mp
                                          - ambalaj
                                          - alternative compatibile
                                          - explicație echivalență
                                                  ↓
                                          Cache în products.specifications (JSONB)
```

### 1. Edge Function `ai-product-info`

**Fișier:** `supabase/functions/ai-product-info/index.ts`

- Input: `{ product_ids: string[], client_request: string }`
- Citește produsele din DB (denumire, cod_intern, specifications existente)
- Verifică cache: dacă `specifications.ai_info` există și e < 30 zile, returnează din cache
- Dacă nu e cached, trimite la Lovable AI Gateway cu prompt:

```
Ești expert în materiale de construcții. Pentru produsele de mai jos,
furnizează date tehnice bazate pe cunoștințele tale:
- consum estimat per mp (unde se aplică)
- tip ambalaj și greutate
- alternative echivalente (branduri/produse similare)
- compatibilități și utilizare recomandată

Context cerere client: "{client_request}"

Produse: [lista]
```

- Folosește tool calling pentru structured output (consum, ambalaj, alternative[], compatibilitati)
- Salvează rezultatul în `products.specifications.ai_info` cu timestamp
- Returnează datele structurate

### 2. Integrare în SmartQuote

**Fișier:** `src/pages/SmartQuote.tsx`

- După ce operatorul selectează produse din MultiProductPicker, apare buton "Detalii tehnice AI"
- La click, apelează edge function cu product IDs + cererea clientului
- Afișează sub tabel: consum, ambalaj, alternative recomandate
- Dacă AI sugerează alternative care există în catalog, oferă buton "Adaugă în ofertă"

### 3. Îmbunătățire MultiProductPicker

**Fișier:** `src/components/MultiProductPicker.tsx`

- Adaugă afișare `specifications.ai_info` dacă există (cached din apeluri anterioare)
- Indicator vizual "are date AI" pe produsele care au cache

### Nu se creează coloane noi în DB
- Se folosește exclusiv câmpul JSONB `specifications` existent
- Structura: `{ ai_info: { consum, ambalaj, alternative, updated_at } }`
- matchingEngine.ts rămâne neschimbat (va citi din specifications dacă e populat)

---

## Ordine implementare

1. Fix Import OCR/Excel (etapa 1) — fix-uri punctuale, ~30 min
2. Edge function `ai-product-info` — creare și deploy
3. Integrare SmartQuote cu AI — UI + apel edge function
4. Cache display în MultiProductPicker

## Detalii tehnice

- **Model AI:** `google/gemini-3-flash-preview` (rapid, cost redus)
- **Auth:** Edge function verifică JWT, citește/scrie DB cu service role
- **Rate limiting:** Maxim 5 produse per apel, debounce 2s
- **Cache TTL:** 30 zile în specifications.ai_info.updated_at
- **Fără coloane noi** — totul în JSONB specifications existent
