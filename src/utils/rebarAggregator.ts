/**
 * rebarAggregator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Agregare deterministă a extragerilor de armătură de pe planurile structurale.
 *
 * PRINCIPIU FUNDAMENTAL: modelul Vision AI extrage DOAR date brute (rânduri,
 * adnotări). Toată aritmetica se face aici, în cod, testabil cu Vitest.
 * Vezi CLAUDE.md §8 + specificația internă §5.3 / §5.5 / §6.
 *
 * Bug real găsit în datele sursă și acoperit cu test:
 *   Extras_centuri.pdf — poziția 11 (Ø16, 3×3.40m) are „Lungime totală" GOALĂ,
 *   iar footer-ul „LUNGIMEA PE DIAMETRE" omite complet Ø16. Totalul final e
 *   totuși corect (994 kg). Dacă am citi orb footer-ul, am pierde Ø16.
 *   Regula: RECALCULEZI din rândurile Poz + comparăm cu footer, semnalezi
 *   discrepanțele, NU suprascrii tăcut.
 */

import type {
  RawRebarEntry,
  RebarTotalByMarcaDiametru,
  MarcaOtel,
} from "@/types/planTypes";

// ── Constante — masă pe metru liniar (kg/ml) ─────────────────────────────────
//
// Valorile sunt cele TIPĂRITE pe footer-ul tuturor Extraselor românești
// standard (§5.5). Formula fizică kg/ml ≈ 0.00617 × Ø² e folosită doar ca
// fallback pentru Ø nemapate — în producție preferăm valorile hardcoded ca
// să fim identici cu ce citește proiectantul.

export const STEEL_MASS_PER_METER: Record<number, number> = {
  6:  0.222,
  8:  0.395,
  10: 0.617,
  12: 0.888,
  14: 1.208,
  16: 1.578,
  18: 2.000,
  20: 2.466,
  22: 2.984,
  25: 3.853,
  28: 4.834,
  32: 6.313,
};

/** Fallback teoretic pentru Ø nemapat. Formulă: densitate 7850 kg/m³ × π/4 × Ø²(m²) */
export function theoreticalMassPerMeter(diametruMm: number): number {
  const areaM2 = Math.PI / 4 * Math.pow(diametruMm / 1000, 2);
  return round3(areaM2 * 7850);
}

export function massPerMeterFor(diametruMm: number): number {
  return STEEL_MASS_PER_METER[diametruMm] ?? theoreticalMassPerMeter(diametruMm);
}

// ── Utilități ────────────────────────────────────────────────────────────────

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }

/**
 * Normalizează marca oțelului la cheile canonice folosite în UI/BOM.
 * Modelul poate returna „B 500 C", „BST500", „B500 C" — trebuie să le colapsăm.
 */
export function normalizeMarca(raw: string): MarcaOtel {
  const clean = (raw || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/\./g, "");
  if (/^B500C$/.test(clean) || /^BST500S?$/.test(clean) || /^B500$/.test(clean)) return "B500C";
  if (/^PC52$/.test(clean)) return "PC52";
  if (/^OB37$/.test(clean)) return "OB37";
  return clean || "necunoscut";
}

// ── Validare rând brut ───────────────────────────────────────────────────────

export interface ValidatedEntry extends RawRebarEntry {
  /** Lungime totală recalculată = numarBare × lungimeUnaBara */
  lungimeTotalaCalc: number;
  /** True dacă lungimeTotalaSursa diferă cu > 2% față de lungimeTotalaCalc */
  sourceRowMismatch?: boolean;
}

/**
 * Validează un rând brut înainte de agregare:
 *  - recalculează Lungime totală din numarBare × lungimeUnaBara
 *  - compară cu lungimeTotalaSursa (dacă e furnizat)
 *  - propagă flag-ul de mismatch și mesaj de review
 */
export function validateEntry(e: RawRebarEntry): ValidatedEntry {
  const lungimeTotalaCalc = round2(e.numarBare * e.lungimeUnaBara);
  let sourceRowMismatch = false;
  let reviewReason = e.reviewReason;
  let needsManualReview = e.needsManualReview ?? false;

  if (e.lungimeTotalaSursa != null && e.lungimeTotalaSursa > 0) {
    const diff = Math.abs(lungimeTotalaCalc - e.lungimeTotalaSursa);
    const relative = diff / e.lungimeTotalaSursa;
    if (relative > 0.02) {
      sourceRowMismatch = true;
      needsManualReview = true;
      const extra = `Lungime totală tipărită (${e.lungimeTotalaSursa}m) diferă cu ${(relative * 100).toFixed(1)}% față de N×L calculat (${lungimeTotalaCalc}m)`;
      reviewReason = reviewReason ? `${reviewReason}. ${extra}` : extra;
    }
  }

  return {
    ...e,
    marca: normalizeMarca(e.marca),
    lungimeTotalaCalc,
    sourceRowMismatch,
    needsManualReview,
    reviewReason,
  };
}

