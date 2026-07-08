/**
 * floorPlanParser.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Unit tests pentru funcțiile pure din floorPlanParser.ts.
 * Rulare: npm run test sau npx vitest run
 */

import { describe, it, expect, vi } from "vitest";

// Mock pdfjs-dist înainte de orice import din floorPlanParser.
// pdfjs accesează DOMMatrix la inițializare — API care nu există în jsdom.
// Testele acoperă funcții pure care nu apelează pdfjs direct.
vi.mock("pdfjs-dist", () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: "" },
}));
import {
  applyGlyphCorrections,
  detectIsFloorPlan,
  detectRoomBlocks,
  parseRoomBlock,
  extractFloorMaterial,
  extractWallFinish,
  applyMandatoryAttributePenalty,
  roomBlocksToExtractedItems,
  type PdfTextItem,
} from "../utils/floorPlanParser";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Creează un PdfTextItem minimal pentru teste */
function item(
  str: string,
  x = 0,
  y = 0,
  angleDeg = 0
): PdfTextItem {
  return { str, x, y, w: str.length * 6, h: 12, angleDeg, font: "F1" };
}

// ─── applyGlyphCorrections ────────────────────────────────────────────────────

describe("applyGlyphCorrections", () => {
  it("corectează 'Pð' → 'm²'", () => {
    expect(applyGlyphCorrections("S=41.90 Pð")).toBe("S=41.90 m²");
  });

  it("corectează corupția antiderapantă Windows-1252 → Latin-1", () => {
    expect(
      applyGlyphCorrections("gresie DQWLGHUDSDQWă de interior")
    ).toBe("gresie antiderapantă de interior");
  });

  it("nu modifică textul normal", () => {
    expect(applyGlyphCorrections("gresie antiderapantă de interior")).toBe(
      "gresie antiderapantă de interior"
    );
  });

  it("corectează corupție P² → m²", () => {
    expect(applyGlyphCorrections("S=23.50 P²")).toBe("S=23.50 m²");
  });

  it("gestionează multiple corupții în același string", () => {
    const corrupted = "S=15.20 Pð gresie DQWLGHUDSDQWă";
    const corrected = applyGlyphCorrections(corrupted);
    expect(corrected).toContain("m²");
    expect(corrected).toContain("antiderapantă");
  });
});

// ─── detectIsFloorPlan ────────────────────────────────────────────────────────

describe("detectIsFloorPlan", () => {
  it("detectează plan arhitectural cu ≥2 S=\\d și keyword gresie", () => {
    const items: PdfTextItem[] = [
      item("G.S. FETE", 100, 500),
      item("S=8.20", 100, 480),
      item("gresie antiderapantă de interior", 100, 460),
      item("SALA CLASA 1", 400, 500),
      item("S=41.90", 400, 480),
      item("gresie antiderapantă de interior", 400, 460),
    ];
    expect(detectIsFloorPlan(items)).toBe(true);
  });

  it("nu detectează ca plan dacă lipsește keyword material", () => {
    const items: PdfTextItem[] = [
      item("S=8.20", 100, 480),
      item("S=41.90", 400, 480),
      // fără keyword gresie/parchet etc.
    ];
    expect(detectIsFloorPlan(items)).toBe(false);
  });

  it("nu detectează ca plan dacă are un singur S=\\d", () => {
    const items: PdfTextItem[] = [
      item("S=8.20", 100, 480),
      item("gresie antiderapantă de interior", 100, 460),
      item("vopsea pe baza de ulei", 200, 460),
    ];
    expect(detectIsFloorPlan(items)).toBe(false);
  });

  it("detectează cu keyword 'faianță'", () => {
    const items: PdfTextItem[] = [
      item("S=10.00", 100, 500),
      item("faianță h=1.20m", 100, 480),
      item("S=20.00", 200, 500),
      item("gresie", 200, 480),
    ];
    expect(detectIsFloorPlan(items)).toBe(true);
  });

  it("returnează false pe array gol", () => {
    expect(detectIsFloorPlan([])).toBe(false);
  });
});

// ─── detectRoomBlocks ─────────────────────────────────────────────────────────

