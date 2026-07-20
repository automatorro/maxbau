import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  enrichProductPackagingWithAI,
  type StructuredPackagingInfo,
} from "@/utils/anthropic";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Search, Info } from "lucide-react";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GenericCalcResult {
  productId: string;
  productName: string;
  productCode: string;
  pretUnitar: number;
  pretUnitarBax: number;
  unitDb: string;
  packagingInfo: StructuredPackagingInfo;
  packsNeeded: number;
  actualArea: number;
  woolTotalCost: number;
  palletsDecimal: number;
  fullPalletsNeeded: number;
  palletGuarantee: number;
}

interface Props {
  surface: string;
  onSurfaceChange: (v: string) => void;
  onCalculated: (result: GenericCalcResult | null) => void;
  recipeName: string;
  recipeCategory: string | null;
}

export type SystemType = "wool" | "polystyrene" | "drywall" | "masonry" | "generic";

// ─── Helper: detecție tip sistem ─────────────────────────────────────────────

export function getSystemType(recipeName: string, category: string | null): SystemType {
  const name = recipeName.toLowerCase();
  const cat = (category || "").toLowerCase();

  if (cat === "vata-sistem" || name.includes("vată") || name.includes("vata")) {
    return "wool";
  }
  if (name.includes("polistiren") || name.includes("termosistem eps") || name.includes("expandat") || name.includes("extrudat") || name.includes("eps") || name.includes("xps")) {
    return "polystyrene";
  }
  if (name.includes("gips") || name.includes("carton") || name.includes("rigips") || name.includes("siniat") || name.includes("plafon") || name.includes("perete") || name.includes("drywall")) {
    return "drywall";
  }
  if (name.includes("zidărie") || name.includes("zidarie") || name.includes("bca") || name.includes("caramida") || name.includes("cărămidă")) {
    return "masonry";
  }
  return "generic";
}

// ─── Smart helpers for filtering and extraction ─────────────────────────────

import { inferThicknessFromName, woolProductMatchesRecipe } from "./WoolPackagingBlock";

function inferDrywallThickness(name: string): number | null {
  const norm = name.toLowerCase();
  if (norm.includes("9.5")) return 9.5;
  if (norm.includes("12.5")) return 12.5;
  if (norm.includes("15")) return 15;
  return null;
}