// ── Agregare pe (marcă + Ø) ──────────────────────────────────────────────────

/**
 * Grupează rânduri brute (posibil din mai multe fișiere) pe combinația
 * marcă + diametru și calculează totalul în ml și kg.
 */
export function aggregateRebarEntries(
  entries: RawRebarEntry[]
): RebarTotalByMarcaDiametru[] {
  const validated = entries.map(validateEntry);

  // Grupare
  const map = new Map<string, {
    marca: MarcaOtel;
    diametruMm: number;
    totalMl: number;
    sources: Set<string>;
    needsManualReview: boolean;
    reasons: string[];
  }>();

  for (const e of validated) {
    const key = `${e.marca}::${e.diametruMm}`;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        marca: e.marca,
        diametruMm: e.diametruMm,
        totalMl: 0,
        sources: new Set(),
        needsManualReview: false,
        reasons: [],
      };
      map.set(key, bucket);
    }
    // Folosim lungimeTotalaCalc (autoritativă): N × L. Toate testele arată că
    // asta e valoarea care se potrivește cu totalurile proiectantului.
    bucket.totalMl += e.lungimeTotalaCalc;
    bucket.sources.add(e.sourceFile);
    if (e.needsManualReview) {
      bucket.needsManualReview = true;
      if (e.reviewReason) bucket.reasons.push(`${e.sourceFile}#${e.poz ?? "?"}: ${e.reviewReason}`);
    }
  }

  const result: RebarTotalByMarcaDiametru[] = [];
  for (const b of map.values()) {
    const masaPeMetru = massPerMeterFor(b.diametruMm);
    result.push({
      marca: b.marca,
      diametruMm: b.diametruMm,
      totalMl: round2(b.totalMl),
      masaPeMetru,
      totalKg: round2(b.totalMl * masaPeMetru),
      needsManualReview: b.needsManualReview,
      reviewReason: b.reasons.length ? b.reasons.join("; ") : undefined,
      sourceFiles: [...b.sources].sort(),
    });
  }

  // Sort: marcă alfabetic, apoi diametru crescător
  result.sort((a, b) => a.marca.localeCompare(b.marca) || a.diametruMm - b.diametruMm);
  return result;
}

// ── Validare împotriva footer-ului tipărit ───────────────────────────────────

/**
 * Ce a raportat proiectantul în footer-ul unui Extras, per diametru.
 * `totalKg` e opțional (nu toate footerele îl au explicit pe fiecare diametru,
 * unele arată doar totalul global). `totalMl` e cheia de comparație.
 */
export interface FooterDiameterReport {
  diametruMm: number;
  totalMl?: number;
  totalKg?: number;
}

export interface FooterValidationResult {
  matches: boolean;
  discrepancies: Array<{
    diametruMm: number;
    kind: "missing_in_footer" | "missing_in_calc" | "value_mismatch";
    message: string;
    calcMl?: number;
    footerMl?: number;
  }>;
  /** Totalul global din footer, dacă a fost furnizat (kg) */
  footerTotalKg?: number;
  /** Totalul recalculat din rânduri (kg) */
  calcTotalKg: number;
  /** Discrepanța absolută între cele două totaluri (kg) */
  totalDiffKg?: number;
}

/**
 * Compară agregarea per (marcă+Ø) — restrânsă la o singură marcă majoritară,
 * dacă footer-ul e per acea marcă — cu footer-ul tipărit de proiectant.
 *
 * Semnalează:
 *   - Ø prezent în calc dar absent din footer  (BUG REAL: Ø16 din Extras_centuri)
 *   - Ø prezent în footer dar absent din calc  (probabil eroare de citire model)
 *   - Ø prezent în ambele, dar totalMl diferă > 2%
 *   - Discrepanță pe total kg > 2%
 */
