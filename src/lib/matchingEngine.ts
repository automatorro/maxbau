/**
 * Motor de potrivire produse echivalente
 *
 * Implementează 3 straturi de matching în ordine descrescătoare de prioritate:
 *   1. Potrivire exactă pe cod intern
 *   2. Potrivire pe caracteristici tehnice structurate (JSONB)
 *   3. Potrivire fuzzy full-text pe denumire + similar_cu
 */

export interface ProductForMatching {
  id: string;
  cod_intern: string;
  denumire_completa: string;
  pret_lista: number;
  unit: string | null;
  category_id: string | null;
  consum: string | null;
  ambalare: string | null;
  similar_cu: string | null;
  caracteristici: Record<string, unknown> | null;
}

export interface ClientRequest {
  /** Cererea liberă a clientului, ex: "adeziv flexibil faianta C2T EN 12004" */
  descriere: string;
  /** Tip produs normalizat (opțional), ex: "adeziv", "vopsea", "termoizolatie" */
  tip_produs?: string;
  /** Caracteristici structurate extrase din cerere */
  caracteristici?: Record<string, unknown>;
  /** Cantitate cerută */
  cantitate?: number;
  /** Unitate de măsură */
  unitate?: string;
  /** Suprafață pentru calcul consum automat */
  suprafata?: number;
}

export interface MatchResult {
  product: ProductForMatching;
  /** Scor 0-100 */
  score: number;
  /** Explicație potrivire */
  match_reason: string;
  /** Cantitate calculată pe baza consumului și suprafeței */
  cantitate_calculata?: number;
  /** UM calculată */
  unitate_calculata?: string;
}

// ─── Normalizare text ────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/(?<=\d)x(?=\d)/gi, " x ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Sinonime și termeni corelați ────────────────────────────────────────────

const SYNONYMS: Record<string, string[]> = {
  adeziv: ["adeziv", "adhesive", "clei", "lipici", "mortar adeziv", "mortar"],
  vopsea: ["vopsea", "grunduri", "grund", "email", "lac", "acoperire"],
  tencuiala: ["tencuiala", "tinci", "gleturi", "glet", "strat"],
  termoizolatie: ["termoizolatie", "izolatie", "eps", "vata", "polistiren"],
  hidroizolatie: ["hidroizolatie", "impermeabilizare", "membrana"],
  pardoseala: ["pardoseala", "sapa", "autonivelanta", "screed"],
  chit: ["chit", "rost", "fugă", "fugant", "rosturi"],
  siliconi: ["silicon", "siliconi", "etansant"],
  zugraveli: ["zugraveala", "vopsea lavabila", "lavabil"],
};

function expandKeywords(words: string[]): string[] {
  const expanded = new Set(words);
  for (const word of words) {
    for (const [, syns] of Object.entries(SYNONYMS)) {
      if (syns.includes(word)) {
        syns.forEach((s) => expanded.add(s));
        break;
      }
    }
  }
  return Array.from(expanded);
}

// ─── Extragere caracteristici din text liber ─────────────────────────────────

const CLASS_PATTERNS: { pattern: RegExp; key: string; value: string }[] = [
  // Adezivi ceramică EN 12004
  { pattern: /\bC2TE\b/i,  key: "clasa", value: "C2TE" },
  { pattern: /\bC2T\b/i,   key: "clasa", value: "C2T" },
  { pattern: /\bC2S2\b/i,  key: "clasa", value: "C2S2" },
  { pattern: /\bC2S1\b/i,  key: "clasa", value: "C2S1" },
  { pattern: /\bC2E\b/i,   key: "clasa", value: "C2E" },
  { pattern: /\bC2\b/i,    key: "clasa", value: "C2" },
  { pattern: /\bC1TE\b/i,  key: "clasa", value: "C1TE" },
  { pattern: /\bC1T\b/i,   key: "clasa", value: "C1T" },
  { pattern: /\bC1E\b/i,   key: "clasa", value: "C1E" },
  { pattern: /\bC1\b/i,    key: "clasa", value: "C1" },
  // TS1 / TS2 (sigilanti)
  { pattern: /\bTS2\b/i, key: "clasa", value: "TS2" },
  { pattern: /\bTS1\b/i, key: "clasa", value: "TS1" },
  // Rosturi / fugă
  { pattern: /\bCG2\b/i, key: "clasa", value: "CG2" },
  { pattern: /\bCG1\b/i, key: "clasa", value: "CG1" },
  // Vopsele
  { pattern: /\bB1\b/i, key: "clasa", value: "B1" },
  { pattern: /\bB2\b/i, key: "clasa", value: "B2" },
  // Flexibil / non-flexibil
  { pattern: /\bflexibil\b/i, key: "flexibil", value: "true" },
  { pattern: /\bS1\b/i,       key: "flexibil", value: "true" },
  { pattern: /\bS2\b/i,       key: "flexibil", value: "true" },
  // Standard
  { pattern: /\bEN[\s-]?12004\b/i, key: "standard", value: "EN 12004" },
  { pattern: /\bEN[\s-]?13888\b/i, key: "standard", value: "EN 13888" },
  { pattern: /\bEN[\s-]?998\b/i,   key: "standard", value: "EN 998" },
  { pattern: /\bEN[\s-]?15824\b/i, key: "standard", value: "EN 15824" },
  // Proprietăți extra
  { pattern: /\bbio\b/i,     key: "bio", value: "true" },
  { pattern: /\brapid\b/i,   key: "priza_rapida", value: "true" },
  { pattern: /\brapida\b/i,  key: "priza_rapida", value: "true" },
  { pattern: /\bexterior\b/i, key: "uz", value: "exterior" },
  { pattern: /\binterior\b/i, key: "uz", value: "interior" },
];