function inferMasonryThickness(name: string): number | null {
  const norm = name.toLowerCase();
  const thicknessMatch = norm.match(/\b(10|15|20|24|25|30)\s*(?:cm|b\b)?/);
  if (thicknessMatch) return parseInt(thicknessMatch[1], 10);
  const mmMatch = norm.match(/\b(100|150|200|240|250|300)\s*(?:mm)?/);
  if (mmMatch) return parseInt(mmMatch[1], 10) / 10;
  return null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function GenericPackagingBlock({
  surface,
  onSurfaceChange,
  onCalculated,
  recipeName,
  recipeCategory,
}: Props) {
  const systemType = useMemo(() => getSystemType(recipeName, recipeCategory), [recipeName, recipeCategory]);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedProductName, setSelectedProductName] = useState("");
  const [selectedProductCode, setSelectedProductCode] = useState("");
  const [selectedProductPret, setSelectedProductPret] = useState(0);
  const [selectedProductUnit, setSelectedProductUnit] = useState("mp");
  const [packagingInfo, setPackagingInfo] = useState<StructuredPackagingInfo | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Polystyrene-specific: price type selector and m³/bax for price breakdown
  const [selectedPriceType, setSelectedPriceType] = useState<string | null>(null);
  const [m3BaxValue, setM3BaxValue] = useState<number | null>(null);

  // ── Filters state ─────────────────────────────────────────────────────────
  const [woolThickness, setWoolThickness] = useState<number | null>(10);
  const [polyThickness, setPolyThickness] = useState<number | null>(10);
  const [polyType, setPolyType] = useState<"all" | "eps" | "xps">("all");
  const [drywallThickness, setDrywallThickness] = useState<number | null>(12.5);
  const [drywallType, setDrywallType] = useState<"all" | "gkb" | "rbi" | "gkf">("all");
  const [masonryThickness, setMasonryThickness] = useState<number | null>(20);
  const [masonryType, setMasonryType] = useState<"all" | "bca" | "caramida">("all");

  // Reset local search and selection when recipe changes
  useEffect(() => {
    setSelectedProductId(null);
    setSelectedProductName("");
    setSelectedProductCode("");
    setSelectedProductPret(0);
    setSelectedProductUnit("mp");
    setPackagingInfo(null);
    setSearchQuery("");
    setSelectedPriceType(null);
    setM3BaxValue(null);
  }, [recipeName]);

  // ── Fetch products based on system type ──────────────────────────────────
  const { data: dbProducts = [], isFetching: dbLoading } = useQuery({
    queryKey: ["generic-products-block", systemType],
    queryFn: async () => {
      let orFilters = "";
      if (systemType === "wool") {
        const brandTerms = ["vata", "fibran", "rockwool", "knauf", "isover", "ursa", "paroc", "swisspor"];
        orFilters = brandTerms.map((t) => `denumire_completa.ilike.%${t}%,brand.ilike.%${t}%`).join(",");
      } else if (systemType === "polystyrene") {
        const terms = ["polistiren", "eps", "xps", "austrotherm", "adeplast", "hirsch", "swisspor"];
        orFilters = terms.map((t) => `denumire_completa.ilike.%${t}%,brand.ilike.%${t}%`).join(",");
      } else if (systemType === "drywall") {
        const terms = ["placa gips", "gips-carton", "rigips", "siniat", "knauf gips", "norgips"];
        orFilters = terms.map((t) => `denumire_completa.ilike.%${t}%,brand.ilike.%${t}%`).join(",");
      } else if (systemType === "masonry") {
        const terms = ["bca", "caramida", "brikston", "porotherm", "macon", "ytong"];
        orFilters = terms.map((t) => `denumire_completa.ilike.%${t}%,brand.ilike.%${t}%`).join(",");
      } else {
        return [];
      }

      const { data, error } = await supabase
        .from("products")
        .select("id, cod_intern, denumire_completa, pret_lista, unit, specifications, packaging, pack_quantity, brand, brand_slug")
        .or(orFilters)
        .order("denumire_completa")
        .limit(1000);

      if (error) return [];
      return data || [];
    },
    enabled: systemType !== "generic",
  });

  // ── Fetch search products on-demand for Generic type ─────────────────────
  const { data: searchedProducts = [], isFetching: searchLoading } = useQuery({
    queryKey: ["generic-search-products", searchQuery],
    enabled: systemType === "generic" && searchQuery.trim().length > 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, cod_intern, denumire_completa, pret_lista, unit, specifications, packaging, pack_quantity, brand, brand_slug")
        .ilike("denumire_completa", `%${searchQuery}%`)
        .order("denumire_completa")
        .limit(100);
      if (error) return [];
      return data || [];
    },
  });

  // ── Fetch product_prices for selected polystyrene product ─────────────────
  const { data: polyPrices = [] } = useQuery({
    queryKey: ["poly-product-prices", selectedProductId],
    enabled: !!selectedProductId && systemType === "polystyrene",
    queryFn: async () => {
      const { data } = await supabase
        .from("product_prices")
        .select("price_type, price, unit, currency")
        .eq("product_id", selectedProductId!);
      return data || [];
    },
  });

  // Auto-select "Lista" price type when prices load
  useEffect(() => {
    if (polyPrices.length > 0 && !selectedPriceType) {
      const lista = polyPrices.find((p) => p.price_type === "Lista");
      setSelectedPriceType(lista?.price_type || polyPrices[0].price_type);
    }
  }, [polyPrices, selectedPriceType]);

  // Update pretUnitar when price type changes
  useEffect(() => {
    if (selectedPriceType && polyPrices.length > 0) {
      const entry = polyPrices.find((p) => p.price_type === selectedPriceType);
      if (entry) setSelectedProductPret(Number(entry.price));
    }
  }, [selectedPriceType, polyPrices]);

  // ── Combine & Filter Products ────────────────────────────────────────────
  const filteredProducts = useMemo(() => {
    let list = systemType === "generic" ? searchedProducts : dbProducts;

    // Filter by search query if typed (local filter for pre-defined lists)
    if (searchQuery.trim() && systemType !== "generic") {
      const term = searchQuery.toLowerCase();
      list = list.filter((p) =>
        p.denumire_completa.toLowerCase().includes(term) ||
        p.cod_intern.toLowerCase().includes(term)
      );
    }

    // Apply specific criteria filters if NO local search overrides
    if (!searchQuery.trim() || systemType === "generic") {
      if (systemType === "wool") {
        if (woolThickness !== null) {
          list = list.filter((p) => inferThicknessFromName(p.denumire_completa) === woolThickness);
        }
        list = list.filter((p) => woolProductMatchesRecipe(p.denumire_completa, recipeName));
      } else if (systemType === "polystyrene") {
        if (polyThickness !== null) {
          list = list.filter((p) => inferThicknessFromName(p.denumire_completa) === polyThickness);
        }
        if (polyType !== "all") {
          list = list.filter((p) => p.denumire_completa.toLowerCase().includes(polyType));
        }
      } else if (systemType === "drywall") {
        if (drywallThickness !== null) {
          list = list.filter((p) => inferDrywallThickness(p.denumire_completa) === drywallThickness);
        }
        if (drywallType !== "all") {
          list = list.filter((p) => {
            const name = p.denumire_completa.toLowerCase();
            if (drywallType === "rbi") return name.includes("rbi") || name.includes("verde") || name.includes("umezeala") || name.includes("hidro");
            if (drywallType === "gkf") return name.includes("gkf") || name.includes("roz") || name.includes("foc") || name.includes("ignifug");
            return !name.includes("rbi") && !name.includes("verde") && !name.includes("gkf") && !name.includes("roz") && !name.includes("foc");
          });
        }
      } else if (systemType === "masonry") {
        if (masonryThickness !== null) {
          list = list.filter((p) => inferMasonryThickness(p.denumire_completa) === masonryThickness);
        }
        if (masonryType !== "all") {
          list = list.filter((p) => p.denumire_completa.toLowerCase().includes(masonryType));
        }
      }
    }

    // Sort by price ascending
    list = [...list].sort((a, b) => {
      const priceA = Number(a.pret_lista) || 0;
      const priceB = Number(b.pret_lista) || 0;
      return priceA - priceB;
    });

    return list.slice(0, 30);
  }, [dbProducts, searchedProducts, searchQuery, systemType, woolThickness, polyThickness, polyType, drywallThickness, drywallType, masonryThickness, masonryType, recipeName]);

  // ── Select Product ────────────────────────────────────────────────────────
  const handleSelectProduct = async (product: any) => {
    setSelectedProductId(product.id);
    setSelectedProductName(product.denumire_completa);
    setSelectedProductCode(product.cod_intern);
    setSelectedProductPret(Number(product.pret_lista) || 0);
    setSelectedProductUnit(product.unit || "mp");
    setPackagingInfo(null);
    setSelectedPriceType(null);
    setM3BaxValue(null);

    if (systemType === "polystyrene") {
      // Citire directă din DB — fără AI
      const specs = ((product.specifications as any) || {});
      const brand = product.brand || product.denumire_completa.split(" ")[0] || "Standard";
      const thicknessCm = inferThicknessFromName(product.denumire_completa) ?? 10;
      const thicknessMm = thicknessCm * 10;

      const isXps = product.denumire_completa.toLowerCase().includes("xps");
      // Dimensiuni standard: EPS 100×50 cm, XPS 125×60 cm
      const lungimeMm = isXps ? 1250 : 1000;
      const latimeMm  = isXps ? 600  : 500;

      const placiBax  = Number(specs.placi_bax) || Number(product.pack_quantity) || 4;
      const mpBax     = Number(specs.mp_bax)    || ((lungimeMm / 1000) * (latimeMm / 1000) * placiBax);
      const m3Bax     = Number(specs.m3_bax)    || (mpBax * thicknessMm / 1000);

      setM3BaxValue(m3Bax);
      setPackagingInfo({
        brand,
        grosime_mm:          thicknessMm,
        lungime_mm:          lungimeMm,
        latime_mm:           latimeMm,
        placi_bax:           placiBax,
        acoperire_bax_mp:    mpBax,
        baxuri_palet:        20,
        acoperire_palet_mp:  mpBax * 20,
        greutate_bax_kg:     0,
        utilizare_recomandata: isXps ? "izolație fundație / subsol" : "termoizolație fațadă",
      });
      return;
    }

    // Pentru alte tipuri (vată, gips, zidărie) — citim specs cache, fallback AI
    setAiLoading(true);
    try {
      const result = await enrichProductPackagingWithAI(product.id, product.denumire_completa);
      if (result) {
        setPackagingInfo(result);
      } else {
        let fallbackCov = 2.88;
        if (systemType === "drywall") fallbackCov = 3.0;
        if (systemType === "masonry") fallbackCov = 1.0;

        const fallback: StructuredPackagingInfo = {
          brand: product.brand || product.denumire_completa.split(" ")[0] || "Standard",
          grosime_mm: 100,
          lungime_mm: 1200,
          latime_mm: 600,
          placi_bax: 4,
          acoperire_bax_mp: fallbackCov,
          baxuri_palet: 32,
          acoperire_palet_mp: fallbackCov * 32,
          greutate_bax_kg: 24,
          utilizare_recomandata: "lucrare generica",
        };
        setPackagingInfo(fallback);
      }
    } catch {
      toast.error("Eroare la procesarea AI a ambalajului.");
    } finally {
      setAiLoading(false);
    }
  };

  // ── Auto-selection effect ────────────────────────────────────────────────
  useEffect(() => {
    if (filteredProducts.length > 0) {
      const exists = filteredProducts.some((p) => p.id === selectedProductId);
      if (!exists) {
        void handleSelectProduct(filteredProducts[0]);
      }
    } else {
      if (selectedProductId !== null) {
        setSelectedProductId(null);
        setSelectedProductName("");
        setSelectedProductCode("");
        setSelectedProductPret(0);
        setSelectedProductUnit("mp");
        setPackagingInfo(null);
        setSelectedPriceType(null);
        setM3BaxValue(null);
      }
    }
  }, [filteredProducts, selectedProductId]);

  // ── Math Calculations ─────────────────────────────────────────────────────
  const calc = useMemo((): GenericCalcResult | null => {
    const area = parseFloat(surface) || 0;
    if (area <= 0 || !packagingInfo || !selectedProductId) return null;

    const packCoverage = packagingInfo.acoperire_bax_mp;
    const palletPacks = packagingInfo.baxuri_palet;

    const packsNeeded = Math.ceil(area / packCoverage);
    const actualArea = packsNeeded * packCoverage;

    const isPerBax = selectedProductUnit?.toUpperCase() === "BAX" || selectedProductUnit?.toUpperCase() === "PALET";
    const woolTotalCost = isPerBax
      ? packsNeeded * selectedProductPret
      : packsNeeded * packCoverage * selectedProductPret;

    const palletsDecimal = packsNeeded / palletPacks;
    const fullPalletsNeeded = Math.ceil(palletsDecimal);
    const palletGuarantee = fullPalletsNeeded * 85;

    return {
      productId: selectedProductId,
      productName: selectedProductName,
      productCode: selectedProductCode,
      pretUnitar: selectedProductPret,
      pretUnitarBax: isPerBax ? selectedProductPret : selectedProductPret * packCoverage,
      unitDb: selectedProductUnit,
      packagingInfo,
      packsNeeded,
      actualArea,
      woolTotalCost,
      palletsDecimal,
      fullPalletsNeeded,
      palletGuarantee,
    };
  }, [surface, packagingInfo, selectedProductId, selectedProductName, selectedProductCode, selectedProductPret, selectedProductUnit]);

  // Notify parent
  useEffect(() => {
    onCalculated(calc);
  }, [calc, onCalculated]);

  const getEstTotal = (p: any) => {
    const area = parseFloat(surface) || 0;
    const price = Number(p.pret_lista) || 0;
    return (area * price).toFixed(2);
  };

  const isLoading = dbLoading || searchLoading;

  return (
    <div className="space-y-4">
      {/* ── Criteria Filters Toggles ── */}
      {!searchQuery.trim() && (
        <div className="space-y-3 bg-muted/10 p-3 rounded-lg border border-border/10">
          {systemType === "wool" && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Grosime Vată</Label>
              <div className="flex gap-1 flex-wrap">
                {[5, 8, 10, 12, 15, 20].map((t) => (
                  <Button
                    key={t}
                    type="button"
                    variant={woolThickness === t ? "default" : "outline"}
                    className="h-8 px-2.5 text-xs font-semibold"
                    onClick={() => setWoolThickness(t)}
                  >
                    {t} cm
                  </Button>
                ))}
                <Button
                  type="button"
                  variant={woolThickness === null ? "default" : "outline"}
                  className="h-8 px-2.5 text-xs font-semibold"
                  onClick={() => setWoolThickness(null)}
                >
                  Toate
                </Button>
              </div>
            </div>
          )}

          {systemType === "polystyrene" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">Grosime Polistiren</Label>
                <div className="flex gap-1 flex-wrap">
                  {[2, 3, 5, 8, 10, 12, 15, 20].map((t) => (
                    <Button
                      key={t}
                      type="button"
                      variant={polyThickness === t ? "default" : "outline"}
                      className="h-8 px-2.5 text-xs font-semibold"
                      onClick={() => setPolyThickness(t)}
                    >
                      {t} cm
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant={polyThickness === null ? "default" : "outline"}
                    className="h-8 px-2.5 text-xs font-semibold"
                    onClick={() => setPolyThickness(null)}
                  >
                    Toate
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">Tip Polistiren</Label>
                <div className="flex gap-1">
                  {[
                    { val: "all", label: "Toate" },
                    { val: "eps", label: "Expandat (EPS)" },
                    { val: "xps", label: "Extrudat (XPS)" },
                  ].map((o) => (
                    <Button
                      key={o.val}
                      type="button"
                      variant={polyType === o.val ? "default" : "outline"}
                      className="h-8 px-3 text-xs font-semibold"
                      onClick={() => setPolyType(o.val as any)}
                    >
                      {o.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {systemType === "drywall" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">Grosime Placă gips</Label>
                <div className="flex gap-1">
                  {[9.5, 12.5, 15].map((t) => (
                    <Button
                      key={t}
                      type="button"
                      variant={drywallThickness === t ? "default" : "outline"}
                      className="h-8 px-3 text-xs font-semibold"
                      onClick={() => setDrywallThickness(t)}
                    >
                      {t} mm
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant={drywallThickness === null ? "default" : "outline"}
                    className="h-8 px-3 text-xs font-semibold"
                    onClick={() => setDrywallThickness(null)}
                  >
                    Toate
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">Tip Placă</Label>
                <div className="flex gap-1 flex-wrap">
                  {[
                    { val: "all", label: "Toate" },
                    { val: "gkb", label: "Standard (GKB)" },
                    { val: "rbi", label: "Umezeală (RBI)" },
                    { val: "gkf", label: "Foc (GKF)" },
                  ].map((o) => (
                    <Button
                      key={o.val}
                      type="button"
                      variant={drywallType === o.val ? "default" : "outline"}
                      className="h-8 px-2.5 text-xs font-semibold"
                      onClick={() => setDrywallType(o.val as any)}
                    >
                      {o.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {systemType === "masonry" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">Lățime bloc (grosime zid)</Label>
                <div className="flex gap-1 flex-wrap">
                  {[10, 15, 20, 24, 30].map((t) => (
                    <Button
                      key={t}
                      type="button"
                      variant={masonryThickness === t ? "default" : "outline"}
                      className="h-8 px-2.5 text-xs font-semibold"
                      onClick={() => setMasonryThickness(t)}
                    >
                      {t} cm
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant={masonryThickness === null ? "default" : "outline"}
                    className="h-8 px-2.5 text-xs font-semibold"
                    onClick={() => setMasonryThickness(null)}
                  >
                    Toate
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">Tip Material</Label>
                <div className="flex gap-1">
                  {[
                    { val: "all", label: "Toate" },
                    { val: "bca", label: "BCA" },
                    { val: "caramida", label: "Cărămidă" },
                  ].map((o) => (
                    <Button
                      key={o.val}
                      type="button"
                      variant={masonryType === o.val ? "default" : "outline"}
                      className="h-8 px-3 text-xs font-semibold"
                      onClick={() => setMasonryType(o.val as any)}
                    >
                      {o.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Search Bar & List Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
          <Info className="h-3.5 w-3.5 text-primary" />
          {systemType === "generic"
            ? "Caută produsul principal în catalog"
            : "Produs principal pre-selectat (cheapest first)"}
        </Label>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-xs"
            placeholder={systemType === "generic"
              ? 'Tastează pentru a căuta (ex: "adeziv")...'
              : 'Filtrează după brand (ex: "Knauf")...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* ── Product List ── */}
      <div className="rounded-lg border border-border/40 divide-y divide-border/30 max-h-52 overflow-y-auto bg-card shadow-inner">
        {filteredProducts.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground italic text-center">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Se caută produse în catalog...
              </div>
            ) : systemType === "generic" && !searchQuery ? (
              "Tastează în caseta de căutare pentru a găsi produsul principal."
            ) : (
              "Nu s-a găsit niciun produs corespunzător criteriilor selectate."
            )}
          </div>
        ) : (
          filteredProducts.map((p) => {
            const isSelected = selectedProductId === p.id;
            return (
              <div
                key={p.id}
                onClick={() => void handleSelectProduct(p)}
                className={`flex items-center justify-between px-3 py-2 cursor-pointer transition-all text-sm ${
                  isSelected
                    ? "bg-primary/[0.04] border-l-4 border-primary font-medium"
                    : "hover:bg-accent/10"
                }`}
              >
                <div className="min-w-0 pr-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant="outline"
                      className="text-[10px] font-mono shrink-0 text-primary border-primary/20 bg-primary/[0.02]"
                    >
                      {p.cod_intern}
                    </Badge>
                    <span className="truncate text-foreground font-semibold">{p.denumire_completa}</span>
                  </div>
                  {p.packaging && (
                    <span className="text-xs text-muted-foreground block mt-0.5">
                      Ambalare: {p.packaging}
                    </span>
                  )}
                </div>
                <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
                  <span className="font-bold text-foreground">
                    {Number(p.pret_lista).toFixed(2)} lei/{p.unit || "mp"}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-medium">
                    Total est: ~{getEstTotal(p)} lei
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* AI loading overlay — doar pentru vată / gips / zidărie */}
      {aiLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1 bg-muted/20 border border-muted-foreground/10 px-3 rounded-md animate-pulse">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span>Se determină detaliile logistice de ambalare cu AI...</span>
        </div>
      )}

      {/* ── Packaging Calculations Summary ── */}
      {packagingInfo && calc && !aiLoading && (
        <div className="space-y-3 border-t border-border/20 pt-3">
          <div className="grid grid-cols-4 gap-2 text-center bg-muted/40 rounded-lg p-2.5 border border-border/20">
            {[
              { label: "Producător", value: packagingInfo.brand },
              {
                label: "Dimensiuni",
                value: `${packagingInfo.lungime_mm}×${packagingInfo.latime_mm} mm`,
              },
              { label: "Bucăți/Bax", value: `${packagingInfo.placi_bax} buc` },
              { label: "Grosime", value: `${packagingInfo.grosime_mm} mm` },
            ].map(({ label, value }) => (
              <div key={label}>
                <span className="text-[9px] uppercase font-bold text-muted-foreground block">
                  {label}
                </span>
                <span className="text-xs font-semibold text-foreground">{value}</span>
              </div>
            ))}
          </div>

          {/* ── Variante preț polistiren (doar din DB, fără AI) ── */}
          {systemType === "polystyrene" && (
            <div className="space-y-2">
              {polyPrices.length > 0 ? (
                <>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                      Tip preț
                    </Label>
                    <div className="flex gap-1.5 flex-wrap">
                      {polyPrices.map((p) => (
                        <Button
                          key={p.price_type}
                          type="button"
                          variant={selectedPriceType === p.price_type ? "default" : "outline"}
                          className="h-7 px-3 text-xs"
                          onClick={() => setSelectedPriceType(p.price_type)}
                        >
                          {p.price_type}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center bg-primary/[0.02] rounded-lg p-2 border border-primary/10">
                    <div>
                      <span className="text-[9px] uppercase font-bold text-muted-foreground block">Preț/m²</span>
                      <span className="text-sm font-bold text-foreground">
                        {selectedProductPret.toFixed(2)} lei
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase font-bold text-muted-foreground block">Preț/bax</span>
                      <span className="text-sm font-bold text-foreground">
                        {(selectedProductPret * packagingInfo.acoperire_bax_mp).toFixed(2)} lei
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase font-bold text-muted-foreground block">Preț/m³</span>
                      <span className="text-sm font-bold text-foreground">
                        {m3BaxValue
                          ? ((selectedProductPret * packagingInfo.acoperire_bax_mp) / m3BaxValue).toFixed(2)
                          : "—"} lei
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-xs text-muted-foreground bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 p-2 rounded-md">
                  Prețurile pe tip ofertă (Lista / Full Tir / Livrare Directă) vor apărea după
                  rularea scriptului <code>update_eps_xps_pricing.mjs</code> cu datele Excel.
                  Acum este afișat prețul listă din catalog.
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="bg-primary/[0.02] border-primary/15 shadow-sm">
              <CardContent className="p-3 text-center">
                <span className="text-[10px] text-muted-foreground block font-medium">
                  Necesar Baxuri
                </span>
                <span className="text-lg font-bold text-primary block my-0.5">
                  {calc.packsNeeded} baxuri
                </span>
                <span className="text-[10px] text-muted-foreground block">
                  × {packagingInfo.acoperire_bax_mp} {selectedProductUnit}/bax
                </span>
              </CardContent>
            </Card>

            <Card className="bg-primary/[0.02] border-primary/15 shadow-sm">
              <CardContent className="p-3 text-center">
                <span className="text-[10px] text-muted-foreground block font-medium">
                  Cantitate Real Livrată
                </span>
                <span className="text-lg font-bold text-foreground block my-0.5">
                  {calc.actualArea.toFixed(2)} {selectedProductUnit}
                </span>
                <span className="text-[10px] text-emerald-600 font-semibold block">
                  +{(calc.actualArea - (parseFloat(surface) || 0)).toFixed(2)} {selectedProductUnit} surplus
                </span>
              </CardContent>
            </Card>

            {systemType !== "polystyrene" && (
              <Card className="bg-primary/[0.02] border-primary/15 shadow-sm">
                <CardContent className="p-3 text-center">
                  <span className="text-[10px] text-muted-foreground block font-medium">
                    Paleți Returnabili
                  </span>
                  <span className="text-lg font-bold text-foreground block my-0.5">
                    {calc.fullPalletsNeeded} paleți
                  </span>
                  <span className="text-[10px] text-muted-foreground block">
                    ({calc.palletsDecimal.toFixed(2)} exact)
                  </span>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="text-xs text-muted-foreground bg-muted/10 p-3 rounded-lg border border-border/10 space-y-1.5 shadow-sm">
            <div className="flex justify-between">
              <span>Preț listă catalog unitate:</span>
              <span className="font-semibold text-foreground">
                {calc.pretUnitar.toFixed(2)} lei / {calc.unitDb}
              </span>
            </div>
            <div className="flex justify-between text-foreground font-semibold">
              <span>Cost produs principal (rotunjit la baxuri întregi):</span>
              <span className="text-primary">{calc.woolTotalCost.toFixed(2)} lei</span>
            </div>
            {systemType !== "polystyrene" && (
              <div className="flex justify-between text-amber-800 font-semibold bg-amber-50/50 dark:bg-amber-950/20 px-2 py-0.5 rounded">
                <span>
                  Garanție returnabilă paleți europeni ({calc.fullPalletsNeeded} buc × 85
                  lei):
                </span>
                <span>+{calc.palletGuarantee.toFixed(2)} lei</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
