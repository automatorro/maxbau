import { describe, expect, it } from "vitest";
import {
  analyzeRequest,
  detectFamily,
  evaluateEquivalents,
  normalizeCerere,
  parseNumericRequirements,
  parseSpecNumber,
  type CandidateProduct,
} from "@/lib/equivalentsEngine";

// ─── Helpers ────────────────────────────────────────────────────────────────

let idCounter = 0;
function product(
  denumire: string,
  specs?: Record<string, unknown>
): CandidateProduct {
  idCounter++;
  return {
    id: `id-${idCounter}`,
    cod_intern: `COD${idCounter}`,
    denumire_completa: denumire,
    pret_lista: 100,
    unit: "buc",
    brand: null,
    specifications: specs ? { fisa_tehnica_specs: specs } : null,
  };
}

function names(results: { denumire_completa: string }[]): string[] {
  return results.map((r) => r.denumire_completa);
}

// ─── normalizeCerere ────────────────────────────────────────────────────────

describe("normalizeCerere", () => {
  it("produce aceeași cheie pentru reformulări ale aceleiași cereri", () => {
    expect(normalizeCerere("adeziv C2TE pentru gresie")).toBe(
      normalizeCerere("adeziv gresie c2te")
    );
  });

  it("ignoră diacriticele", () => {
    expect(normalizeCerere("vată bazaltică")).toBe(normalizeCerere("vata bazaltica"));
  });
});

// ─── detectFamily ───────────────────────────────────────────────────────────

describe("detectFamily", () => {
  it("detectează familia primară după prima apariție în text", () => {
    expect(detectFamily("Adeziv vata bazaltica 25kg")?.family.id).toBe("adeziv");
    expect(detectFamily("Vata bazaltica 10cm")?.family.id).toBe("vata");
  });

  it("tratează 'mortar adeziv' ca adeziv, nu ca mortar", () => {
    expect(detectFamily("Mortar adeziv flexibil C2TE")?.family.id).toBe("adeziv");
  });

  it("detectează subtipul de aplicație la adezivi", () => {
    expect(detectFamily("adeziv flexibil gresie")?.subtypeId).toBe("ceramic");
    expect(detectFamily("adeziv polistiren EPS")?.subtypeId).toBe("termosistem");
  });

  it("returnează null pentru text fără familie cunoscută", () => {
    expect(detectFamily("xyzabc 123")).toBeNull();
  });
});

// ─── parseNumericRequirements / parseSpecNumber ─────────────────────────────

describe("cerinte numerice", () => {
  it("extrage kPa din cerere", () => {
    const reqs = parseNumericRequirements("vata bazaltica rezistenta la compresiune 2 kPa");
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ key: "rezistenta_compresiune", value: 2, direction: "gte" });
  });

  it("extrage conductivitate (directia lte)", () => {
    const reqs = parseNumericRequirements("polistiren lambda 0.032");
    expect(reqs[0]).toMatchObject({ key: "conductivitate_termica", value: 0.032, direction: "lte" });
  });

  it("parsează CS(10)100 ca 100", () => {
    expect(parseSpecNumber("CS(10)100", "gte")).toBe(100);
  });

  it("parsează intervale conservator", () => {
    expect(parseSpecNumber("15-20 kg/m³", "gte")).toBe(15);
    expect(parseSpecNumber("0.032-0.035 W/mK", "lte")).toBe(0.035);
  });
});

// ─── Scenariile utilizatorului: bariere dure ────────────────────────────────

describe("bariera de subtip: adeziv gresie vs adeziv polistiren", () => {
  const candidates = [
    product("Adeziv flexibil gresie si faianta C2TE 25kg"),
    product("Adeziv polistiren EPS termosistem 25kg"),
    product("Adeziv universal C2 25kg"),
    product("Placa OSB3 2500x1250x18mm"),
  ];

  it("nu returnează adeziv de polistiren la cerere de adeziv de gresie", () => {
    const results = evaluateEquivalents("adeziv flexibil de gresie", candidates);
    const found = names(results);
    expect(found).toContain("Adeziv flexibil gresie si faianta C2TE 25kg");
    expect(found).not.toContain("Adeziv polistiren EPS termosistem 25kg");
    expect(found).not.toContain("Placa OSB3 2500x1250x18mm");
  });

  it("adezivul fara aplicatie explicita e acceptat dar sub cel cu aplicatie exacta", () => {
    const results = evaluateEquivalents("adeziv flexibil de gresie", candidates);
    const exact = results.find((r) => r.denumire_completa.includes("gresie"));
    const universal = results.find((r) => r.denumire_completa.includes("universal"));
    expect(exact).toBeDefined();
    if (universal) {
      expect(exact!.scor).toBeGreaterThan(universal.scor);
    }
  });
});

