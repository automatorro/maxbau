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
import { Check, Loader2, Search, Info } from "lucide-react";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WoolCalcResult {
  productId: string;
  productName: string;
  productCode: string;
  pretUnitar: number;       // lei/mp (pret_lista)
  pretUnitarBax: number;    // lei/BAX (pret_lista, unit=BAX)
  unitDb: string;           // unitatea din catalog (mp, BAX etc.)
  packagingInfo: StructuredPackagingInfo;
  packsNeeded: number;
  actualArea: number;
  woolTotalCost: number;
  palletsDecimal: number;
  fullPalletsNeeded: number;
  palletGuarantee: number;
}

interface Props {
  /** Suprafața curentă (mp) — controlată extern de RecipeQuote */
  surface: string;
  onSurfaceChange: (v: string) => void;
  /** Callback apelat ori de câte ori calculul se actualizează (sau null când nu e complet) */
  onCalculated: (result: WoolCalcResult | null) => void;
  selectedRecipeName?: string;
  selectedThickness?: number | null;
}

// ─── Helper: detecție tip sistem din text ────────────────────────────────────

function detectSystemType(text: string): "exterior" | "interior" {
  const t = text.toLowerCase();
  if (
    /fat[aă]d[aă]|exterior|etics|frontrock|duo.?contact|bp-?\d|fibrangeo\s+b[p-]|termoizolant/i.test(t)
  )
    return "exterior";
  if (
    /mansard[aă]|interior|tavan|peret[ei]|compartimentare|roll|naturoll|knauf|isover/i.test(t)
  )
    return "interior";
  return "exterior";
}

// ─── Smart helpers for filtering and extraction ─────────────────────────────

export function inferThicknessFromName(name: string): number | null {
  const normalized = name.toLowerCase();

  // 1. Check for "X cm grosime" or "X mm grosime"
  const grosimeMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(cm|mm)\s*grosime/);
  if (grosimeMatch) {
    const val = parseFloat(grosimeMatch[1]);
    const unit = grosimeMatch[2];
    return unit === "mm" ? val / 10 : val;
  }

  // 2. Check for dimension pattern like "600x1250x100" or "1200 x 600 x 50"
  const dimMatch = normalized.match(/\b\d+\s*[*x]\s*\d+\s*[*x]\s*(\d+)\b/);
  if (dimMatch) {
    const mmVal = parseFloat(dimMatch[1]);
    if (mmVal >= 10) return mmVal / 10;
    return mmVal;
  }

  // 3. Check for specific word "grosime: X cm" or "grosime Xmm"
  const grosimeWordMatch = normalized.match(/grosime:?\s*(\d+(?:\.\d+)?)\s*(cm|mm)?/);
  if (grosimeWordMatch) {
    const val = parseFloat(grosimeWordMatch[1]);
    const unit = grosimeWordMatch[2] || "mm";
    return unit === "mm" ? val / 10 : val;
  }

  // 4. Look for "X cm" or "X mm" (typically between 1 and 25)
  const allMatches = Array.from(normalized.matchAll(/\b(\d+(?:\.\d+)?)\s*(cm|mm)\b/g));
  for (const match of allMatches) {
    const val = parseFloat(match[1]);
    const unit = match[2];
    const cmVal = unit === "mm" ? val / 10 : val;
    if (cmVal >= 1 && cmVal <= 25) {
      return cmVal;
    }
  }

  return null;
}