describe("detectRoomBlocks", () => {
  it("detectează două camere distincte cu S= valid", () => {
    const items: PdfTextItem[] = [
      // Camera 1: G.S. FETE
      item("G.S. FETE", 100, 500),
      item("S=8.20", 110, 480),
      item("gresie antiderapantă de interior", 110, 460),
      item("tavan fals", 110, 440),
      // Camera 2: HOL 1
      item("HOL 1", 500, 500),
      item("S=23.50", 510, 480),
      item("parchet laminat", 510, 460),
    ];

    const blocks = detectRoomBlocks(items);
    expect(blocks.length).toBe(2);

    const names = blocks.map((b) => b.name);
    expect(names).toContain("G.S. FETE");
    expect(names).toContain("HOL 1");
  });

  it("exclude etichete non-cameră fără S= asociat", () => {
    const items: PdfTextItem[] = [
      // Etichetă non-cameră (fără S=)
      item("LIMITA PROPRIETATE", 10, 900),
      item("NORD", 50, 950),
      // Cameră validă (cu S=)
      item("SALA CLASA 1", 300, 500),
      item("S=41.90", 310, 480),
      item("gresie antiderapantă de interior", 310, 460),
    ];

    const blocks = detectRoomBlocks(items);
    const names = blocks.map((b) => b.name);
    expect(names).not.toContain("LIMITA PROPRIETATE");
    expect(names).not.toContain("NORD");
    expect(names).toContain("SALA CLASA 1");
  });

  it("atribuie items prin Voronoi — item mai aproape de camera 2 merge la camera 2", () => {
    const items: PdfTextItem[] = [
      item("CAMERA 1", 0, 0),
      item("S=10.00", 10, 0),         // lângă Camera 1
      item("CAMERA 2", 1000, 0),
      item("S=20.00", 990, 0),         // lângă Camera 2
      item("parchet laminat", 950, 0), // aproape de Camera 2 → trebuie să ajungă la Camera 2
    ];

    const blocks = detectRoomBlocks(items);
    const cam2 = blocks.find((b) => b.name === "CAMERA 2");
    expect(cam2).toBeDefined();
    expect(cam2!.attributes.some((a) => a.type === "pardoseala")).toBe(true);
  });

  it("returnează array gol dacă nu există cameră validată", () => {
    const items: PdfTextItem[] = [
      item("LIMITA PROPRIETATE", 0, 0),
      item("NORD", 100, 0),
    ];
    expect(detectRoomBlocks(items)).toHaveLength(0);
  });
});

// ─── parseRoomBlock ───────────────────────────────────────────────────────────

describe("parseRoomBlock", () => {
  it("extrage suprafața S= corect", () => {
    const label = item("G.S. FETE", 100, 500);
    const assigned = [
      item("S=8.20", 110, 480),
      item("gresie antiderapantă de interior", 110, 460),
    ];
    const block = parseRoomBlock(label, assigned);
    expect(block.suprafata).toBe(8.20);
  });

  it("flaghează S= trunchiat (se termina în punct)", () => {
    const label = item("SALA CLASA 1", 100, 500);
    const assigned = [item("S=41.", 110, 480)];  // truncat
    const block = parseRoomBlock(label, assigned);
    const supAttr = block.attributes.find((a) => a.type === "suprafata");
    expect(supAttr?.needsManualReview).toBe(true);
    expect(supAttr?.reviewReason).toContain("trunchiată");
  });

  it("detectează material pardoseală gresie antiderapantă", () => {
    const label = item("HOL 2", 0, 0);
    const assigned = [
      item("S=58.63", 10, -20),
      item("gresie antiderapantă de interior", 10, -40),
    ];
    const block = parseRoomBlock(label, assigned);
    const floorAttr = block.attributes.find((a) => a.type === "pardoseala");
    expect(floorAttr).toBeDefined();
    expect(floorAttr!.normalizedText).toContain("antiderapantă");
  });

  it("detectează tavan fals", () => {
    const label = item("G.S. BAIEȚI", 0, 0);
    const assigned = [
      item("S=5.20", 10, -20),
      item("tavan fals", 10, -40),
    ];
    const block = parseRoomBlock(label, assigned);
    expect(block.attributes.some((a) => a.type === "tavan")).toBe(true);
  });

  it("detectează finisaj perete faianță cu înălțime", () => {
    const label = item("G.S. FETE", 0, 0);
    const assigned = [
      item("S=8.20", 10, -20),
      item("faianță h=1,20m", 10, -40),
    ];
    const block = parseRoomBlock(label, assigned);
    const wallAttr = block.attributes.find((a) => a.type === "finisaj_perete");
    expect(wallAttr).toBeDefined();
    expect(wallAttr!.hFinisaj).toBe(1.20);
  });

  it("flaghează text rotit cu date numerice", () => {
    const label = item("RAMPA", 0, 0);
    const assigned = [
      item("S=14.20", 10, -20),
      item("S=6.50", 10, -40, 90), // text rotit
    ];
    const block = parseRoomBlock(label, assigned);
    const rotatedAttr = block.attributes.find((a) => a.isRotated);
    expect(rotatedAttr?.needsManualReview).toBe(true);
    expect(rotatedAttr?.reviewReason).toContain("rotit");
  });
});

// ─── extractFloorMaterial ────────────────────────────────────────────────────

