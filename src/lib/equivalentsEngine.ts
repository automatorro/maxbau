/**
 * Motor de echivalare produse — DB-first, fără AI.
 *
 * Principiu central: cererea clientului definește BARIERE DURE (gates), nu doar
 * criterii de scor. Un candidat care pică o barieră este ELIMINAT, indiferent
 * cât de bine ar puncta la potrivirea de text:
 *
 *   1. Bariera de familie: "vată 2 kPa" nu poate returna OSB sau panouri
 *      fotovoltaice — familia de produs a candidatului trebuie să coincidă
 *      cu cea a cererii.
 *   2. Bariera de subtip (aplicație): "adeziv gresie" nu poate returna
 *      "adeziv polistiren" — ambele sunt adezivi, dar aplicațiile sunt
 *      declarate incompatibile.
 *   3. Bariere de atribute obligatorii: clase EN (C2TE ≥ C1T etc.) și cerințe
 *      numerice (kPa, W/mK, kg/m³). Valoare documentată care NU satisface
 *      cerința → eliminat. Valoare nedocumentată → scor plafonat + avertisment,
 *      niciodată recomandare de top.
 *
 * Sursa datelor candidaților: products.specifications.fisa_tehnica_specs
 * (extrase din fișele tehnice PDF), cu fallback pe denumirea produsului.
 * Modulul este pur (fără I/O) pentru a fi testabil cu Vitest.
 */

import { extractCaracteristici, classSatisfies } from "./matchingEngine";

// ─── Normalizare ─────────────────────────────────────────────────────────────

export function stripDiacritics(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ăâ]/g, "a")
    .replace(/î/g, "i")
    .replace(/[șş]/g, "s")
    .replace(/[țţ]/g, "t");
}