describe("bariera de familie: vata vs OSB / fotovoltaice", () => {
  const candidates = [
    product("Vata bazaltica 10cm", {
      rezistenta_compresiune: "30 kPa",
      densitate: "100 kg/m³",
    }),
    product("Vata minerala de sticla rulou 15cm"),
    product("Placa OSB3 2500x1250x18mm"),
    product("Panou fotovoltaic monocristalin 450W"),
    product("Adeziv vata bazaltica 25kg"),
  ];

  it("cererea de vata cu compresiune nu returnează niciodată OSB sau fotovoltaice", () => {
    const results = evaluateEquivalents("vata cu rezistenta la compresiune 2 kPa", candidates);
    const found = names(results);
    expect(found).not.toContain("Placa OSB3 2500x1250x18mm");
    expect(found).not.toContain("Panou fotovoltaic monocristalin 450W");
    expect(found).not.toContain("Adeziv vata bazaltica 25kg"); // e adeziv, nu vata
  });

  it("vata cu compresiune documentată care satisface cerința primește scor întreg", () => {
    const results = evaluateEquivalents("vata bazaltica rezistenta la compresiune 2 kPa", candidates);
    const documented = results.find((r) => r.denumire_completa === "Vata bazaltica 10cm");
    expect(documented).toBeDefined();
    expect(documented!.scor).toBeGreaterThan(45);
    expect(documented!.din_fisa).toBe(true);
  });

  it("vata fără compresiune documentată e plafonată la ≤45 cu avertisment", () => {
    const results = evaluateEquivalents("vata rezistenta la compresiune 2 kPa", candidates);
    const undocumented = results.find((r) =>
      r.denumire_completa.includes("sticla")
    );
    if (undocumented) {
      expect(undocumented.scor).toBeLessThanOrEqual(45);
      expect(undocumented.justificare).toContain("⚠️");
    }
  });

  it("compresiune documentată sub cerință → eliminat", () => {
    const weak = product("Vata bazaltica fatada 5cm", { rezistenta_compresiune: "1 kPa" });
    const results = evaluateEquivalents(
      "vata bazaltica rezistenta la compresiune 2 kPa",
      [weak]
    );
    expect(results).toHaveLength(0);
  });
});

describe("bariera de clasa EN", () => {
  it("C2TE satisface cererea C1T (clasa superioară)", () => {
    const results = evaluateEquivalents("adeziv gresie C1T", [
      product("Adeziv gresie flexibil C2TE 25kg"),
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].justificare).toContain("C2TE");
  });

  it("C1 documentat NU satisface cererea C2T → eliminat", () => {
    const results = evaluateEquivalents("adeziv gresie C2T", [
      product("Adeziv gresie C1 25kg"),
    ]);
    expect(results).toHaveLength(0);
  });

  it("clasa preluată din fișa tehnică, nu doar din denumire", () => {
    const results = evaluateEquivalents("adeziv gresie C2", [
      product("Adeziv gresie ProFix 25kg", { clasa_utilizare: "C2TE" }),
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].din_fisa).toBe(true);
  });
});

describe("specs din alte_specificatii", () => {
  it("găsește valoarea numerică în lista liberă de specificații", () => {
    const results = evaluateEquivalents("vata bazaltica 50 kg/m3", [
      product("Vata bazaltica acoperis 10cm", {
        alte_specificatii: [
          { caracteristica: "Densitate nominală", valoare: "140", um: "kg/m³" },
        ],
      }),
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].din_fisa).toBe(true);
    expect(results[0].scor).toBeGreaterThan(45);
  });
});

describe("analyzeRequest", () => {
  it("compune familia, clasa și cerințele numerice", () => {
    const a = analyzeRequest("adeziv flexibil gresie C2TE consum mic");
    expect(a.familyMatch?.family.id).toBe("adeziv");
    expect(a.familyMatch?.subtypeId).toBe("ceramic");
    expect(a.clasa).toBe("C2TE");
  });
});
