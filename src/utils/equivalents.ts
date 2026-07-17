/**
 * Căutare de produse echivalente — orchestrare DB-first.
 *
 * Fluxul (în ordine, oprindu-se la primul pas cu rezultate):
 *   1. Cache în `echivalente_produse` pe cheia normalizată a cererii
 *      (re-validat prin barierele motorului — cache-ul vechi poate conține
 *      potriviri făcute înainte de bariere).
 *   2. Candidați din DB (căutare accent-insensitivă pe tokeni) evaluați local
 *      de equivalentsEngine — zero apeluri AI, zero tokeni.
 *   3. Doar dacă DB-ul nu produce nimic și fallback-ul AI e permis:
 *      findEquivalentWithAnthropic, ale cărui rezultate trec prin ACELEAȘI
 *      bariere înainte de a fi returnate (AI-ul nu poate strecura OSB la vată).
 */

import { supabase } from "@/integrations/supabase/client";
import { buildSearchOrConditions } from "@/utils/searchUtils";
import {
  analyzeRequest,
  evaluateEquivalents,
  normalizeCerere,
  type CandidateProduct,
  type EvaluatedEquivalent,
} from "@/lib/equivalentsEngine";
import { findEquivalentWithAnthropic } from "@/utils/anthropic";

export interface EquivalentsResult {
  success: boolean;
  from_cache: boolean;
  /** "db" | "cache" | "ai" — de unde vin rezultatele */
  source: "db" | "cache" | "ai" | "none";
  category: unknown;
  echivalente: EvaluatedEquivalent[];
}

const PRODUCT_COLUMNS =
  "id, cod_intern, denumire_completa, pret_lista, unit, brand, specifications";

async function fetchCandidates(cerere: string): Promise<CandidateProduct[]> {
  const analysis = analyzeRequest(cerere);
  const merged = new Map<string, CandidateProduct>();

  // Căutăm pe cei mai specifici tokeni (cei mai lungi primii), max 4 interogări.
  const searchTokens = [...analysis.tokens].sort((a, b) => b.length - a.length).slice(0, 4);

  // Tokenul de familie garantează că universul candidaților conține familia
  // cerută chiar dacă tokenii lungi sunt branduri/atribute.
  if (analysis.familyMatch) {
    const famToken = analysis.familyMatch.family.tokens.find((t) => !t.includes(" "));
    if (famToken && !searchTokens.includes(famToken)) searchTokens.push(famToken);
  }

  const queries = searchTokens.map((token) =>
    supabase
      .from("products")
      .select(PRODUCT_COLUMNS)
      .eq("is_active", true)
      .or(buildSearchOrConditions(token))
      .limit(300)
  );

  const settled = await Promise.all(queries.map((q) => q.then((r) => r.data ?? [])));
  for (const rows of settled) {
    for (const row of rows as CandidateProduct[]) merged.set(row.id, row);
  }
  return Array.from(merged.values());
}

async function readCache(cerere: string): Promise<EvaluatedEquivalent[]> {
  const normKey = normalizeCerere(cerere);
  const legacyKey = cerere.toLowerCase().trim();

  const { data: rows } = await supabase
    .from("echivalente_produse")
    .select("product_id, scor_relevanta, nota_echivalenta, products(" + PRODUCT_COLUMNS + ")")
    .in("cerere_text", [normKey, legacyKey])
    .order("scor_relevanta", { ascending: false })
    .limit(15);

  if (!rows || rows.length === 0) return [];

  // Re-validăm produsele din cache prin barierele motorului: intrările vechi
  // pot fi pre-bariere și pot conține echivalențe absurde.
  const products = rows
    .map((r: any) => r.products)
    .filter(Boolean) as CandidateProduct[];
  const gated = evaluateEquivalents(cerere, products);
  const gatedIds = new Set(gated.map((g) => g.product_id));

  return rows
    .filter((r: any) => r.products && gatedIds.has(r.products.id))
    .map((r: any) => {
      const engineResult = gated.find((g) => g.product_id === r.products.id)!;
      return {
        ...engineResult,
        // Păstrăm justificarea/scorul din cache dacă există, plafonate de motor
        justificare: r.nota_echivalenta || engineResult.justificare,
        scor: Math.min(Number(r.scor_relevanta) || engineResult.scor, engineResult.scorPenalized ? engineResult.scor : 100),
      };
    });
}

