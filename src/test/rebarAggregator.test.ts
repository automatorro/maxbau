import { describe, it, expect } from "vitest";
import {
  STEEL_MASS_PER_METER,
  theoreticalMassPerMeter,
  massPerMeterFor,
  normalizeMarca,
  validateEntry,
  aggregateRebarEntries,
  compareWithFooter,
  applyFooterValidation,
} from "../utils/rebarAggregator";
import type { RawRebarEntry } from "../types/planTypes";

// Helper: constructor scurt pentru rânduri brute în teste
const R = (
  overrides: Partial<RawRebarEntry> = {}
): RawRebarEntry => ({
  sourceFile: "test.pdf",
  sourceType: "extras_table",
  poz: "1",
  marca: "B500C",
  diametruMm: 12,
  tipBara: "dreapta",
  numarBare: 10,
  lungimeUnaBara: 5.0,
  ...overrides,
});

describe("STEEL_MASS_PER_METER — valorile de pe planurile reale", () => {
  it("conține exact valorile tipărite pe extraselor primite", () => {
    expect(STEEL_MASS_PER_METER[6]).toBe(0.222);
    expect(STEEL_MASS_PER_METER[8]).toBe(0.395);
    expect(STEEL_MASS_PER_METER[10]).toBe(0.617);
    expect(STEEL_MASS_PER_METER[12]).toBe(0.888);
    expect(STEEL_MASS_PER_METER[14]).toBe(1.208);
    expect(STEEL_MASS_PER_METER[16]).toBe(1.578);
    expect(STEEL_MASS_PER_METER[20]).toBe(2.466);
  });

  it("theoreticalMassPerMeter aproximează bine formula fizică", () => {
    // pentru Ø12: π/4 × 0.012² × 7850 ≈ 0.888
    expect(theoreticalMassPerMeter(12)).toBeCloseTo(0.888, 2);
  });

  it("massPerMeterFor: hardcoded când există, teoretic ca fallback", () => {
    expect(massPerMeterFor(12)).toBe(0.888);
    expect(massPerMeterFor(13)).toBeCloseTo(theoreticalMassPerMeter(13), 4);
  });
});

describe("normalizeMarca", () => {
  it("colapsează variantele scrise ale B500C", () => {
    expect(normalizeMarca("B 500 C")).toBe("B500C");
    expect(normalizeMarca("BST500S")).toBe("B500C");
    expect(normalizeMarca("BST500")).toBe("B500C");
    expect(normalizeMarca("b500")).toBe("B500C");
  });
  it("recunoaște PC52 și OB37", () => {
    expect(normalizeMarca("PC 52")).toBe("PC52");
    expect(normalizeMarca("OB 37")).toBe("OB37");
  });
  it("string necunoscut → uppercase compactat", () => {
    expect(normalizeMarca("B 550 X")).toBe("B550X");
  });
  it("gol → necunoscut", () => {
    expect(normalizeMarca("")).toBe("necunoscut");
  });
});

describe("validateEntry", () => {
  it("recalculează lungime totală", () => {
    const v = validateEntry(R({ numarBare: 24, lungimeUnaBara: 4.45 }));
    expect(v.lungimeTotalaCalc).toBe(106.8);
  });

  it("flag mismatch dacă sursa diferă > 2%", () => {
    const v = validateEntry(
      R({ numarBare: 10, lungimeUnaBara: 5.0, lungimeTotalaSursa: 55 })
    );
    expect(v.sourceRowMismatch).toBe(true);
    expect(v.needsManualReview).toBe(true);
    expect(v.reviewReason).toMatch(/diferă/);
  });

  it("nu flag dacă sursa e în toleranța de 2%", () => {
    const v = validateEntry(
      R({ numarBare: 10, lungimeUnaBara: 5.0, lungimeTotalaSursa: 50.5 })
    );
    expect(v.sourceRowMismatch).toBeFalsy();
    expect(v.needsManualReview).toBe(false);
  });

  it("normalizează marca în timpul validării", () => {
    const v = validateEntry(R({ marca: "B 500 C" as any }));
    expect(v.marca).toBe("B500C");
  });
});