export function compareWithFooter(
  totals: RebarTotalByMarcaDiametru[],
  footerReports: FooterDiameterReport[],
  footerTotalKg?: number,
  filterMarca?: MarcaOtel
): FooterValidationResult {
  const relevant = filterMarca
    ? totals.filter((t) => t.marca === filterMarca)
    : totals;

  const calcByD = new Map<number, RebarTotalByMarcaDiametru>();
  for (const t of relevant) {
    // Dacă au ajuns aici două mărci diferite cu același Ø, adunăm ml pentru
    // comparație — footer-ul e per Ø, nu per marcă.
    const existing = calcByD.get(t.diametruMm);
    if (existing) {
      existing.totalMl = round2(existing.totalMl + t.totalMl);
      existing.totalKg = round2(existing.totalKg + t.totalKg);
    } else {
      calcByD.set(t.diametruMm, { ...t });
    }
  }

  const footerByD = new Map<number, FooterDiameterReport>();
  for (const f of footerReports) footerByD.set(f.diametruMm, f);

  const discrepancies: FooterValidationResult["discrepancies"] = [];

  for (const [d, calc] of calcByD.entries()) {
    const footer = footerByD.get(d);
    if (!footer) {
      discrepancies.push({
        diametruMm: d,
        kind: "missing_in_footer",
        message: `Ø${d} apare în rândurile Poz (${calc.totalMl}m calculat) dar lipsește din footer-ul „LUNGIMEA PE DIAMETRE"`,
        calcMl: calc.totalMl,
      });
      continue;
    }
    if (footer.totalMl != null && footer.totalMl > 0) {
      const rel = Math.abs(calc.totalMl - footer.totalMl) / footer.totalMl;
      if (rel > 0.02) {
        discrepancies.push({
          diametruMm: d,
          kind: "value_mismatch",
          message: `Ø${d}: calc ${calc.totalMl}m vs footer ${footer.totalMl}m (${(rel * 100).toFixed(1)}%)`,
          calcMl: calc.totalMl,
          footerMl: footer.totalMl,
        });
      }
    }
  }

  for (const [d, footer] of footerByD.entries()) {
    if (!calcByD.has(d)) {
      discrepancies.push({
        diametruMm: d,
        kind: "missing_in_calc",
        message: `Ø${d} apare în footer-ul tipărit (${footer.totalMl ?? "?"}m) dar nu a fost extras din niciun rând Poz`,
        footerMl: footer.totalMl,
      });
    }
  }

  const calcTotalKg = round2(
    [...calcByD.values()].reduce((s, t) => s + t.totalKg, 0)
  );

  let totalDiffKg: number | undefined;
  if (footerTotalKg != null) {
    totalDiffKg = round2(Math.abs(calcTotalKg - footerTotalKg));
    const rel = totalDiffKg / footerTotalKg;
    if (rel > 0.02 && !discrepancies.some((d) => d.kind === "missing_in_footer")) {
      // Discrepanță pe total, dar nu e explicată de niciun Ø lipsă — adaug o notă
      discrepancies.push({
        diametruMm: 0,
        kind: "value_mismatch",
        message: `Total kg: calc ${calcTotalKg} vs footer ${footerTotalKg} (diferență ${totalDiffKg} kg, ${(rel * 100).toFixed(1)}%)`,
      });
    }
  }

  return {
    matches: discrepancies.length === 0,
    discrepancies,
    footerTotalKg,
    calcTotalKg,
    totalDiffKg,
  };
}

/**
 * Aplică rezultatul unei validări de footer înapoi peste totaluri: setează
 * needsManualReview + reviewReason pentru diametrele afectate. Returnează o
 * copie nouă a listei (nu mutează input-ul).
 */
export function applyFooterValidation(
  totals: RebarTotalByMarcaDiametru[],
  validation: FooterValidationResult
): RebarTotalByMarcaDiametru[] {
  if (validation.matches) return totals;

  const bySize = new Map<number, string[]>();
  for (const d of validation.discrepancies) {
    if (d.diametruMm === 0) continue;
    if (!bySize.has(d.diametruMm)) bySize.set(d.diametruMm, []);
    bySize.get(d.diametruMm)!.push(d.message);
  }

  return totals.map((t) => {
    const msgs = bySize.get(t.diametruMm);
    if (!msgs) return t;
    const existing = t.reviewReason ? [t.reviewReason] : [];
    return {
      ...t,
      needsManualReview: true,
      reviewReason: [...existing, ...msgs].join("; "),
    };
  });
}