async function writeCache(cerere: string, category: unknown, results: EvaluatedEquivalent[]) {
  if (results.length === 0) return;
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return;

  const cat = (category ?? {}) as { category_id?: string; category_path?: string };
  const rows = results.map((e) => ({
    cerere_text: normalizeCerere(cerere),
    product_id: e.product_id,
    cod_intern: e.cod_intern,
    denumire_completa: e.denumire_completa,
    pret_lista: e.pret_lista,
    unit: e.unit,
    scor_relevanta: Math.min(100, Math.max(1, e.scor)),
    nota_echivalenta: e.justificare,
    category_id: cat.category_id ?? null,
    category_path: cat.category_path ?? null,
    creat_de: userData.user.id,
  }));
  await supabase.from("echivalente_produse").insert(rows);
}

/**
 * Punctul unic de intrare pentru echivalențe. DB întâi, AI doar ca fallback
 * explicit — și chiar și atunci rezultatele AI trec prin barierele motorului.
 */
export async function findEquivalents(
  cerere: string,
  opts: { allowAiFallback?: boolean } = {}
): Promise<EquivalentsResult> {
  const { allowAiFallback = true } = opts;
  const trimmed = cerere.trim();
  if (trimmed.length < 3) throw new Error("Cererea este prea scurtă.");

  // 1. Cache
  const cached = await readCache(trimmed);
  if (cached.length > 0) {
    return { success: true, from_cache: true, source: "cache", category: null, echivalente: cached };
  }

  // 2. DB + motor local
  const candidates = await fetchCandidates(trimmed);
  const dbResults = evaluateEquivalents(trimmed, candidates);
  if (dbResults.length > 0) {
    await writeCache(trimmed, null, dbResults);
    return { success: true, from_cache: false, source: "db", category: null, echivalente: dbResults };
  }

  // 3. Fallback AI, cu re-validare prin bariere
  if (!allowAiFallback) {
    return { success: true, from_cache: false, source: "none", category: null, echivalente: [] };
  }

  const aiResult = await findEquivalentWithAnthropic(trimmed);
  if (!aiResult?.success || !Array.isArray(aiResult.echivalente) || aiResult.echivalente.length === 0) {
    return { success: true, from_cache: false, source: "none", category: aiResult?.category ?? null, echivalente: [] };
  }

  // Re-încărcăm produsele propuse de AI cu specificațiile lor și le trecem
  // prin aceleași bariere dure.
  const aiIds = aiResult.echivalente.map((e: any) => e.product_id).filter(Boolean);
  const { data: aiProducts } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .in("id", aiIds);

  const gated = evaluateEquivalents(trimmed, (aiProducts ?? []) as CandidateProduct[]);
  const gatedById = new Map(gated.map((g) => [g.product_id, g]));

  const echivalente: EvaluatedEquivalent[] = aiResult.echivalente
    .map((e: any) => {
      const g = gatedById.get(e.product_id);
      if (!g) return null; // eliminat de bariere → nu ajunge la utilizator
      return {
        ...g,
        // Scorul final: minimul dintre scorul AI și plafonul motorului
        scor: Math.min(Number(e.scor) || g.scor, g.scorPenalized ? g.scor : 100),
        justificare: e.justificare ? `${e.justificare}${g.scorPenalized ? ` ⚠️ ${g.justificare.split("⚠️")[1] ?? ""}` : ""}` : g.justificare,
      };
    })
    .filter(Boolean) as EvaluatedEquivalent[];

  if (echivalente.length > 0) {
    await writeCache(trimmed, aiResult.category, echivalente);
  }

  return {
    success: true,
    from_cache: false,
    source: echivalente.length > 0 ? "ai" : "none",
    category: aiResult.category,
    echivalente,
  };
}