export function extractCaracteristici(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const { pattern, key, value } of CLASS_PATTERNS) {
    if (pattern.test(text) && !result[key]) {
      result[key] = value;
    }
  }
  return result;
}

// ─── Ierarhie clase (supraset acceptabil) ─────────────────────────────────────

const CLASS_HIERARCHY: Record<string, string[]> = {
  // Un produs C2T satisface cerința C1T (C2 > C1, T = deformare redusă la cald)
  C1:   ["C1", "C2", "C1T", "C1E", "C2T", "C2E", "C1TE", "C2TE", "C2S1", "C2S2"],
  C2:   ["C2", "C2T", "C2E", "C2TE", "C2S1", "C2S2"],
  C1T:  ["C1T", "C2T", "C1TE", "C2TE"],
  C2T:  ["C2T", "C2TE"],
  C1E:  ["C1E", "C2E", "C1TE", "C2TE"],
  C2E:  ["C2E", "C2TE"],
  C1TE: ["C1TE", "C2TE"],
  C2TE: ["C2TE"],
  C2S1: ["C2S1", "C2S2"],
  C2S2: ["C2S2"],
  TS1:  ["TS1", "TS2"],
  TS2:  ["TS2"],
  CG1:  ["CG1", "CG2"],
  CG2:  ["CG2"],
};

export function classSatisfies(cerut: string, oferit: string): boolean {
  const allowed = CLASS_HIERARCHY[cerut.toUpperCase()];
  if (!allowed) return cerut.toUpperCase() === oferit.toUpperCase();
  return allowed.includes(oferit.toUpperCase());
}

// ─── Scoring principal ───────────────────────────────────────────────────────

function scoreCharacteristici(
  cerute: Record<string, string>,
  oferite: Record<string, unknown>
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  for (const [key, valueCerut] of Object.entries(cerute)) {
    const valueOferit = oferite[key];
    if (!valueOferit) continue;

    if (key === "clasa") {
      if (classSatisfies(valueCerut, String(valueOferit))) {
        const exact = String(valueOferit).toUpperCase() === valueCerut.toUpperCase();
        score += exact ? 40 : 30;
        reasons.push(
          exact
            ? `Clasă exactă ${valueOferit}`
            : `Clasă superioară ${valueOferit} (cerut min. ${valueCerut})`
        );
      } else {
        score -= 20;
      }
    } else if (key === "standard") {
      if (String(valueOferit).includes(valueCerut)) {
        score += 10;
        reasons.push(`Standard ${valueOferit}`);
      }
    } else if (key === "flexibil" && valueCerut === "true") {
      if (valueOferit === true || String(valueOferit) === "true") {
        score += 15;
        reasons.push("Flexibil confirmat");
      }
    } else if (key === "uz") {
      if (String(valueOferit) === valueCerut) {
        score += 10;
        reasons.push(`Uz ${valueCerut}`);
      }
    } else {
      if (String(valueOferit) === valueCerut) {
        score += 5;
        reasons.push(`${key}: ${valueCerut}`);
      }
    }
  }

  return { score, reasons };
}

function scoreTextMatch(
  queryWords: string[],
  product: ProductForMatching
): { score: number; reasons: string[] } {
  const corpus = normalize(
    [
      product.denumire_completa,
      product.cod_intern,
      product.similar_cu || "",
      product.consum || "",
      product.ambalare || "",
      JSON.stringify(product.caracteristici || {}),
    ].join(" ")
  );

  let matched = 0;
  const reasons: string[] = [];

  for (const word of queryWords) {
    if (word.length < 2) continue;
    if (corpus.includes(word)) {
      matched++;
    }
  }

  const score = queryWords.length > 0 ? (matched / queryWords.length) * 30 : 0;
  if (matched > 0) {
    reasons.push(`${matched}/${queryWords.length} termeni potriviți`);
  }

  return { score, reasons };
}