function normalizeText(text: string): string {
  return stripDiacritics(text)
    .replace(/(?<=\d)x(?=\d)/gi, " x ")
    .replace(/[^a-z0-9.,+\-()/\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cheie de cache stabilă pentru o cerere: fără diacritice, tokeni sortați.
 * "adeziv C2TE pentru gresie" și "adeziv gresie c2te" produc aceeași cheie.
 */
export function normalizeCerere(text: string): string {
  const STOP = new Set(["de", "la", "cu", "pentru", "un", "o", "si", "sau", "din", "pe", "in"]);
  return normalizeText(text)
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .sort()
    .join(" ");
}

// ─── Taxonomia familiilor de produse ─────────────────────────────────────────

interface SubtypeDef {
  id: string;
  tokens: string[];
}

interface FamilyDef {
  id: string;
  /** Tokeni (fără diacritice) care identifică familia; frazele au prioritate. */
  tokens: string[];
  /** Grupuri de aplicație mutual exclusive în interiorul familiei. */
  subtypes?: SubtypeDef[];
}

/**
 * Dicționar extensibil. Detecția familiei folosește poziția PRIMEI apariții în
 * text: în "Adeziv vată bazaltică" câștigă "adeziv" (poziția 0), deci produsul
 * este adeziv, nu vată. Frazele multi-cuvânt se verifică înaintea tokenilor
 * simpli ("mortar adeziv" e adeziv, nu mortar).
 */
const FAMILIES: FamilyDef[] = [
  {
    id: "adeziv",
    tokens: ["mortar adeziv", "adeziv", "clei"],
    subtypes: [
      { id: "ceramic", tokens: ["gresie", "faianta", "placi ceramice", "portelanat", "ceramic", "klinker", "marmura", "piatra naturala", "piatra"] },
      { id: "termosistem", tokens: ["polistiren", "eps", "xps", "termosistem", "vata bazaltica", "vata minerala", "vata"] },
      { id: "lemn", tokens: ["parchet", "lemn"] },
      { id: "gips", tokens: ["gips", "rigips"] },
    ],
  },
  {
    id: "vata",
    tokens: ["vata"],
    subtypes: [
      { id: "bazaltica", tokens: ["bazaltic", "mineral", "roca"] },
      { id: "sticla", tokens: ["sticla"] },
    ],
  },
  {
    id: "polistiren",
    tokens: ["polistiren", "neopor"],
    subtypes: [
      { id: "eps", tokens: ["eps", "expandat"] },
      { id: "xps", tokens: ["xps", "extrudat"] },
    ],
  },
  { id: "osb", tokens: ["osb"] },
  { id: "gips_carton", tokens: ["gips carton", "gips-carton", "gipscarton", "rigips", "placa gips"] },
  { id: "profil", tokens: ["profil"] },
  { id: "tencuiala", tokens: ["tencuiala", "tinci"] },
  { id: "glet", tokens: ["glet"] },
  {
    id: "vopsea",
    tokens: ["vopsea", "email", "lavabila", "lac"],
    subtypes: [
      { id: "interior", tokens: ["interior"] },
      { id: "exterior", tokens: ["exterior", "fatada"] },
    ],
  },
  { id: "amorsa", tokens: ["amorsa", "grund", "primer"] },
  { id: "hidroizolatie", tokens: ["hidroizola", "impermeabiliz"] },
  { id: "membrana", tokens: ["membrana", "bituminoasa"] },
  { id: "sapa", tokens: ["sapa", "autonivelant"] },
  { id: "chit", tokens: ["chit", "fuga", "rosturi"] },
  { id: "silicon", tokens: ["silicon", "etansant", "mastic"] },
  { id: "spuma", tokens: ["spuma"] },
  { id: "bca", tokens: ["bca"] },
  { id: "caramida", tokens: ["caramida", "porotherm", "boltar"] },
  { id: "ciment", tokens: ["ciment"] },
  { id: "mortar", tokens: ["mortar"] },
  { id: "gresie_faianta", tokens: ["gresie", "faianta"] },
  { id: "teava_profil_metalic", tokens: ["teava", "cornier", "platband", "otel beton", "fier beton"] },
  { id: "tabla", tokens: ["tabla"] },
  { id: "plasa", tokens: ["plasa", "rabit"] },
  { id: "folie", tokens: ["folie"] },
  { id: "fotovoltaic", tokens: ["fotovoltaic", "panou solar", "invertor"] },
  { id: "organe_asamblare", tokens: ["surub", "holsurub", "diblu", "ancora", "cui"] },
];

interface FamilyMatch {
  family: FamilyDef;
  position: number;
  subtypeId: string | null;
}

/** Detectează familia primară (cea mai timpurie în text) și subtipul. */
export function detectFamily(text: string): FamilyMatch | null {
  const norm = normalizeText(text);
  let best: { family: FamilyDef; position: number; tokenLength: number } | null = null;

  for (const family of FAMILIES) {
    for (const token of family.tokens) {
      const pos = norm.indexOf(token);
      if (pos < 0) continue;
      // Câștigă apariția cea mai timpurie; la egalitate, fraza mai lungă.
      if (!best || pos < best.position || (pos === best.position && token.length > best.tokenLength)) {
        best = { family, position: pos, tokenLength: token.length };
      }
    }
  }

  if (!best) return null;

  let subtypeId: string | null = null;
  if (best.family.subtypes) {
    let bestSub: { id: string; position: number } | null = null;
    for (const sub of best.family.subtypes) {
      for (const token of sub.tokens) {
        const pos = norm.indexOf(token);
        if (pos < 0) continue;
        if (!bestSub || pos < bestSub.position) bestSub = { id: sub.id, position: pos };
      }
    }
    subtypeId = bestSub?.id ?? null;
  }

  return { family: best.family, position: best.position, subtypeId };
}

// ─── Cerințe numerice ────────────────────────────────────────────────────────

export interface NumericRequirement {
  /** Cheia canonică din fisa_tehnica_specs */
  key: "rezistenta_compresiune" | "conductivitate_termica" | "densitate" | "rezistenta_tractiune";
  label: string;
  value: number;
  unit: string;
  /** "gte" = candidatul trebuie să aibă ≥ valoare; "lte" = ≤ valoare (ex. λ) */
  direction: "gte" | "lte";
}

const NUMERIC_PATTERNS: {
  pattern: RegExp;
  key: NumericRequirement["key"];
  label: string;
  unit: string;
  direction: "gte" | "lte";
}[] = [
  {
    pattern: /(\d+(?:[.,]\d+)?)\s*kpa/i,
    key: "rezistenta_compresiune",
    label: "rezistență la compresiune",
    unit: "kPa",
    direction: "gte",
  },
  {
    pattern: /(?:lambda|λ|conductivitate[a-z\s]*)[^0-9]{0,15}(0[.,]0\d+)|(\b0[.,]0\d+)\s*w\s*\/?\s*mk/i,
    key: "conductivitate_termica",
    label: "conductivitate termică",
    unit: "W/mK",
    direction: "lte",
  },
  {
    pattern: /(\d+(?:[.,]\d+)?)\s*kg\s*\/\s*m(?:3|c|³)/i,
    key: "densitate",
    label: "densitate",
    unit: "kg/m³",
    direction: "gte",
  },
  {
    pattern: /(\d+(?:[.,]\d+)?)\s*n\s*\/\s*mm(?:2|²)/i,
    key: "rezistenta_tractiune",
    label: "rezistență la tracțiune",
    unit: "N/mm²",
    direction: "gte",
  },
];

export function parseNumericRequirements(text: string): NumericRequirement[] {
  const norm = normalizeText(text);
  const out: NumericRequirement[] = [];
  for (const def of NUMERIC_PATTERNS) {
    const m = norm.match(def.pattern);
    if (!m) continue;
    const raw = (m[1] || m[2] || "").replace(",", ".");
    const value = parseFloat(raw);
    if (!Number.isFinite(value)) continue;
    out.push({ key: def.key, label: def.label, value, unit: def.unit, direction: def.direction });
  }
  return out;
}

/**
 * Extrage o valoare numerică dintr-un string de spec ("100 kPa", "CS(10)100",
 * "15-20 kg/m³", "≥0.08 N/mm²"). Pentru intervale întoarce capătul CONSERVATOR
 * în raport cu direcția cerinței (min pentru ≥, max pentru ≤).
 */
export function parseSpecNumber(raw: unknown, direction: "gte" | "lte"): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = String(raw).toLowerCase().replace(/,/g, ".");
  // Format EN 826: "CS(10)100" → 100 kPa
  const cs = s.match(/cs\s*\(\s*10\s*\)\s*(\d+(?:\.\d+)?)/);
  if (cs) return parseFloat(cs[1]);
  s = s.replace(/[≥≤><~±]/g, "");
  const range = s.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/);
  if (range) {
    const a = parseFloat(range[1]);
    const b = parseFloat(range[2]);
    return direction === "gte" ? Math.min(a, b) : Math.max(a, b);
  }
  const single = s.match(/(\d+(?:\.\d+)?)/);
  return single ? parseFloat(single[1]) : null;
}

// ─── Structuri candidat ──────────────────────────────────────────────────────

export interface CandidateProduct {
  id: string;
  cod_intern: string;
  denumire_completa: string;
  pret_lista: number;
  unit: string | null;
  brand?: string | null;
  specifications?: Record<string, unknown> | null;
}

export interface EvaluatedEquivalent {
  product_id: string;
  cod_intern: string;
  denumire_completa: string;
  pret_lista: number;
  unit: string | null;
  justificare: string;
  scor: number;
  /** true dacă scorul a fost plafonat din cauza specs nedocumentate */
  scorPenalized: boolean;
  /** true dacă justificarea vine din fișa tehnică (nu doar din denumire) */
  din_fisa: boolean;
}

function getFtSpecs(p: CandidateProduct): Record<string, unknown> {
  const specs = (p.specifications || {}) as Record<string, unknown>;
  return (specs.fisa_tehnica_specs || {}) as Record<string, unknown>;
}

/** Corpus textual al candidatului: denumire + specs din fișă (pentru tokeni). */
function candidateCorpus(p: CandidateProduct): string {
  const ft = getFtSpecs(p);
  const extras = Array.isArray(ft.alte_specificatii)
    ? (ft.alte_specificatii as { caracteristica?: string; valoare?: string }[])
        .map((s) => `${s.caracteristica ?? ""} ${s.valoare ?? ""}`)
        .join(" ")
    : "";
  return normalizeText(
    [
      p.denumire_completa,
      p.brand || "",
      String(ft.tip_produs ?? ""),
      String(ft.clasa_utilizare ?? ""),
      Array.isArray(ft.utilizare) ? (ft.utilizare as string[]).join(" ") : "",
      Array.isArray(ft.norma_standard) ? (ft.norma_standard as string[]).join(" ") : "",
      extras,
    ].join(" ")
  );
}

/** Valoarea numerică a unui atribut canonic, din fișă sau (fallback) din denumire. */
function candidateNumericValue(
  p: CandidateProduct,
  req: NumericRequirement
): { value: number | null; fromDatasheet: boolean } {
  const ft = getFtSpecs(p);

  // 1. valori_numerice pre-calculate (populate de pipeline-ul de extracție)
  const numKeyMap: Record<NumericRequirement["key"], string> = {
    rezistenta_compresiune: "rezistenta_compresiune_kpa",
    conductivitate_termica: "conductivitate_termica_w_mk",
    densitate: "densitate_kg_m3",
    rezistenta_tractiune: "rezistenta_tractiune_n_mm2",
  };
  const vn = (ft.valori_numerice || {}) as Record<string, unknown>;
  const pre = parseSpecNumber(vn[numKeyMap[req.key]], req.direction);
  if (pre !== null) return { value: pre, fromDatasheet: true };

  // 2. Câmpul canonic string din fișă
  const fromString = parseSpecNumber(ft[req.key], req.direction);
  if (fromString !== null) return { value: fromString, fromDatasheet: true };

  // 3. alte_specificatii — căutăm după unitate în valoare
  if (Array.isArray(ft.alte_specificatii)) {
    const unitNorm = normalizeText(req.unit);
    for (const s of ft.alte_specificatii as { caracteristica?: string; valoare?: string; um?: string }[]) {
      const um = normalizeText(String(s.um ?? ""));
      const val = String(s.valoare ?? "");
      if (um === unitNorm || normalizeText(val).includes(unitNorm)) {
        const n = parseSpecNumber(val, req.direction);
        if (n !== null) return { value: n, fromDatasheet: true };
      }
    }
  }

  // 4. Fallback: denumirea produsului (ex. "Vata bazaltica 100 kPa")
  const nameNorm = normalizeText(p.denumire_completa);
  const unitInName = nameNorm.match(
    new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${normalizeText(req.unit).replace(/[/³²]/g, ".?")}`)
  );
  if (unitInName) return { value: parseFloat(unitInName[1]), fromDatasheet: false };

  return { value: null, fromDatasheet: false };
}

/** Clasa EN a candidatului (C2TE etc.), din fișă sau din denumire. */
function candidateClass(p: CandidateProduct): { value: string | null; fromDatasheet: boolean } {
  const ft = getFtSpecs(p);
  const fromFt = String(ft.clasa_utilizare ?? "").trim();
  if (fromFt) {
    const extracted = extractCaracteristici(fromFt);
    if (extracted.clasa) return { value: extracted.clasa, fromDatasheet: true };
  }
  const fromName = extractCaracteristici(p.denumire_completa);
  if (fromName.clasa) return { value: fromName.clasa, fromDatasheet: false };
  return { value: null, fromDatasheet: false };
}

// ─── Evaluare (gates + scor) ─────────────────────────────────────────────────

/** Scorul maxim al unui candidat cu atribute obligatorii nedocumentate. */
const UNDOCUMENTED_CAP = 45;
/** Scorul minim pentru a apărea în rezultate. */
const MIN_SCORE = 30;

export interface RequestAnalysis {
  familyMatch: FamilyMatch | null;
  numericReqs: NumericRequirement[];
  clasa: string | null;
  tokens: string[];
}

export function analyzeRequest(cerere: string): RequestAnalysis {
  const STOP = new Set(["de", "la", "cu", "pentru", "un", "o", "si", "sau", "din", "pe", "in", "mai", "cel"]);
  const tokens = normalizeText(cerere)
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t) && !/^\d+([.,]\d+)?$/.test(t));
  return {
    familyMatch: detectFamily(cerere),
    numericReqs: parseNumericRequirements(cerere),
    clasa: extractCaracteristici(cerere).clasa ?? null,
    tokens,
  };
}

/**
 * Evaluează candidații pentru o cerere. Candidații care pică o barieră dură
 * sunt eliminați; restul primesc scor 0-100 și justificare.
 */
export function evaluateEquivalents(
  cerere: string,
  candidates: CandidateProduct[],
  maxResults = 10
): EvaluatedEquivalent[] {
  const analysis = analyzeRequest(cerere);
  const { familyMatch, numericReqs, clasa } = analysis;
  const results: EvaluatedEquivalent[] = [];

  for (const p of candidates) {
    if (!p?.denumire_completa) continue;
    const reasons: string[] = [];
    const warnings: string[] = [];
    let score = 0;
    let cap = 100;
    let usedDatasheet = false;

    // ── Bariera 1+2: familie și subtip ──
    if (familyMatch) {
      const candFamily = detectFamily(candidateCorpus(p));
      if (!candFamily || candFamily.family.id !== familyMatch.family.id) {
        continue; // familie diferită sau necunoscută → eliminat
      }
      score += 20;
      reasons.push(`Aceeași familie de produs (${familyMatch.family.id.replace(/_/g, " ")})`);

      if (familyMatch.subtypeId) {
        if (candFamily.subtypeId && candFamily.subtypeId !== familyMatch.subtypeId) {
          continue; // aplicație incompatibilă (ex. gresie vs polistiren) → eliminat
        }
        if (candFamily.subtypeId === familyMatch.subtypeId) {
          score += 15;
          reasons.push(`Aceeași aplicație (${familyMatch.subtypeId})`);
        } else {
          warnings.push("aplicația exactă nu e specificată de produs");
          cap = Math.min(cap, 70);
        }
      }
    }

    // ── Bariera 3a: clasă EN obligatorie ──
    if (clasa) {
      const candClass = candidateClass(p);
      if (candClass.value) {
        if (!classSatisfies(clasa, candClass.value)) {
          continue; // clasă documentată inferioară → eliminat
        }
        score += 25;
        usedDatasheet = usedDatasheet || candClass.fromDatasheet;
        reasons.push(
          candClass.value.toUpperCase() === clasa.toUpperCase()
            ? `Clasă exactă ${candClass.value}`
            : `Clasă superioară ${candClass.value} (cerut min. ${clasa})`
        );
      } else {
        warnings.push(`clasa ${clasa} nu e documentată în fișă`);
        cap = Math.min(cap, UNDOCUMENTED_CAP);
      }
    }

    // ── Bariera 3b: cerințe numerice obligatorii ──
    let numericFailed = false;
    for (const req of numericReqs) {
      const cand = candidateNumericValue(p, req);
      if (cand.value === null) {
        warnings.push(`${req.label} nedocumentată în fișă (cerut ${req.direction === "gte" ? "≥" : "≤"} ${req.value} ${req.unit})`);
        cap = Math.min(cap, UNDOCUMENTED_CAP);
        continue;
      }
      const ok = req.direction === "gte" ? cand.value >= req.value : cand.value <= req.value;
      if (!ok) {
        numericFailed = true; // valoare documentată care nu satisface → eliminat
        break;
      }
      score += 25;
      usedDatasheet = usedDatasheet || cand.fromDatasheet;
      reasons.push(`${req.label}: ${cand.value} ${req.unit} (cerut ${req.direction === "gte" ? "≥" : "≤"} ${req.value})`);
    }
    if (numericFailed) continue;

    // ── Scor de potrivire text (max 40) ──
    const corpus = candidateCorpus(p);
    let matched = 0;
    for (const t of analysis.tokens) {
      if (corpus.includes(t)) matched++;
    }
    if (analysis.tokens.length > 0) {
      score += Math.round((matched / analysis.tokens.length) * 40);
      if (matched > 0) reasons.push(`${matched}/${analysis.tokens.length} termeni regăsiți`);
    }

    const finalScore = Math.max(0, Math.min(cap, score));
    if (finalScore < MIN_SCORE) continue;

    const justificare =
      reasons.join("; ") + (warnings.length > 0 ? ` ⚠️ ${warnings.join("; ")}` : "");

    results.push({
      product_id: p.id,
      cod_intern: p.cod_intern,
      denumire_completa: p.denumire_completa,
      pret_lista: p.pret_lista,
      unit: p.unit,
      justificare,
      scor: finalScore,
      scorPenalized: cap < 100 && score > cap,
      din_fisa: usedDatasheet,
    });
  }

  results.sort((a, b) => b.scor - a.scor);
  return results.slice(0, maxResults);
}
