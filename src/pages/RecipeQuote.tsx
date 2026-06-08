import { useEffect, useMemo, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { WoolPackagingBlock, type WoolCalcResult } from "@/components/WoolPackagingBlock";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Calculator, AlertTriangle, CheckCircle2, Plus, Layers, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { TVA_PERCENT, TVA_RATE } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RecipeMaterial {
  position: number;
  description: string;
  um: string;
  consumption_per_m2: number;
  keywords: string[];
  cod_intern?: string;
}

interface GeneratedLine {
  position: number;
  description: string;
  um: string;
  consumption_per_m2: number;
  editedConsumption: number;       // user-editable
  quantity: number;
  product_id: string | null;
  cod_intern: string | null;
  product_name: string | null;
  list_unit_price: number;
  unit_price: number;
  discount_percent: number;
  line_total: number;
  status: "FOUND" | "NOT_FOUND";
  price_sheet_item_id?: string | null;
  price_variant_id?: string | null;
  alternatives: Product[];
}

type Product = {
  id: string;
  cod_intern: string;
  denumire_completa: string;
  pret_lista: number;
  unit: string | null;
  category_id: string | null;
};

// ─── UM compatibility ─────────────────────────────────────────────────────────

const UM_COMPAT: Record<string, string[]> = {
  "m²": ["mp", "m2", "m²"],
  "mp": ["mp", "m2", "m²"],
  "m": ["m", "ml", "buc"],
  "ml": ["m", "ml", "buc"],
  "buc": ["buc", "cut", "set"],
  "cut": ["buc", "cut"],
  "kg": ["kg", "sac", "buc"],
  "sac": ["sac", "kg", "buc"],
  "rola": ["rola", "buc", "cut"],
};

function umCompatible(recipeUM: string, productUM: string | null): boolean {
  if (!productUM) return true;
  const rn = recipeUM.toLowerCase().trim();
  const pn = productUM.toLowerCase().trim();
  if (rn === pn) return true;
  const compat = UM_COMPAT[rn];
  return compat ? compat.includes(pn) : false;
}

function findCandidateProducts(mat: RecipeMaterial, products: Product[]): Product[] {
  const rawKeywords = mat.keywords.flatMap((k) => k.split(/[\s+]+/)).map((k) => k.toLowerCase());
  const keywords = Array.from(new Set(rawKeywords.filter((k) => k.length > 2)));

  if (keywords.length === 0 && !mat.cod_intern) return [];

  const candidates = products
    .map((p) => {
      if (mat.cod_intern && p.cod_intern === mat.cod_intern) return { p, score: 999999 };
      if (keywords.length === 0) return { p, score: 0 };

      const targetNoSpace = `${p.denumire_completa}${p.cod_intern}`.toLowerCase().replace(/[\s+]+/g, "");
      let score = 0;
      let matched = 0;
      for (const kw of keywords) {
        const kwNS = kw.replace(/[\s+]+/g, "");
        if (kwNS.length > 0 && targetNoSpace.includes(kwNS)) { score += kw.length; matched++; }
      }
      if (matched / keywords.length < 0.4) return { p, score: 0 };
      if (umCompatible(mat.um, p.unit)) score *= 1.5; else score *= 0.5;
      if (Number(p.pret_lista) > 0) score += 5;
      return { p, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  return candidates.map((c) => c.p).slice(0, 15);
}

// ─── Component ────────────────────────────────────────────────────────────────

const RecipeQuote = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  // ── Common state ──────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"vata" | "altele">("vata");
  const [selectedRecipeId, setSelectedRecipeId] = useState("");
  const [surface, setSurface] = useState("120");
  const [discount, setDiscount] = useState("0");
  const [maxDiscountPercent, setMaxDiscountPercent] = useState("");
  const [lines, setLines] = useState<GeneratedLine[]>([]);
  const [generated, setGenerated] = useState(false);

  // ── Vată tab state ────────────────────────────────────────────────────────
  const [woolCalc, setWoolCalc] = useState<WoolCalcResult | null>(null);

  // Stable callback to avoid WoolPackagingBlock re-render loops
  const handleWoolCalculated = useCallback((result: WoolCalcResult | null) => {
    setWoolCalc(result);
  }, []);

  // Update page title
  useEffect(() => {
    document.title = "Configurator Rețete & Sisteme | MaxBau";
  }, []);

  // ── Data fetching ─────────────────────────────────────────────────────────
  const { data: recipes = [] } = useQuery({
    queryKey: ["recipes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("retete_constructii")
        .select("id, recipe_name, category, unit, materials")
        .eq("status", "active");
      if (error) throw error;
      return data as unknown as {
        id: string;
        recipe_name: string;
        category: string | null;
        unit: string;
        materials: RecipeMaterial[];
      }[];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["all-products-for-recipe"],
    queryFn: async () => {
      let allProducts: Product[] = [];
      let page = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("products")
          .select("id, cod_intern, denumire_completa, pret_lista, unit, category_id")
          .range(page * pageSize, (page + 1) * pageSize - 1);
        if (error) throw error;
        if (data) allProducts = [...allProducts, ...data];
        if (!data || data.length < pageSize) break;
        page++;
      }
      return allProducts;
    },
  });

  // ── Split recipes into two buckets ───────────────────────────────────────
  const vataRecipes = useMemo(() => recipes.filter((r) => r.category === "vata-sistem"), [recipes]);
  const alteRecipes = useMemo(() => recipes.filter((r) => r.category !== "vata-sistem"), [recipes]);

  const selectedRecipe = recipes.find((r) => r.id === selectedRecipeId);

  // Auto-select first vată recipe when switching to that tab
  useEffect(() => {
    if (activeTab === "vata" && !selectedRecipeId && vataRecipes.length > 0) {
      setSelectedRecipeId(vataRecipes[0].id);
    }
  }, [activeTab, vataRecipes, selectedRecipeId]);

  // Reset lines when recipe or tab changes
  useEffect(() => {
    setLines([]);
    setGenerated(false);
  }, [selectedRecipeId, activeTab]);

  // ── Generate lines from recipe ────────────────────────────────────────────
  const handleGenerate = () => {
    if (!selectedRecipe) { toast.error("Selectează o rețetă"); return; }
    const surfaceNum = parseFloat(surface);
    if (!surfaceNum || surfaceNum <= 0) { toast.error("Suprafața trebuie să fie > 0"); return; }

    // Vată tab: require wool selection
    if (activeTab === "vata" && !woolCalc) {
      toast.error("Selectează mai întâi produsul de vată din catalog");
      return;
    }

    const discountNum = parseFloat(discount) || 0;
    const materials = selectedRecipe.materials as RecipeMaterial[];

    const result: GeneratedLine[] = materials.map((mat) => {
      const consumption = mat.consumption_per_m2;
      const quantity = consumption * surfaceNum;
      const alternatives = findCandidateProducts(mat, products);
      const bestProduct = alternatives.length > 0 ? alternatives[0] : null;
      const listUnitPrice = bestProduct ? Number(bestProduct.pret_lista) : 0;
      const unitPrice = listUnitPrice;
      const lineTotal = quantity * unitPrice * (1 - discountNum / 100);

      return {
        position: mat.position,
        description: mat.description,
        um: mat.um,
        consumption_per_m2: consumption,
        editedConsumption: consumption,
        quantity: Math.round(quantity * 100) / 100,
        product_id: bestProduct?.id || null,
        cod_intern: bestProduct?.cod_intern || null,
        product_name: bestProduct?.denumire_completa || null,
        list_unit_price: listUnitPrice,
        unit_price: unitPrice,
        discount_percent: discountNum,
        line_total: Math.round(lineTotal * 100) / 100,
        status: bestProduct ? "FOUND" : "NOT_FOUND",
        alternatives,
        price_sheet_item_id: null,
        price_variant_id: null,
      };
    });

    setLines(result);
    setGenerated(true);
    const found = result.filter((r) => r.status === "FOUND").length;
    toast.success(`Ofertă generată: ${found}/${result.length} materiale găsite`);
  };

  // ── Line updates ──────────────────────────────────────────────────────────
  const updateLine = (position: number, patch: Partial<GeneratedLine>) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.position !== position) return l;
        const updated = { ...l, ...patch };
        // Recalculate quantity if consumption changed
        const surfaceNum = parseFloat(surface) || 0;
        const qty = Math.round(updated.editedConsumption * surfaceNum * 100) / 100;
        const lineTotal =
          qty * updated.unit_price * (1 - updated.discount_percent / 100);
        return { ...updated, quantity: qty, line_total: Math.round(lineTotal * 100) / 100 };
      })
    );
  };

  const handleAlternativeChange = (position: number, newProductId: string) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.position !== position) return l;
        const newProduct = l.alternatives.find((p) => p.id === newProductId);
        if (!newProduct) return l;
        const listUnitPrice = Number(newProduct.pret_lista) || 0;
        const lineTotal =
          l.quantity * listUnitPrice * (1 - l.discount_percent / 100);
        return {
          ...l,
          product_id: newProduct.id,
          cod_intern: newProduct.cod_intern,
          product_name: newProduct.denumire_completa,
          list_unit_price: listUnitPrice,
          unit_price: listUnitPrice,
          line_total: Math.round(lineTotal * 100) / 100,
          status: "FOUND" as const,
        };
      })
    );
  };

  // ── Price variants ────────────────────────────────────────────────────────
  const productIdsInLines = useMemo(
    () => Array.from(new Set(lines.map((l) => l.product_id).filter(Boolean))) as string[],
    [lines]
  );

  const { data: priceVariants = [] } = useQuery({
    queryKey: ["recipe-quote-price-variants", productIdsInLines.join("|")],
    enabled: productIdsInLines.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_prices")
        .select("id, product_id, supplier_id, price_type, price, currency, suppliers(name)")
        .in("product_id", productIdsInLines)
        .is("valid_to", null)
        .order("price", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // ── Totals ────────────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let net = lines.reduce((s, l) => s + l.line_total, 0);
    // Add vată cost if tab active
    if (activeTab === "vata" && woolCalc) {
      net += woolCalc.woolTotalCost + woolCalc.palletGuarantee;
    }
    const tva = net * TVA_RATE;
    const totalList = lines.reduce((s, l) => s + l.quantity * l.list_unit_price, 0) +
      (activeTab === "vata" && woolCalc ? woolCalc.woolTotalCost : 0);
    const overallDiscountPercent = totalList > 0 ? (1 - (net - (activeTab === "vata" && woolCalc ? woolCalc.palletGuarantee : 0)) / totalList) * 100 : 0;
    return { net, tva, gross: net + tva, totalList, overallDiscountPercent };
  }, [lines, activeTab, woolCalc]);

  // ── Save quote ────────────────────────────────────────────────────────────
  const handleCreateQuote = async () => {
    if (!user) return;
    if (activeTab === "vata" && !woolCalc) {
      toast.error("Selectează produsul de vată înainte de a salva.");
      return;
    }

    const maxDiscNum = maxDiscountPercent.trim() === "" ? null : Number(maxDiscountPercent);
    if (
      maxDiscNum !== null &&
      (!Number.isFinite(maxDiscNum) || maxDiscNum < 0 || maxDiscNum > 100)
    ) {
      toast.error("Discount maxim total invalid");
      return;
    }

    const { data: quote, error: qErr } = await supabase
      .from("quotes")
      .insert({
        user_id: user.id,
        project_description: activeTab === "vata" && woolCalc
          ? `${selectedRecipe?.recipe_name} — Vată: ${woolCalc.productName} × ${surface} mp`
          : `${selectedRecipe?.recipe_name} × ${surface} m²`,
        status: "draft" as const,
        total_net: totals.net,
        total_tva: totals.tva,
        total_gross: totals.gross,
        max_discount_percent: maxDiscNum,
      })
      .select("id")
      .single();

    if (qErr || !quote) { toast.error("Eroare la crearea ofertei"); return; }

    const items: any[] = [];

    // Linia 0: vată principală
    if (activeTab === "vata" && woolCalc) {
      const pkg = woolCalc.packagingInfo;
      const isPerBax = woolCalc.unitDb?.toUpperCase() === "BAX";
      items.push({
        quote_id: quote.id,
        product_id: woolCalc.productId,
        cod_intern: woolCalc.productCode,
        denumire: woolCalc.productName,
        quantity: isPerBax ? woolCalc.packsNeeded : woolCalc.actualArea,
        unit: woolCalc.unitDb,
        pret_unitar: woolCalc.pretUnitar,
        discount_percent: 0,
        pret_final: woolCalc.pretUnitar,
        subtotal: woolCalc.woolTotalCost,
        nota_ai: {
          ambalare: `${woolCalc.packsNeeded} baxuri × ${pkg.acoperire_bax_mp} mp`,
          grosime: `${pkg.grosime_mm} mm`,
          recomandare: pkg.utilizare_recomandata,
        },
      });

      // Garanție paleți
      items.push({
        quote_id: quote.id,
        product_id: null,
        cod_intern: "PALET",
        denumire: `Garanție Palet Euro (Returnabil — ${woolCalc.fullPalletsNeeded} buc)`,
        quantity: woolCalc.fullPalletsNeeded,
        unit: "buc",
        pret_unitar: 85,
        discount_percent: 0,
        pret_final: 85,
        subtotal: woolCalc.palletGuarantee,
        nota_ai: { returnabil: true },
      });
    }

    // Materiale auxiliare din rețetă
    const auxiliaryItems = lines
      .filter((l) => l.status === "FOUND")
      .map((l) => ({
        quote_id: quote.id,
        product_id: l.product_id,
        cod_intern: l.cod_intern!,
        denumire: l.product_name || l.description,
        quantity: l.quantity,
        unit: l.um,
        pret_unitar: l.unit_price,
        discount_percent: l.discount_percent,
        pret_final: l.unit_price * (1 - l.discount_percent / 100),
        subtotal: l.line_total,
        nota_ai: { consum_per_m2: l.editedConsumption },
      }));
    items.push(...auxiliaryItems);

    if (items.length > 0) {
      const { error: iErr } = await supabase.from("quote_items").insert(items);
      if (iErr) { toast.error("Eroare la salvarea produselor"); return; }
    }

    toast.success("Ofertă creată cu succes!");
    navigate(`/quote/${quote.id}/edit`);
  };

  // ── Shared: material lines table ─────────────────────────────────────────
  const renderLinesTable = () => (
    <div className="overflow-x-auto">
      <Table className="min-w-[960px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[40px]">#</TableHead>
            <TableHead>Material</TableHead>
            <TableHead className="w-[80px]">Cod</TableHead>
            <TableHead className="w-[95px] text-right">Consum/mp</TableHead>
            <TableHead className="w-[90px] text-right">Cantitate</TableHead>
            <TableHead className="w-[50px]">UM</TableHead>
            <TableHead className="w-[90px] text-right">Preț/UM</TableHead>
            <TableHead className="w-[155px]">Grile preț</TableHead>
            <TableHead className="w-[75px] text-right">Disc.%</TableHead>
            <TableHead className="w-[110px] text-right">Total</TableHead>
            <TableHead className="w-[36px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.position}>
              <TableCell className="text-muted-foreground">{line.position}</TableCell>

              {/* Product / Alternative selector */}
              <TableCell>
                {line.alternatives && line.alternatives.length > 0 ? (
                  <Select
                    value={line.product_id || ""}
                    onValueChange={(val) => handleAlternativeChange(line.position, val)}
                  >
                    <SelectTrigger className="w-full text-sm h-auto py-1 min-h-[32px]">
                      <SelectValue placeholder="Alege alternativă..." />
                    </SelectTrigger>
                    <SelectContent>
                      {line.alternatives.map((alt) => (
                        <SelectItem key={alt.id} value={alt.id} className="text-sm">
                          {alt.denumire_completa} (UM: {alt.unit || "—"}) —{" "}
                          {Number(alt.pret_lista).toFixed(2)} lei
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="text-sm">{line.product_name || line.description}</div>
                )}
                {line.status === "NOT_FOUND" && (
                  <div className="text-xs text-destructive flex items-center gap-1 mt-0.5">
                    <AlertTriangle className="h-3 w-3" />
                    Produs negăsit în catalog
                  </div>
                )}
              </TableCell>

              <TableCell>
                {line.cod_intern ? (
                  <Badge variant="outline" className="text-xs font-mono border-primary/30 text-primary">
                    {line.cod_intern}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>

              {/* Editable consumption */}
              <TableCell className="text-right">
                <Input
                  type="number"
                  step="any"
                  min={0}
                  value={line.editedConsumption}
                  onChange={(e) =>
                    updateLine(line.position, {
                      editedConsumption: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="h-8 text-right text-xs max-w-[80px] ml-auto"
                />
              </TableCell>

              <TableCell className="text-right font-medium">{line.quantity}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{line.um}</TableCell>

              {/* Unit price */}
              <TableCell>
                {line.status === "FOUND" ? (
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={line.unit_price}
                    onChange={(e) =>
                      updateLine(line.position, {
                        unit_price: parseFloat(e.target.value) || 0,
                        price_sheet_item_id: null,
                      })
                    }
                    className="h-8 text-right"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>

              {/* Price variants */}
              <TableCell>
                {line.status === "FOUND" &&
                  (() => {
                    const variants = priceVariants.filter(
                      (v: any) => v.product_id === line.product_id
                    );
                    if (variants.length === 0)
                      return <span className="text-xs text-muted-foreground text-center block">—</span>;
                    return (
                      <Select
                        value={line.price_variant_id || ""}
                        onValueChange={(val) => {
                          const variant = variants.find((v: any) => v.id === val);
                          if (variant)
                            updateLine(line.position, {
                              price_variant_id: val,
                              unit_price: Number(variant.price),
                            });
                        }}
                      >
                        <SelectTrigger className="h-8 text-[11px] w-[135px]">
                          <SelectValue placeholder="Alege preț..." />
                        </SelectTrigger>
                        <SelectContent>
                          {variants.map((v: any) => (
                            <SelectItem key={v.id} value={v.id} className="text-[11px]">
                              {v.price_type}: {v.price} {v.currency}{" "}
                              {v.suppliers?.name ? `(${v.suppliers.name})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    );
                  })()}
              </TableCell>

              {/* Discount */}
              <TableCell>
                {line.status === "FOUND" ? (
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    value={line.discount_percent}
                    onChange={(e) =>
                      updateLine(line.position, {
                        discount_percent: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="h-8 w-[65px] text-right text-sm"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>

              <TableCell className="text-right font-bold">
                {line.line_total > 0 ? `${line.line_total.toFixed(2)}` : "—"}
              </TableCell>

              <TableCell>
                {line.status === "FOUND" ? (
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout>
      <div className="space-y-5 max-w-6xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Configurator Rețete & Sisteme</h1>
          <p className="text-sm text-muted-foreground">
            Selectați tipul de lucrare și suprafața — oferta se generează automat cu variante echivalente din catalog
          </p>
        </div>

        {/* ── Tabs ── */}
        <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as "vata" | "altele"); setSelectedRecipeId(""); setLines([]); setGenerated(false); }}>
          <TabsList className="h-10">
            <TabsTrigger value="vata" className="gap-1.5 text-sm">
              <Layers className="h-4 w-4" />
              Sisteme Vată
            </TabsTrigger>
            <TabsTrigger value="altele" className="gap-1.5 text-sm">
              <ClipboardList className="h-4 w-4" />
              Alte Rețete
            </TabsTrigger>
          </TabsList>

          {/* ════════════════════════════════════════════════
               TAB 1: Sisteme Vată
          ════════════════════════════════════════════════ */}
          <TabsContent value="vata" className="space-y-5 mt-4">
            <Card>
              <CardContent className="pt-5 space-y-5">

                {/* Row: sistem + suprafata + discount */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                  <div>
                    <Label>Sistem auxiliar vată</Label>
                    <Select value={selectedRecipeId} onValueChange={(v) => { setSelectedRecipeId(v); setLines([]); setGenerated(false); }}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Alege sistemul..." />
                      </SelectTrigger>
                      <SelectContent>
                        {vataRecipes.map((r) => (
                          <SelectItem key={r.id} value={r.id}>{r.recipe_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Suprafață (mp)</Label>
                    <Input
                      type="number" min={1} step="1"
                      value={surface}
                      onChange={(e) => setSurface(e.target.value)}
                      className="mt-1 font-bold text-primary"
                    />
                  </div>
                  <div>
                    <Label>Discount global materiale auxiliare (%)</Label>
                    <Input
                      type="number" min={0} max={100} step="0.5"
                      value={discount}
                      onChange={(e) => setDiscount(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>

                {/* Wool packaging block */}
                <div className="border rounded-xl p-4 bg-gradient-to-br from-primary/[0.02] to-transparent border-primary/15">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-3 text-primary">
                    <Layers className="h-4 w-4" />
                    Produs vată principal — Calcul ambalare
                  </h3>
                  <WoolPackagingBlock
                    surface={surface}
                    onSurfaceChange={setSurface}
                    onCalculated={handleWoolCalculated}
                  />
                </div>

                <Button
                  onClick={handleGenerate}
                  disabled={!selectedRecipeId || !woolCalc}
                  className="gap-2 w-full sm:w-auto"
                  size="lg"
                >
                  <Calculator className="h-4 w-4" />
                  GENEREAZĂ MATERIALE AUXILIARE
                </Button>
              </CardContent>
            </Card>

            {/* Generated lines */}
            {generated && lines.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    {selectedRecipe?.recipe_name}
                    <Badge variant="secondary">{surface} mp</Badge>
                    {woolCalc && (
                      <Badge variant="outline" className="text-primary border-primary/30">
                        Vată: {woolCalc.productName.split(" ").slice(0, 3).join(" ")}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {renderLinesTable()}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ════════════════════════════════════════════════
               TAB 2: Alte Rețete
          ════════════════════════════════════════════════ */}
          <TabsContent value="altele" className="mt-4">
            <Card>
              <CardContent className="pt-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                  <div className="sm:col-span-2 lg:col-span-2">
                    <Label>Tip lucrare</Label>
                    <Select value={selectedRecipeId} onValueChange={(v) => { setSelectedRecipeId(v); setLines([]); setGenerated(false); }}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Alege rețetă..." />
                      </SelectTrigger>
                      <SelectContent>
                        {alteRecipes.map((r) => (
                          <SelectItem key={r.id} value={r.id}>{r.recipe_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Suprafată (m²)</Label>
                    <Input type="number" min={0} step="0.1" value={surface} onChange={(e) => setSurface(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label>Discount global (%)</Label>
                    <Input type="number" min={0} max={100} step="0.5" value={discount} onChange={(e) => setDiscount(e.target.value)} className="mt-1" />
                  </div>
                </div>
                <div className="mt-4">
                  <Button onClick={handleGenerate} className="gap-2 w-full sm:w-auto" size="lg" disabled={!selectedRecipeId}>
                    <Calculator className="h-4 w-4" />
                    GENEREAZĂ OFERTĂ
                  </Button>
                </div>
              </CardContent>
            </Card>

            {generated && lines.length > 0 && (
              <Card className="mt-4">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    {selectedRecipe?.recipe_name}
                    <Badge variant="secondary">{surface} m²</Badge>
                    {parseFloat(discount) > 0 && <Badge variant="outline">-{discount}%</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {renderLinesTable()}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* ── Totals + Save ── */}
        {generated && (
          <>
            <Card>
              <CardContent className="pt-4">
                <div className="flex flex-col items-end gap-1 text-sm">
                  {activeTab === "vata" && woolCalc && (
                    <>
                      <div className="flex justify-between w-full max-w-xs text-muted-foreground">
                        <span>Vată principală:</span>
                        <span className="font-medium">{woolCalc.woolTotalCost.toFixed(2)} lei</span>
                      </div>
                      <div className="flex justify-between w-full max-w-xs text-amber-700">
                        <span>Garanție paleți ({woolCalc.fullPalletsNeeded} × 85 lei):</span>
                        <span className="font-medium">+{woolCalc.palletGuarantee.toFixed(2)} lei</span>
                      </div>
                      <div className="flex justify-between w-full max-w-xs text-muted-foreground">
                        <span>Materiale auxiliare:</span>
                        <span className="font-medium">
                          {lines.reduce((s, l) => s + l.line_total, 0).toFixed(2)} lei
                        </span>
                      </div>
                      <div className="w-full max-w-xs border-t my-1" />
                    </>
                  )}
                  <div className="flex justify-between w-full max-w-xs">
                    <span className="text-muted-foreground">Total fără TVA:</span>
                    <span className="font-medium">{totals.net.toFixed(2)} lei</span>
                  </div>
                  <div className="flex justify-between w-full max-w-xs">
                    <span className="text-muted-foreground">TVA ({TVA_PERCENT}%):</span>
                    <span className="font-medium">{totals.tva.toFixed(2)} lei</span>
                  </div>
                  <div className="flex justify-between w-full max-w-xs border-t pt-1 mt-1">
                    <span className="font-bold">Total cu TVA:</span>
                    <span className="font-bold text-primary text-lg">{totals.gross.toFixed(2)} lei</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center pb-8">
              <div className="flex items-center gap-2">
                <Label className="text-xs shrink-0">Discount maxim total (%):</Label>
                <Input
                  type="number" min={0} max={100} step="0.5"
                  value={maxDiscountPercent}
                  onChange={(e) => setMaxDiscountPercent(e.target.value)}
                  placeholder="nelimitat"
                  className="h-8 w-28 text-sm"
                />
              </div>
              <Button onClick={handleCreateQuote} size="lg" className="gap-2 sm:ml-auto">
                <Plus className="h-4 w-4" />
                Salvează ca ofertă
              </Button>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default RecipeQuote;