describe("aggregateRebarEntries", () => {
  it("agregă corect două rânduri identice (marcă+Ø)", () => {
    const totals = aggregateRebarEntries([
      R({ poz: "1a", numarBare: 3, lungimeUnaBara: 6.20 }),  // 18.60 ml
      R({ poz: "1a", numarBare: 3, lungimeUnaBara: 6.20 }),  // 18.60 ml
    ]);
    expect(totals).toHaveLength(1);
    expect(totals[0].diametruMm).toBe(12);
    expect(totals[0].totalMl).toBe(37.2);
    expect(totals[0].totalKg).toBe(round2(37.2 * 0.888));
  });

  it("separă mărci diferite pe același Ø (B500C vs OB37)", () => {
    const totals = aggregateRebarEntries([
      R({ marca: "B500C", diametruMm: 12, numarBare: 10, lungimeUnaBara: 5 }),
      R({ marca: "OB37",  diametruMm: 12, numarBare: 20, lungimeUnaBara: 3 }),
    ]);
    expect(totals).toHaveLength(2);
    const b500 = totals.find((t) => t.marca === "B500C")!;
    const ob37 = totals.find((t) => t.marca === "OB37")!;
    expect(b500.totalMl).toBe(50);
    expect(ob37.totalMl).toBe(60);
  });

  it("propagă flag needsManualReview la nivel de bucket", () => {
    const totals = aggregateRebarEntries([
      R({ poz: "1a", numarBare: 3, lungimeUnaBara: 6.20 }),
      R({
        poz: "1b",
        numarBare: 3,
        lungimeUnaBara: 6.20,
        lungimeTotalaSursa: 10, // 18.60 vs 10 → mismatch
      }),
    ]);
    expect(totals[0].needsManualReview).toBe(true);
    expect(totals[0].reviewReason).toMatch(/1b/);
  });

  it("colectează toate fișierele sursă (pentru trasabilitate per proiect)", () => {
    const totals = aggregateRebarEntries([
      R({ sourceFile: "Extras_fundatii.pdf" }),
      R({ sourceFile: "Extras_centuri.pdf" }),
      R({ sourceFile: "Extras_fundatii.pdf" }),
    ]);
    expect(totals[0].sourceFiles).toEqual(["Extras_centuri.pdf", "Extras_fundatii.pdf"]);
  });

  it("sortare stabilă: marcă alfabetic, apoi Ø crescător", () => {
    const totals = aggregateRebarEntries([
      R({ marca: "OB37", diametruMm: 8 }),
      R({ marca: "B500C", diametruMm: 14 }),
      R({ marca: "B500C", diametruMm: 8 }),
    ]);
    expect(totals.map((t) => `${t.marca}${t.diametruMm}`)).toEqual([
      "B500C8", "B500C14", "OB378",
    ]);
  });

  it("scenariu realist: fundații — un singur rând etrieri agregat", () => {
    // Extras_fundatii.pdf poz.2: Ø8 × 548 buc × 1.15m = 630.2 ml
    const totals = aggregateRebarEntries([
      R({
        sourceFile: "Extras_fundatii.pdf",
        poz: "2",
        marca: "B500C",
        diametruMm: 8,
        tipBara: "etrier",
        numarBare: 548,
        lungimeUnaBara: 1.15,
      }),
    ]);
    expect(totals[0].totalMl).toBe(630.2);
    // 630.2 × 0.395 = 248.929
    expect(totals[0].totalKg).toBeCloseTo(248.93, 1);
  });
});

