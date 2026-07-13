-- ═══════════════════════════════════════════════════════════════════
-- Migrație: Corectare index pgvector pentru acoperire completă
-- ═══════════════════════════════════════════════════════════════════
--
-- Problema: Indexul de tip IVFFlat (idx_product_embeddings_cosine) a fost creat
-- când tabela avea foarte puține rânduri. Spre deosebire de indexurile B-Tree,
-- IVFFlat nu se restructurează automat la inserări masive. Acest lucru făcea ca
-- căutarea vectorială să returneze doar 109 produse din cele 1028 existente,
-- ignorând complet produsele adăugate ulterior (inclusiv picioarele de plot).
--
-- Soluția: La dimensiunea actuală a catalogului (<10.000 produse), căutarea exactă
-- (sequential scan) durează sub 1 milisecundă și are acoperire (recall) de 100%.
-- Eliminăm indexul IVFFlat pentru a forța căutarea exactă. Dacă baza de date crește
-- peste 20.000 de produse, se va crea un index de tip HNSW (care se actualizează dinamic).

DROP INDEX IF EXISTS public.idx_product_embeddings_cosine;