export function woolProductMatchesRecipe(productName: string, recipeName: string): boolean {
  const pName = productName.toLowerCase();
  const rName = recipeName.toLowerCase();

  if (!recipeName) return true;

  if (rName.includes("fațadă") || rName.includes("fatada") || rName.includes("etics") || rName.includes("exterior")) {
    const isFacade = /fatad[aă]|etics|frontrock|fkd|bp-?\d|xps|extrudat|expandat|eps/i.test(pName);
    const isInterior = /mansard[aă]|acoperis|naturoll|rio|domo|akusto|akustic|tavan|plafon|perete|compartimentare/i.test(pName);
    return isFacade || !isInterior;
  }

  if (rName.includes("mansardă") || rName.includes("mansarda")) {
    const isMansarda = /mansard[aă]|acoperis|naturoll|rio|domo|rola|roll|sticla/i.test(pName);
    const isFacade = /fatad[aă]|etics|frontrock|fkd|xps|extrudat|expandat|eps/i.test(pName);
    return isMansarda || !isFacade;
  }

  if (rName.includes("plafon") || rName.includes("tavan") || rName.includes("suspendat")) {
    const isPlafon = /plafon|tavan|akustic|akusto|decibel|fonic|placi/i.test(pName);
    const isFacade = /fatad[aă]|etics|frontrock|fkd|xps|extrudat|expandat|eps/i.test(pName);
    return isPlafon || !isFacade;
  }

  if (rName.includes("perete") || rName.includes("compartimentare") || rName.includes("pereți")) {
    const isPerete = /peret[ei]|compartimentare|multirock|decibel|akusto|fonic/i.test(pName);
    const isFacade = /fatad[aă]|etics|frontrock|fkd|xps|extrudat|expandat|eps/i.test(pName);
    return isPerete || !isFacade;
  }

  return true;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function WoolPackagingBlock({
  surface,
  onSurfaceChange,
  onCalculated,
  selectedRecipeName = "",
  selectedThickness = null,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedProductName, setSelectedProductName] = useState("");
  const [selectedProductCode, setSelectedProductCode] = useState("");
  const [selectedProductPret, setSelectedProductPret] = useState(0);
  const [selectedProductUnit, setSelectedProductUnit] = useState("mp");
  const [packagingInfo, setPackagingInfo] = useState<StructuredPackagingInfo | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // ── Fetch vată products ──────────────────────────────────────────────────
  const { data: dbProducts = [], isFetching: dbLoading } = useQuery({
    queryKey: ["wool-products-block"],
    queryFn: async () => {
      const brandTerms = [
        "vata", "fibran", "rockwool", "knauf", "isover", "ursa", "paroc", "swisspor",
      ];
      const orFilters = brandTerms
        .map(
          (t) =>
            `denumire_completa.ilike.%${t}%,brand.ilike.%${t}%,brand_slug.ilike.%${t}%`
        )
        .join(",");

      const { data, error } = await supabase
        .from("products")
        .select(
          "id, cod_intern, denumire_completa, pret_lista, unit, specifications, packaging, pack_quantity, brand, brand_slug"
        )
        .or(orFilters)
        .order("denumire_completa")
        .limit(1000);

      if (error) return [];
      return data || [];
    },
  });

  // ── Filter & Sort Products (Cheapest first) ──────────────────────────────
  const filteredProducts = useMemo(() => {
    let list = dbProducts;

    // Filter by recipe if provided and NO search query is active
    if (selectedRecipeName && !searchQuery.trim()) {
      list = list.filter((p) =>
        woolProductMatchesRecipe(p.denumire_completa, selectedRecipeName)
      );
    }

    // Filter by thickness if provided
    if (selectedThickness !== null) {
      list = list.filter((p) => {
        const t = inferThicknessFromName(p.denumire_completa);
        return t === selectedThickness;
      });
    }

    // Filter by search query if present
    if (searchQuery.trim()) {
      const norm = searchQuery
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/(\d+(?:\.\d+)?)\s*(?:mp|m2|metri)/g, "");
      const tokens = norm.split(/[^a-z0-9]+/).filter((t) => t.length > 1);
      if (tokens.length > 0) {
        list = list
          .map((p) => {
            const target =
              `${p.denumire_completa} ${p.cod_intern} ${p.brand || ""}`
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLowerCase();
            let score = 0;
            for (const t of tokens) if (target.includes(t)) score += t.length * 2;
            return { product: p, score };
          })
          .filter((s) => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .map((s) => s.product);
      }
    } else {
      // Sort by price ascending
      list = [...list].sort((a, b) => {
        const priceA = Number(a.pret_lista) || 0;
        const priceB = Number(b.pret_lista) || 0;
        return priceA - priceB;
      });
    }

    return list.slice(0, 30);
  }, [dbProducts, searchQuery, selectedRecipeName, selectedThickness]);

  // ── Select product ────────────────────────────────────────────────────────
  const handleSelectProduct = async (product: any) => {
    setSelectedProductId(product.id);
    setSelectedProductName(product.denumire_completa);
    setSelectedProductCode(product.cod_intern);
    setSelectedProductPret(Number(product.pret_lista) || 0);
    setSelectedProductUnit(product.unit || "mp");
    setPackagingInfo(null);
    setAiLoading(true);

    try {
      const result = await enrichProductPackagingWithAI(
        product.id,
        product.denumire_completa
      );
      if (result) {
        const normalized: StructuredPackagingInfo = {
          ...result,
          grosime_mm: Number(result.grosime_mm) || 100,
          lungime_mm: Number(result.lungime_mm) || 1200,
          latime_mm: Number(result.latime_mm) || 600,
          placi_bax: Number(result.placi_bax) || 4,
          acoperire_bax_mp: Number(result.acoperire_bax_mp) || 2.88,
          baxuri_palet: Number(result.baxuri_palet) || 32,
          acoperire_palet_mp: Number(result.acoperire_palet_mp) || 92.16,
          greutate_bax_kg: Number(result.greutate_bax_kg) || 24,
        };
        setPackagingInfo(normalized);
      } else {
        const fallback: StructuredPackagingInfo = {
          brand: product.denumire_completa.split(" ")[0] || "Standard",
          grosime_mm: 100, lungime_mm: 1200, latime_mm: 600,
          placi_bax: 4, acoperire_bax_mp: 2.88,
          baxuri_palet: 32, acoperire_palet_mp: 92.16,
          greutate_bax_kg: 24,
          utilizare_recomandata: detectSystemType(product.denumire_completa) === "exterior"
            ? "fatada exterior" : "interior mansarda",
        };
        setPackagingInfo(fallback);
      }
    } catch {
      toast.error("Eroare la procesarea AI a ambalajului.");
    } finally {
      setAiLoading(false);
    }
  };

  // ── Auto-selection effect (Cheapest first) ───────────────────────────────
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
      }
    }
  }, [filteredProducts, selectedProductId]);

  // ── Packaging math ────────────────────────────────────────────────────────
  const calc = useMemo((): WoolCalcResult | null => {
    const area = parseFloat(surface) || 0;
    if (area <= 0 || !packagingInfo || !selectedProductId) return null;

    const packCoverage = packagingInfo.acoperire_bax_mp;
    const palletPacks = packagingInfo.baxuri_palet;

    const packsNeeded = Math.ceil(area / packCoverage);
    const actualArea = packsNeeded * packCoverage;

    const isPerBax = selectedProductUnit?.toUpperCase() === "BAX";
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

  // Estimated price helper
  const getEstTotal = (p: any) => {
    const area = parseFloat(surface) || 0;
    const price = Number(p.pret_lista) || 0;
    return (area * price).toFixed(2);
  };

  return (
    <div className="space-y-4">
      {/* Search & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
          <Info className="h-3.5 w-3.5 text-primary" />
          Alege produsul de vată din catalog
        </Label>
        
        {/* Search override */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-xs"
            placeholder='Filtrează manual (ex: "Rockwool")...'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Product list */}
      <div className="rounded-lg border border-border/40 divide-y divide-border/30 max-h-60 overflow-y-auto bg-card shadow-inner">
        {filteredProducts.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground italic text-center">
            {dbLoading ? (
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Se caută produse...
              </div>
            ) : (
              "Niciun produs compatibil nu a fost găsit pentru grosimea și tipul selectat."
            )}
          </div>
        ) : (
          filteredProducts.map((p) => {
            const isSelected = selectedProductId === p.id;
            const thickness = inferThicknessFromName(p.denumire_completa);
            return (
              <div
                key={p.id}
                onClick={() => void handleSelectProduct(p)}
                className={`flex items-center justify-between px-3 py-2.5 cursor-pointer transition-all text-sm ${
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
                    {thickness && (
                      <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4 bg-muted">
                        {thickness} cm
                      </Badge>
                    )}
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

      {/* AI loading overlay */}
      {aiLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1 bg-muted/20 border border-muted-foreground/10 px-3 rounded-md animate-pulse">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span>Se determină detaliile logistice de ambalare cu AI...</span>
        </div>
      )}

      {/* Packaging info + calc summary */}
      {packagingInfo && calc && !aiLoading && (
        <div className="space-y-3 border-t border-border/20 pt-3">
          {/* Mini specs row */}
          <div className="grid grid-cols-4 gap-2 text-center bg-muted/40 rounded-lg p-2.5 border border-border/20">
            {[
              { label: "Brand", value: packagingInfo.brand },
              {
                label: "Dimensiuni",
                value: `${packagingInfo.lungime_mm}×${packagingInfo.latime_mm} mm`,
              },
              { label: "Plăci/Bax", value: `${packagingInfo.placi_bax} buc` },
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

          {/* ── Packaging Cards ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="bg-primary/[0.02] border-primary/15 shadow-sm">
              <CardContent className="p-3 text-center">
                <span className="text-[10px] text-muted-foreground block font-medium">
                  Necesar Baxuri Întregi
                </span>
                <span className="text-lg font-bold text-primary block my-0.5">
                  {calc.packsNeeded} baxuri
                </span>
                <span className="text-[10px] text-muted-foreground block">
                  × {packagingInfo.acoperire_bax_mp} mp/bax
                </span>
              </CardContent>
            </Card>

            <Card className="bg-primary/[0.02] border-primary/15 shadow-sm">
              <CardContent className="p-3 text-center">
                <span className="text-[10px] text-muted-foreground block font-medium">
                  Suprafață Real Livrată
                </span>
                <span className="text-lg font-bold text-foreground block my-0.5">
                  {calc.actualArea.toFixed(2)} mp
                </span>
                <span className="text-[10px] text-emerald-600 font-semibold block">
                  +{(calc.actualArea - (parseFloat(surface) || 0)).toFixed(2)} mp surplus
                </span>
              </CardContent>
            </Card>

            <Card className="bg-primary/[0.02] border-primary/15 shadow-sm">
              <CardContent className="p-3 text-center">
                <span className="text-[10px] text-muted-foreground block font-medium">
                  Număr Paleți
                </span>
                <span className="text-lg font-bold text-foreground block my-0.5">
                  {calc.fullPalletsNeeded} paleți
                </span>
                <span className="text-[10px] text-muted-foreground block">
                  ({calc.palletsDecimal.toFixed(2)} exact)
                </span>
              </CardContent>
            </Card>
          </div>

          {/* Cost lines */}
          <div className="text-xs text-muted-foreground bg-muted/10 p-3 rounded-lg border border-border/10 space-y-1.5 shadow-sm">
            <div className="flex justify-between">
              <span>Preț listă catalog unitate:</span>
              <span className="font-semibold text-foreground">
                {calc.pretUnitar.toFixed(2)} lei / {calc.unitDb}
              </span>
            </div>
            <div className="flex justify-between text-foreground font-semibold">
              <span>Cost vată (rotunjit la baxuri întregi):</span>
              <span className="text-primary">{calc.woolTotalCost.toFixed(2)} lei</span>
            </div>
            <div className="flex justify-between text-amber-800 font-semibold bg-amber-50/50 dark:bg-amber-950/20 px-2 py-0.5 rounded">
              <span>
                Garanție returnabilă paleți europeni ({calc.fullPalletsNeeded} buc × 85
                lei):
              </span>
              <span>+{calc.palletGuarantee.toFixed(2)} lei</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
