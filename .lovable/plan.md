# Plan: Fix Import OCR/Excel + AI SmartQuote On-Demand

## Status: ✅ Implementat

### Etapa 1: Fix Import OCR/Excel — ✅ Done
- Fix Select.Item cu value gol (filtrat sugestii invalide)
- Auto-detect coloană preț (`guessPriceColumnIndex`)
- Fix eroare `consum` column (MyQuotes citește din specifications.ai_info)
- Fix eroare `cerere_initiala` (eliminat din insert quote_items)

### Etapa 2: AI SmartQuote On-Demand + Cache — ✅ Done
- Edge function `ai-product-info` deployed
- Lovable AI Gateway (google/gemini-3-flash-preview)
- Structured output via tool calling
- Cache în products.specifications.ai_info (JSONB, TTL 30 zile)
- UI: card "Detalii tehnice AI" în SmartQuote cu consum, ambalaj, alternative, compatibilități

### Fără coloane noi în DB
- Nu s-au creat coloane consum/ambalare/similar_cu
- Totul salvat în JSONB specifications.ai_info existent
