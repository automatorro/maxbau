import { describe, it, expect } from "vitest";
import { expandToBOM, aggregateBOM, bomToExtractedItems } from "../utils/bomEngine";
import type { PlanData } from "../types/planTypes";

describe("BOM Engine", () => {
  const dummyPlan: PlanData = {
    planType: "finisaje_rezidential",
    spaces: [
      {
        name: "Dormitor 1",
        areaSqm: 16.0,
        perimeterM: 16.0,
        heightM: 2.8,
        isWetRoom: false,
        pardoseala: "parchet laminat",
        tavan: "tavan fals rigips",
        pereti: {
          finisaj: "vopsea lavabilă",
        },
      },
      {
        name: "Baie",
        areaSqm: 6.0,
        perimeterM: 10.0,
        heightM: 2.8,
        isWetRoom: true,
        pardoseala: "gresie antiderapantă interior",
        tavan: "tavan fals rigips",
        pereti: {
          finisaj: "faianță",
          hFinisaj: 2.1,
        },
      },
    ],
    structuralElements: [],
  };

  it("should expand floor plan spaces into correct material components", () => {
    const bom = expandToBOM(dummyPlan);

    // Dormitor parchet laminat components: parchet + folie
    const parchetComponents = bom.filter(
      (b) => b.spaceName === "Dormitor 1" && b.systemId === "parchet_laminat"
    );
    expect(parchetComponents.length).toBeGreaterThan(0);

    const mainParchet = parchetComponents.find((c) => c.role === "material_principal");
    expect(mainParchet).toBeDefined();
    // 16.0 sqm * 1.08 = 17.28 sqm
    expect(mainParchet!.cantitate).toBe(17.28);
    expect(mainParchet!.unit).toBe("mp");

    // Baie gresie components
    const baieGresie = bom.filter(
      (b) => b.spaceName === "Baie" && b.systemId === "gresie_antiderapanta_interior"
    );
    expect(baieGresie.length).toBeGreaterThan(0);

    // Adeziv gresie in Baie: 6.0 * 1.8 = 10.8 kg
    const adeziv = baieGresie.find((c) => c.role === "adeziv");
    expect(adeziv).toBeDefined();
    expect(adeziv!.cantitate).toBe(10.8);
    expect(adeziv!.unit).toBe("kg");

    // Hidroizolatie in Baie: wet room only
    const hidro = baieGresie.find((c) => c.role === "hidroizolatie");
    expect(hidro).toBeDefined();
  });

  it("should aggregate quantities of identical materials across spaces", () => {
    const bom = expandToBOM(dummyPlan);
    const aggregated = aggregateBOM(bom);

    // Plăci rigips for tavan should be aggregated:
    // Dormitor: 16.0 * 1.10 = 17.6
    // Baie: 6.0 * 1.10 = 6.6
    // Total = 24.2 mp
    const rigips = aggregated.find(
      (item) => item.systemId === "tavan_rigips" && item.role === "placa"
    );
    expect(rigips).toBeDefined();
    expect(rigips!.cantitate).toBe(24.2);
  });

  it("should convert BOM items to UI ExtractedItems", () => {
    const bom = expandToBOM(dummyPlan);
    const uiItems = bomToExtractedItems(bom);

    expect(uiItems.length).toBeGreaterThan(0);
    expect(uiItems[0]).toHaveProperty("descriere_client");
    expect(uiItems[0]).toHaveProperty("cantitate");
    expect(uiItems[0]).toHaveProperty("unitate");
  });

  it("should expand structural elements into correct concrete, formwork and steel reinforcement components", () => {
    const structuralPlan: PlanData = {
      planType: "structural",
      spaces: [],
      structuralElements: [
        {
          type: "planseu",
          material: "beton C20/25",
          cantitate: 45.5, // 45.5 mc
          unit: "mc",
          locatie: "Planșeu peste Parter",
        },
        {
          type: "alt",
          material: "otel BST500S",
          cantitate: 3450, // 3450 kg
          unit: "kg",
          locatie: "Extras armătură",
        },
      ],
    };

    const bom = expandToBOM(structuralPlan);

    // Beton structural components
    const betonComponents = bom.filter(
      (b) => b.spaceName === "Planșeu peste Parter" && b.systemId === "beton_structural"
    );
    expect(betonComponents.length).toBeGreaterThan(0);
    const betonMaterial = betonComponents.find((c) => c.role === "beton");
    expect(betonMaterial).toBeDefined();
    expect(betonMaterial!.cantitate).toBe(45.5);
    expect(betonMaterial!.unit).toBe("mc");

    // Oțel armătură components
    const otelComponents = bom.filter(
      (b) => b.spaceName === "Extras armătură" && b.systemId === "armatura_otel"
    );
    expect(otelComponents.length).toBeGreaterThan(0);
    const otelMaterial = otelComponents.find((c) => c.role === "otel_fasonat");
    expect(otelMaterial).toBeDefined();
    expect(otelMaterial!.cantitate).toBe(3450);
    expect(otelMaterial!.unit).toBe("kg");

    // Sârmă de legat: 3450 * 0.015 = 51.75 kg
    const sarma = otelComponents.find((c) => c.role === "sarma_legat");
    expect(sarma).toBeDefined();
    expect(sarma!.cantitate).toBe(51.75);
    expect(sarma!.unit).toBe("kg");
  });
});
