/**
 * roofGeometry.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor determinist pentru §16 din spec — calcule geometrice acoperiș:
 *   - Validare sumă cote împotriva totalului tipărit pe planșă (principiu
 *     §5.3: NU accepta orbește totalul tipărit; recalculează și cross-check)
 *   - Suprafață înclinată = suprafață orizontală ÷ cos(unghi pantă)
 *   - Verificare uniformitate unghi între versante
 *
 * Modelul AI extrage DOAR date brute (`ExtractedRoofCoveringRaw`); aici sunt
 * TOATE conversiile numerice, testabile cu Vitest. Nici o aritmetică nu se
 * cere modelului.
 */

import type {
  ExtractedRoofCoveringRaw,
} from "@/utils/anthropic";
import type { RoofCoveringResult } from "@/types/planTypes";

/** Toleranță de comparație împotriva totalului tipărit (2%, aceeași ca la
 *  cross-check-ul de footer din rebarAggregator.compareWithFooter). */
const COTE_TOLERANCE = 0.02;

/** Toleranță de comparație pentru „unghiuri identice" (0.1° = pragul sub
 *  care variația de rotunjire pe planșă e ignorată). */
const ANGLE_TOLERANCE_DEG = 0.1;

function round2(n: number): number { return Math.round(n * 100) / 100; }
function toRadians(deg: number): number { return (deg * Math.PI) / 180; }

/**
 * Sumează o listă de cote și compară cu totalul tipărit pe planșă.
 * Returnează totalul recalculat + un mesaj de review dacă diferența > 2%.
 */
export interface CoteValidationResult {
  totalCalc: number;
  matches: boolean;
  reason?: string;
}

export function validateCote(
  segments: number[],
  totalTiparit: number | null,
  axisLabel: "X" | "Y"
): CoteValidationResult {
  const totalCalc = round2(segments.reduce((s, x) => s + x, 0));
  if (totalTiparit == null || totalTiparit <= 0) {
    return {
      totalCalc,
      matches: false,
      reason: `Total tipărit pe axa ${axisLabel} lipsește — folosesc suma calculată (${totalCalc}m) fără validare externă`,
    };
  }
  const diff = Math.abs(totalCalc - totalTiparit);
  const rel = diff / totalTiparit;
  if (rel > COTE_TOLERANCE) {
    return {
      totalCalc,
      matches: false,
      reason: `Sumă cote ${axisLabel} (${totalCalc}m) diferă cu ${(rel * 100).toFixed(1)}% față de totalul tipărit (${totalTiparit}m) — verificare manuală`,
    };
  }
  return { totalCalc, matches: true };
}

/**
 * Verifică uniformitatea unghiurilor citite pe versante. Returnează unghiul
 * canonic (primul citit) + mesaj de review dacă apar valori diferite.
 */
export function pickUniformAngle(
  angles: number[]
): { unghi: number; uniform: boolean; reason?: string } {
  if (angles.length === 0) {
    // Fără unghi tipărit — nu avem cum calcula suprafața înclinată
    return { unghi: 0, uniform: false, reason: "Unghiul de pantă NU e tipărit pe planșă — necesar pentru calcul, introdu manual" };
  }
  const first = angles[0];
  const diverge = angles.find((a) => Math.abs(a - first) > ANGLE_TOLERANCE_DEG);
  if (diverge !== undefined) {
    return {
      unghi: first,
      uniform: false,
      reason: `Unghiuri de pantă diferite detectate: ${[...new Set(angles)].join("°, ")}° — folosesc primul (${first}°) dar necesită verificare`,
    };
  }
  return { unghi: first, uniform: true };
}

/**
 * Motorul principal §16: combină extractul brut al modelului cu validarea
 * cotelor + calculul trigonometric.
 */
export function computeRoofCovering(
  raw: ExtractedRoofCoveringRaw,
  sourceFile: string
): RoofCoveringResult {
  const angleCheck = pickUniformAngle(raw.unghiuriPantaGrade);

  const xValid = validateCote(raw.coteOrizontalaX, raw.totalOrizontalaXTiparit, "X");
  const yValid = validateCote(raw.coteOrizontalaY, raw.totalOrizontalaYTiparit, "Y");

  // Suprafață orizontală = X × Y (aproximare dreptunghi echivalent; pentru
  // formă neregulată (L, T etc.) modelul ar trebui să întoarcă totalul deja
  // ajustat sau vom cădea pe needsManualReview).
  const suprafataOrizontalaMp = round2(xValid.totalCalc * yValid.totalCalc);

  // Suprafață înclinată — formula generală §16.2 pct.2:
  // Pentru pantă uniformă, suprafata_inclinata = suprafata_orizontala / cos(unghi)
  // Aplicabilă indiferent de forma acoperișului (2 ape, 4 ape, L etc).
  const cos = angleCheck.uniform && angleCheck.unghi > 0
    ? Math.cos(toRadians(angleCheck.unghi))
    : 1;
  const suprafataInclinataMp = cos > 0 ? round2(suprafataOrizontalaMp / cos) : suprafataOrizontalaMp;

  const coameDoliiMl = raw.coameDoliiSegmenteMl.length > 0
    ? round2(raw.coameDoliiSegmenteMl.reduce((s, x) => s + x, 0))
    : undefined;

  const reviewReasons: string[] = [];
  if (!angleCheck.uniform && angleCheck.reason) reviewReasons.push(angleCheck.reason);
  if (!xValid.matches && xValid.reason) reviewReasons.push(xValid.reason);
  if (!yValid.matches && yValid.reason) reviewReasons.push(yValid.reason);

  const needsManualReview = reviewReasons.length > 0;

  return {
    sourceFile,
    unghiPantaGrade: angleCheck.unghi,
    suprafataOrizontalaMp,
    suprafataInclinataMp,
    materialInvelitoare: raw.materialInvelitoare,
    coameDoliiMl,
    needsManualReview,
    reviewReason: needsManualReview ? reviewReasons.join(" | ") : undefined,
  };
}