describe("extractFloorMaterial", () => {
  it("detectează gresie antiderapantă de interior", () => {
    const attr = extractFloorMaterial("gresie antiderapantă de interior");
    expect(attr?.normalizedText).toBe("gresie antiderapantă de interior");
    expect(attr?.needsManualReview).toBe(false);
  });

  it("detectează gresie antiderapantă de exterior", () => {
    const attr = extractFloorMaterial("gresie antiderapantă de exterior");
    expect(attr?.normalizedText).toBe("gresie antiderapantă de exterior");
  });

  it("detectează parchet laminat și normalizează", () => {
    const attr = extractFloorMaterial("parchet");
    expect(attr?.normalizedText).toContain("laminat");
  });

  it("detectează beton", () => {
    const attr = extractFloorMaterial("beton");
    expect(attr?.type).toBe("pardoseala");
    expect(attr?.normalizedText).toBe("beton");
  });

  it("returnează null dacă nu e material de pardoseală", () => {
    expect(extractFloorMaterial("tavan fals")).toBeNull();
  });
});

// ─── extractWallFinish ────────────────────────────────────────────────────────

describe("extractWallFinish", () => {
  it("detectează faianță cu h=", () => {
    const attr = extractWallFinish("faianță h=1,20m");
    expect(attr?.type).toBe("finisaj_perete");
    expect(attr?.hFinisaj).toBe(1.20);
  });

  it("detectează vopsea pe baza de ulei", () => {
    const attr = extractWallFinish("vopsea pe baza de ulei h=2.60m");
    expect(attr?.normalizedText).toContain("ulei");
    expect(attr?.hFinisaj).toBe(2.60);
  });

  it("returnează null fără keyword de perete", () => {
    expect(extractWallFinish("gresie de interior")).toBeNull();
  });
});

// ─── applyMandatoryAttributePenalty ──────────────────────────────────────────

describe("applyMandatoryAttributePenalty", () => {
  it("penalizează produs non-antiderapant când cererea cere antiderapant", () => {
    const result = applyMandatoryAttributePenalty(
      "gresie antiderapantă de interior",   // cerere
      "Gresie Rectificată Mată 60x60",     // produs candidat (fără antiderapant)
      90                                    // scor inițial
    );
    expect(result.penalized).toBe(true);
    expect(result.score).toBeLessThan(90);
    expect(result.score).toBeLessThanOrEqual(60);
  });

  it("nu penalizează produs cu atribut antiderapant", () => {
    const result = applyMandatoryAttributePenalty(
      "gresie antiderapantă de interior",
      "Gresie Antiderapantă Industrială R11",
      85
    );
    expect(result.penalized).toBe(false);
    expect(result.score).toBe(85);
  });

  it("nu penalizează când cererea nu cere atribut obligatoriu", () => {
    const result = applyMandatoryAttributePenalty(
      "gresie rectificată beige 60x60",
      "Gresie Portelanata Matt 60x60",
      88
    );
    expect(result.penalized).toBe(false);
    expect(result.score).toBe(88);
  });

  it("penalizează produs fără mențiune 'exterior' când cererea e pentru exterior", () => {
    const result = applyMandatoryAttributePenalty(
      "gresie antiderapantă de exterior",
      "Gresie Antiderapantă Interior R10",
      80
    );
    expect(result.penalized).toBe(true);
    expect(result.score).toBeLessThanOrEqual(55);
  });
});

// ─── roomBlocksToExtractedItems ───────────────────────────────────────────────

describe("roomBlocksToExtractedItems", () => {
  it("generează o linie pentru pardoseală + una pentru tavan", () => {
    const blocks = detectRoomBlocks([
      item("SALA CLASA 1", 100, 500),
      item("S=41.90", 110, 480),
      item("gresie antiderapantă de interior", 110, 460),
      item("tavan fals", 110, 440),
    ]);

    const floorItems = roomBlocksToExtractedItems(blocks);
    expect(floorItems.length).toBeGreaterThanOrEqual(2);
    expect(floorItems.some((i) => i.materialTip === "pardoseala")).toBe(true);
    expect(floorItems.some((i) => i.materialTip === "tavan")).toBe(true);
  });

  it("generează linie finisaj_perete cu cantitate 0 și needsManualReview=true", () => {
    const blocks = detectRoomBlocks([
      item("G.S. FETE", 0, 0),
      item("S=8.20", 10, -20),
      item("faianță h=1,20m", 10, -40),
    ]);

    const floorItems = roomBlocksToExtractedItems(blocks);
    const wallLine = floorItems.find((i) => i.materialTip === "finisaj_perete");
    expect(wallLine).toBeDefined();
    expect(wallLine!.cantitate).toBe(0);
    expect(wallLine!.needsManualReview).toBe(true);
    expect(wallLine!.hFinisaj).toBe(1.20);
  });

  it("linia de pardoseală are cantitate = suprafața S=", () => {
    const blocks = detectRoomBlocks([
      item("HOL 2", 0, 0),
      item("S=58.63", 10, -20),
      item("parchet laminat", 10, -40),
    ]);

    const floorItems = roomBlocksToExtractedItems(blocks);
    const floorLine = floorItems.find((i) => i.materialTip === "pardoseala");
    expect(floorLine?.cantitate).toBe(58.63);
  });
});
