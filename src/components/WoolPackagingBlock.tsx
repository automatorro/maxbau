import { useState, useEffect, useMemo, useCallback } from "react";
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
import { Check, Loader2, Sparkles, Box } from "lucide-react";
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

// ─── Component ───────────────────────────────────────────────────────────────

export function WoolPackagingBlock({ surface, onSurfaceChange, onCalculated }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedProductName, setSelectedProductName] = useState("");
  const [selectedProductCode, setSelectedProductCode] = useState("");
  const [selectedProductPret, setSelectedProductPret] = useState(0); // lei per acoperire_bax_mp
  const [selectedProductUnit, setSelectedProductUnit] = useState("mp");
  const [packagingInfo, setPackagingInfo] = useState<StructuredPackagingInfo | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // ── Fetch vată products ──────────────────────────────────────────────────
  const { data: dbProducts = [], isFetching: dbLoading } = useQuery({
    queryKey: ["wool-products-block", searchQuery],
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

  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return dbProducts.slice(0, 8);
    const norm = searchQuery
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/(\d+(?:\.\d+)?)\s*(?:mp|m2|metri)/g, "");
    const tokens = norm.split(/[^a-z0-9]+/).filter((t) => t.length > 1);
    if (tokens.length === 0) return dbProducts.slice(0, 8);

    return dbProducts
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
      .slice(0, 10)
      .map((s) => s.product);
  }, [dbProducts, searchQuery]);

  // ── Select product ────────────────────────────────────────────────────────
  const handleSelectProduct = async (product: any) => {
    setSelectedProductId(product.id);
    setSelectedProductName(product.denumire_completa);
    setSelectedProductCode(product.cod_intern);
    setSelectedProductPret(Number(product.pret_lista) || 0);
    setSelectedProductUnit(product.unit || "mp");
    setPackagingInfo(null);
    setAiLoading(true);

    // Auto-detect area from search query
    const areaMatch = searchQuery.match(/(\d+(?:\.\d+)?)\s*(?:mp|m2|metri)/i);
    if (areaMatch) onSurfaceChange(areaMatch[1]);

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
        toast.success("Ambalarea calculată prin AI!");
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
        toast.info("Date de ambalare standard aplicate.");
      }
    } catch {
      toast.error("Eroare la procesarea AI a ambalajului.");
    } finally {
      setAiLoading(false);
    }
  };

  // ── Packaging math ────────────────────────────────────────────────────────
  const calc = useMemo((): WoolCalcResult | null => {
    const area = parseFloat(surface) || 0;
    if (area <= 0 || !packagingInfo || !selectedProductId) return null;

    const packCoverage = packagingInfo.acoperire_bax_mp;
    const palletPacks = packagingInfo.baxuri_palet;

    const packsNeeded = Math.ceil(area / packCoverage);
    const actualArea = packsNeeded * packCoverage;

    // Cost total: pret_lista × acoperire_bax_mp × nr_baxuri
    // (pret_lista este per mp dacă unit=mp, sau per BAX dacă unit=BAX)
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

  // Notify parent whenever calc changes
  useEffect(() => {
    onCalculated(calc);
  }, [calc, onCalculated]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Search */}
      <div>
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Caută produsul de vată din catalog
        </Label>
        <Input
          className="mt-1"
          placeholder='Ex: "FIBRANgeo BP-70 10cm" sau "Rockwool Frontrock 120mp"'
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Product list */}
      <div className="rounded-lg border border-border/40 divide-y divide-border/30 max-h-52 overflow-y-auto bg-card">
        {filteredProducts.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground italic text-center">
            {dbLoading ? "Se încarcă..." : "Niciun produs găsit."}
          </div>
        ) : (
          filteredProducts.map((p) => {
            const isSelected = selectedProductId === p.id;
            return (
              <div
                key={p.id}
                onClick={() => void handleSelectProduct(p)}
                className={`flex items-center justify-between px-3 py-2 cursor-pointer transition-colors text-sm ${
                  isSelected
                    ? "bg-primary/5 border-l-4 border-primary"
                    : "hover:bg-accent/10"
                }`}
              >
                <div className="min-w-0 pr-2">
                  <div className="flex items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className="text-[10px] font-mono shrink-0 text-primary border-primary/20"
                    >
                      {p.cod_intern}
                    </Badge>
                    <span className="truncate font-medium">{p.denumire_completa}</span>
                  </div>
                  {p.packaging && (
                    <span className="text-xs text-muted-foreground">
                      Ambalare: {p.packaging}
                    </span>
                  )}
                </div>
                <div className="text-right shrink-0 flex items-center gap-1">
                  <span className="font-semibold">
                    {Number(p.pret_lista).toFixed(2)} lei/{p.unit || "mp"}
                  </span>
                  {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* AI loading overlay */}
      {aiLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span>Se calculează ambalarea cu AI (Claude / Gemini)…</span>
        </div>
      )}

      {/* Packaging info + calc summary */}
      {packagingInfo && calc && !aiLoading && (
        <div className="space-y-3">
          {/* Mini specs row */}
          <div className="grid grid-cols-4 gap-2 text-center bg-muted/30 rounded-lg p-2 border border-border/30">
            {[
              { label: "Brand", value: packagingInfo.brand },
              {
                label: "Dimensiuni placă",
                value: `${packagingInfo.lungime_mm}×${packagingInfo.latime_mm} mm`,
              },
              { label: "Plăci/Bax", value: `${packagingInfo.placi_bax} buc` },
              { label: "Grosime", value: `${packagingInfo.grosime_mm} mm` },
            ].map(({ label, value }) => (
              <div key={label}>
                <span className="text-[9px] uppercase font-bold text-muted-foreground block">
                  {label}
                </span>
                <span className="text-xs font-semibold">{value}</span>
              </div>
            ))}
          </div>

          {/* ── The main summary block (same as WoolConfigurator) ── */}
          <div className="grid grid-cols-3 gap-3">
            <Card className="bg-primary/[0.03] border-primary/20">
              <CardContent className="p-3 text-center">
                <span className="text-[10px] text-muted-foreground block">
                  Necesar Baxuri Întregi
                </span>
                <span className="text-xl font-bold text-primary block my-0.5">
                  {calc.packsNeeded} baxuri
                </span>
                <span className="text-[10px] text-muted-foreground">
                  ×{packagingInfo.acoperire_bax_mp} mp/bax
                </span>
              </CardContent>
            </Card>

            <Card className="bg-primary/[0.03] border-primary/20">
              <CardContent className="p-3 text-center">
                <span className="text-[10px] text-muted-foreground block">
                  Suprafață Real Livrată
                </span>
                <span className="text-xl font-bold text-foreground block my-0.5">
                  {calc.actualArea.toFixed(2)} mp
                </span>
                <span className="text-[10px] text-emerald-600 font-semibold">
                  +{(calc.actualArea - (parseFloat(surface) || 0)).toFixed(2)} mp
                  suplimentar
                </span>
              </CardContent>
            </Card>

            <Card className="bg-primary/[0.03] border-primary/20">
              <CardContent className="p-3 text-center">
                <span className="text-[10px] text-muted-foreground block">
                  Cantitate Paleți
                </span>
                <span className="text-xl font-bold text-foreground block my-0.5">
                  {calc.fullPalletsNeeded} paleți
                </span>
                <span className="text-[10px] text-muted-foreground">
                  ({calc.palletsDecimal.toFixed(2)} paleți exact)
                </span>
              </CardContent>
            </Card>
          </div>

          {/* Cost lines */}
          <div className="text-xs text-muted-foreground border-t pt-2 space-y-1">
            <div className="flex justify-between">
              <span>Preț listă catalog unitate:</span>
              <span className="font-semibold">
                {calc.pretUnitar.toFixed(2)} lei / {calc.unitDb}
              </span>
            </div>
            <div className="flex justify-between text-foreground font-semibold">
              <span>Cost vată (rotunjit la baxuri întregi):</span>
              <span>{calc.woolTotalCost.toFixed(2)} lei</span>
            </div>
            <div className="flex justify-between text-amber-700 font-semibold">
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