describe("compareWithFooter — bug real Ø16 din Extras_centuri.pdf", () => {
  // Scenariu reprodus exact din spec §5.3:
  //   footer tipărit: Ø8 = 210 kg, Ø14 = 767 kg (Ø16 lipsește)
  //   TOTAL kg tipărit: 994
  //   În rândurile Poz, Ø16 EXISTĂ (poz 11: 3×3.40m = 10.2m, ~16.1 kg)
  //   Diferența 994 - (210+767) = 17 ≈ 16.1 → Ø16 e inclus în TOTAL, dar
  //   omis din defalcarea pe diametru.

  it("semnalează Ø prezent în calc dar absent din footer", () => {
    const totals = aggregateRebarEntries([
      // Simulez rândul Poz 11 (Ø16, 3×3.40)
      R({
        sourceFile: "Extras_centuri.pdf",
        poz: "11",
        marca: "B500C",
        diametruMm: 16,
        numarBare: 3,
        lungimeUnaBara: 3.40,
      }),
      // Simulez celelalte rânduri agregate: Ø8 (~210/0.395 ≈ 531.6 ml)
      R({
        sourceFile: "Extras_centuri.pdf",
        poz: "2",
        marca: "B500C",
        diametruMm: 8,
        numarBare: 100,
        lungimeUnaBara: 5.316,
      }),
      // Ø14: ~767/1.208 ≈ 634.9 ml
      R({
        sourceFile: "Extras_centuri.pdf",
        poz: "1",
        marca: "B500C",
        diametruMm: 14,
        numarBare: 100,
        lungimeUnaBara: 6.349,
      }),
    ]);

    const validation = compareWithFooter(
      totals,
      [
        { diametruMm: 8,  totalMl: 531.6 },
        { diametruMm: 14, totalMl: 634.9 },
        // Ø16 lipsește intenționat din footer — asta e bug-ul real
      ],
      994 // totalul kg tipărit
    );

    expect(validation.matches).toBe(false);
    const missing = validation.discrepancies.find(
      (d) => d.kind === "missing_in_footer" && d.diametruMm === 16
    );
    expect(missing).toBeDefined();
    expect(missing!.message).toMatch(/Ø16.*lipsește din footer/);
  });

  it("nu flag nimic când footer-ul e complet și corect", () => {
    const totals = aggregateRebarEntries([
      R({ diametruMm: 8, numarBare: 100, lungimeUnaBara: 5.316 }),
      R({ diametruMm: 14, numarBare: 100, lungimeUnaBara: 6.349 }),
    ]);
    const validation = compareWithFooter(totals, [
      { diametruMm: 8,  totalMl: 531.6 },
      { diametruMm: 14, totalMl: 634.9 },
    ]);
    expect(validation.matches).toBe(true);
    expect(validation.discrepancies).toHaveLength(0);
  });

  it("flag value_mismatch pe diametru cu diferență > 2%", () => {
    const totals = aggregateRebarEntries([
      R({ diametruMm: 12, numarBare: 10, lungimeUnaBara: 5 }),
    ]);
    const v = compareWithFooter(totals, [{ diametruMm: 12, totalMl: 40 }]);
    expect(v.matches).toBe(false);
    expect(v.discrepancies[0].kind).toBe("value_mismatch");
  });

  it("flag missing_in_calc când footer are Ø ce nu apare în rânduri", () => {
    const totals = aggregateRebarEntries([
      R({ diametruMm: 12, numarBare: 10, lungimeUnaBara: 5 }),
    ]);
    const v = compareWithFooter(totals, [
      { diametruMm: 12, totalMl: 50 },
      { diametruMm: 20, totalMl: 30 }, // nu-i în calc
    ]);
    expect(v.matches).toBe(false);
    expect(v.discrepancies.some(
      (d) => d.kind === "missing_in_calc" && d.diametruMm === 20
    )).toBe(true);
  });
});

describe("applyFooterValidation", () => {
  it("marchează totalurile afectate cu needsManualReview + motiv", () => {
    const totals = aggregateRebarEntries([
      R({ diametruMm: 16, numarBare: 3, lungimeUnaBara: 3.40 }),
    ]);
    expect(totals[0].needsManualReview).toBe(false);

    const v = compareWithFooter(totals, [], undefined);
    const flagged = applyFooterValidation(totals, v);
    expect(flagged[0].needsManualReview).toBe(true);
    expect(flagged[0].reviewReason).toMatch(/Ø16.*lipsește/);
  });

  it("nu mutează lista originală", () => {
    const totals = aggregateRebarEntries([
      R({ diametruMm: 16, numarBare: 3, lungimeUnaBara: 3.40 }),
    ]);
    const v = compareWithFooter(totals, []);
    applyFooterValidation(totals, v);
    expect(totals[0].needsManualReview).toBe(false); // original neatins
  });

  it("returnează lista neschimbată dacă validarea e OK", () => {
    const totals = aggregateRebarEntries([
      R({ diametruMm: 12, numarBare: 10, lungimeUnaBara: 5 }),
    ]);
    const v = compareWithFooter(totals, [{ diametruMm: 12, totalMl: 50 }]);
    expect(v.matches).toBe(true);
    expect(applyFooterValidation(totals, v)).toBe(totals);
  });
});

// Utility pentru teste — replică internă
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
