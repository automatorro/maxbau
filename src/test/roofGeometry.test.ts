import { describe, it, expect } from "vitest";
import { validateCote, pickUniformAngle, computeRoofCovering } from "../utils/roofGeometry";
import type { ExtractedRoofCoveringRaw } from "../utils/anthropic";

describe("validateCote", () => {
  it("suma cotelor se potrivește exact cu totalul tipărit", () => {
    // Cazul real A02: 0.825+3.40+3.20+2.25+2.25+2.85+1.40+0.825 = 17.00
    const segments = [0.825, 3.40, 3.20, 2.25, 2.25, 2.85, 1.40, 0.825];
    const result = validateCote(segments, 17.00, "X");
    expect(result.totalCalc).toBe(17.0);
    expect(result.matches).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("acceptă diferență ≤2% (rotunjire)", () => {
    const segments = [5.00, 5.00];
    const result = validateCote(segments, 10.05, "X"); // 0.5% diferență
    expect(result.matches).toBe(true);
  });

  it("flag mismatch dacă diferența > 2%", () => {
    const segments = [5.00, 5.00];
    const result = validateCote(segments, 12.00, "X"); // 20% diferență
    expect(result.matches).toBe(false);
    expect(result.reason).toMatch(/diferă/);
  });

  it("total lipsă → matches=false + reason explicit", () => {
    const result = validateCote([3.0, 4.0], null, "Y");
    expect(result.totalCalc).toBe(7.0);
    expect(result.matches).toBe(false);
    expect(result.reason).toMatch(/lipsește/);
  });
});

describe("pickUniformAngle", () => {
  it("unghi unic → uniform=true", () => {
    const result = pickUniformAngle([20.00]);
    expect(result.unghi).toBe(20);
    expect(result.uniform).toBe(true);
  });

  it("mai multe versante cu același unghi → uniform=true", () => {
    const result = pickUniformAngle([20.00, 20.00, 20.00, 20.00]);
    expect(result.uniform).toBe(true);
  });

  it("diferență < 0.1° (rotunjire) → uniform=true", () => {
    const result = pickUniformAngle([20.00, 20.05]);
    expect(result.uniform).toBe(true);
  });

  it("versante cu unghiuri diferite → uniform=false + reason", () => {
    const result = pickUniformAngle([20.00, 30.00, 20.00]);
    expect(result.uniform).toBe(false);
    expect(result.reason).toMatch(/Unghiuri de pantă diferite/);
    expect(result.unghi).toBe(20); // primul citit
  });

  it("listă goală → 0 + reason", () => {
    const result = pickUniformAngle([]);
    expect(result.unghi).toBe(0);
    expect(result.uniform).toBe(false);
    expect(result.reason).toMatch(/NU e tipărit/);
  });
});

describe("computeRoofCovering — scenariu realist A02 (unghi 20°)", () => {
  const raw: ExtractedRoofCoveringRaw = {
    titluPlansa: "PLAN ÎNVELITOARE",
    unghiuriPantaGrade: [20.00],
    coteOrizontalaX: [0.825, 3.40, 3.20, 2.25, 2.25, 2.85, 1.40, 0.825],
    totalOrizontalaXTiparit: 17.00,
    coteOrizontalaY: [10.00],
    totalOrizontalaYTiparit: 10.00,
    materialInvelitoare: "țiglă ceramică vișinie",
    coameDoliiSegmenteMl: [3.03, 4.50],
    observatii: "",
  };

  it("calculează suprafață înclinată = orizontală / cos(20°)", () => {
    const result = computeRoofCovering(raw, "A02_Plan_Invelitoare.pdf");
    expect(result.suprafataOrizontalaMp).toBe(170.0);       // 17 × 10
    // 170 / cos(20°) ≈ 170 / 0.9397 ≈ 180.90
    expect(result.suprafataInclinataMp).toBeCloseTo(180.90, 1);
    expect(result.unghiPantaGrade).toBe(20);
    expect(result.materialInvelitoare).toBe("țiglă ceramică vișinie");
    expect(result.needsManualReview).toBe(false);
  });

  it("agregă coame/dolii ca ml total", () => {
    const result = computeRoofCovering(raw, "A02.pdf");
    expect(result.coameDoliiMl).toBe(7.53); // 3.03 + 4.50
  });

  it("flag review pe unghiuri neuniforme", () => {
    const bad: ExtractedRoofCoveringRaw = {
      ...raw,
      unghiuriPantaGrade: [20.00, 30.00],
    };
    const result = computeRoofCovering(bad, "A02.pdf");
    expect(result.needsManualReview).toBe(true);
    expect(result.reviewReason).toMatch(/Unghiuri de pantă diferite/);
  });

  it("flag review pe sumă cote ≠ total tipărit", () => {
    const bad: ExtractedRoofCoveringRaw = {
      ...raw,
      totalOrizontalaXTiparit: 20.00, // real e 17, tipărit 20
    };
    const result = computeRoofCovering(bad, "A02.pdf");
    expect(result.needsManualReview).toBe(true);
    expect(result.reviewReason).toMatch(/Sumă cote X/);
  });

  it("cos(0)=1 dacă unghi 0 → suprafață înclinată = orizontală", () => {
    const flat: ExtractedRoofCoveringRaw = {
      ...raw,
      unghiuriPantaGrade: [],  // fără unghi → tratat ca 0 (fallback pe orizontal)
    };
    const result = computeRoofCovering(flat, "A02.pdf");
    expect(result.suprafataInclinataMp).toBe(170.0);
    expect(result.needsManualReview).toBe(true); // fără unghi = review
  });
});