// ─── API principal ───────────────────────────────────────────────────────────

export function findEquivalentProducts(
  request: ClientRequest,
  products: ProductForMatching[],
  maxResults = 3
): MatchResult[] {
  const normalizedDesc = normalize(request.descriere);
  const rawWords = normalizedDesc.split(" ").filter((w) => w.length >= 2);
  const queryWords = expandKeywords(rawWords);

  // Extrage caracteristici din text + merge cu cele structurate
  const extractedChars = extractCaracteristici(request.descriere);
  const requestedChars: Record<string, string> = {
    ...extractedChars,
    ...(request.caracteristici as Record<string, string> | undefined),
  };

  const results: MatchResult[] = [];

  for (const product of products) {
    let totalScore = 0;
    const allReasons: string[] = [];

    // Strat 1: cod intern exact
    if (
      request.descriere.toLowerCase().includes(product.cod_intern.toLowerCase()) ||
      request.tip_produs?.toLowerCase() === product.cod_intern.toLowerCase()
    ) {
      totalScore += 100;
      allReasons.push("Cod intern exact");
    }

    // Strat 2: caracteristici tehnice structurate
    const chars = product.caracteristici as Record<string, unknown> | null ?? {};
    const { score: charScore, reasons: charReasons } = scoreCharacteristici(requestedChars, chars);
    totalScore += charScore;
    allReasons.push(...charReasons);

    // Strat 3: potrivire text fuzzy
    const { score: textScore, reasons: textReasons } = scoreTextMatch(queryWords, product);
    totalScore += textScore;
    allReasons.push(...textReasons);

    // Bonus: produs are date tehnice complete (consum + ambalare)
    if (product.consum) totalScore += 3;
    if (product.ambalare) totalScore += 2;
    if (product.similar_cu) totalScore += 2;

    // Normalizare 0-100
    const normalizedScore = Math.max(0, Math.min(100, totalScore));

    if (normalizedScore >= 20 || allReasons.length > 0) {
      // Calcul cantitate din consum
      let cantitate_calculata: number | undefined;
      let unitate_calculata: string | undefined;

      if (request.suprafata && product.consum) {
        const consumMatch = product.consum.match(/([\d.]+)(?:\s*-\s*([\d.]+))?/);
        if (consumMatch) {
          const consumMin = parseFloat(consumMatch[1]);
          const consumMax = consumMatch[2] ? parseFloat(consumMatch[2]) : consumMin;
          const consumMediu = (consumMin + consumMax) / 2;
          cantitate_calculata = Math.ceil(consumMediu * request.suprafata * 10) / 10;
          unitate_calculata = product.unit || "buc";
        }
      }

      results.push({
        product,
        score: normalizedScore,
        match_reason: allReasons.join("; ") || "Potrivire generală",
        cantitate_calculata,
        unitate_calculata,
      });
    }
  }

  // Sortare descrescătoare după scor, limitat la maxResults
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

// ─── Calcul cantitate din suprafață + consum ─────────────────────────────────

export function calculeazaCantitate(
  suprafata: number,
  consumText: string | null | undefined,
  ambalareText: string | null | undefined
): { cantitate: number; nr_ambalaje?: number; descriere: string } {
  if (!consumText || suprafata <= 0) {
    return { cantitate: 0, descriere: "Consum nedefinit" };
  }

  const consumMatch = consumText.match(/([\d.]+)(?:\s*-\s*([\d.]+))?/);
  if (!consumMatch) return { cantitate: 0, descriere: "Format consum necunoscut" };

  const consumMin = parseFloat(consumMatch[1]);
  const consumMax = consumMatch[2] ? parseFloat(consumMatch[2]) : consumMin;
  const consumMediu = (consumMin + consumMax) / 2;
  const cantitate = Math.ceil(consumMediu * suprafata * 10) / 10;

  let nr_ambalaje: number | undefined;
  let descriere = `${cantitate} (consum ${consumText}/m²)`;

  if (ambalareText) {
    const ambalajMatch = ambalareText.match(/([\d.]+)/);
    if (ambalajMatch) {
      const qAmbalaj = parseFloat(ambalajMatch[1]);
      if (qAmbalaj > 0) {
        nr_ambalaje = Math.ceil(cantitate / qAmbalaj);
        descriere += ` → ${nr_ambalaje} × ${ambalareText}`;
      }
    }
  }

  return { cantitate, nr_ambalaje, descriere };
}
