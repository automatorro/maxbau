import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Calculator, AlertTriangle, CheckCircle2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { TVA_PERCENT, TVA_RATE } from "@/lib/utils";

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
}

type Product = {
  id: string;
  cod_intern: string;
  denumire_completa: string;
  pret_lista: number;
  unit: string | null;
  category_id: string | null;
};

// UM compatibility map
const UM_COMPAT: Record<string, string[]> = {
  "m²": ["mp", "m2", "m²"],
  "mp": ["mp", "m2", "m²"],
  "m": ["m", "ml", "buc"], // bars sold as BUC but measured in ml
  "ml": ["m", "ml", "buc"],
  "buc": ["buc", "cut", "set"],
  "cut": ["buc", "cut"],
  "kg": ["kg", "sac", "buc"],
  "sac": ["sac", "kg", "buc"],
  "rola": ["rola", "buc", "cut"],
};

function normalizeUM(um: string): string {
  return um.toLowerCase().trim();
}

function umCompatible(recipeUM: string, productUM: string | null): boolean {
  if (!productUM) return true; // no info = allow
  const rn = normalizeUM(recipeUM);
  const pn = normalizeUM(productUM);
  if (rn === pn) return true;
  const compat = UM_COMPAT[rn];
  return compat ? compat.includes(pn) : false;
}

/**
 * Improved matching: 
 * 1. If material has cod_intern → exact match (highest priority)
 * 2. Fuzzy: ALL keywords must match (AND logic), filtered by UM compatibility
 * 3. Score threshold: reject matches below 60%
 */
function findBestProduct(
  mat: RecipeMaterial,
  products: Product[]
): Product | null {
  // Priority 1: exact cod_intern match
  if (mat.cod_intern) {
    const exact = products.find(
      (p) => p.cod_intern === mat.cod_intern
    );
    if (exact) return exact;
  }

  // Priority 2: fuzzy keyword search with AND logic + UM filter
  const keywords = mat.keywords.map((k) => k.toLowerCase());
  if (keywords.length === 0) return null;

  let bestProduct: Product | null = null;
  let bestScore = 0;

  for (const p of products) {
    // UM filter
    if (!umCompatible(mat.um, p.unit)) continue;

    const target = `${p.denumire_completa} ${p.cod_intern}`.toLowerCase();

    // All keywords must match (AND logic)
    let allMatch = true;
    let matchedLength = 0;
    for (const kw of keywords) {
      if (target.includes(kw)) {
        matchedLength += kw.length;
      } else {
        allMatch = false;
        break;
      }
    }

    if (!allMatch) continue;

    // Score = matched keyword length / total possible
    const totalKwLength = keywords.reduce((s, k) => s + k.length, 0);
    const score = totalKwLength > 0 ? matchedLength / totalKwLength : 0;

    // Minimum threshold 60%
    if (score < 0.6) continue;

    // Prefer higher price products (more likely to be the real/quality product)
    // and longer keyword matches
    const finalScore = matchedLength + (Number(p.pret_lista) > 0 ? 0.1 : 0);

    if (finalScore > bestScore) {
      bestScore = finalScore;
      bestProduct = p;
    }
  }

  return bestProduct;
}

const RecipeQuote = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedRecipeId, setSelectedRecipeId] = useState("");
  const [surface, setSurface] = useState("250");
  const [discount, setDiscount] = useState("0");
  const [maxDiscountPercent, setMaxDiscountPercent] = useState("");
  const [lines, setLines] = useState<GeneratedLine[]>([]);
  const [generated, setGenerated] = useState(false);

  const { data: activePriceSheet } = useQuery({
    queryKey: ["active-price-sheet"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_sheets")
        .select("id, name, created_at")
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0] as { id: string; name: string; created_at: string } | undefined;
    },
  });

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
      const { data, error } = await supabase
        .from("products")
        .select("id, cod_intern, denumire_completa, pret_lista, unit, category_id");
      if (error) throw error;
      return data as Product[];
    },
  });

  const selectedRecipe = recipes.find((r) => r.id === selectedRecipeId);

  const handleGenerate = () => {
    if (!selectedRecipe) {
      toast.error("Selectează o rețetă");
      return;
    }
    const surfaceNum = parseFloat(surface);
    if (!surfaceNum || surfaceNum <= 0) {
      toast.error("Suprafața trebuie să fie > 0");
      return;
    }
    const discountNum = parseFloat(discount) || 0;
    const materials = selectedRecipe.materials as RecipeMaterial[];

    const result: GeneratedLine[] = materials.map((mat) => {
      const quantity = mat.consumption_per_m2 * surfaceNum;
      const bestProduct = findBestProduct(mat, products);

      const listUnitPrice = bestProduct ? Number(bestProduct.pret_lista) : 0;
      const unitPrice = listUnitPrice;
      const lineTotal = quantity * unitPrice * (1 - discountNum / 100);

      return {
        position: mat.position,
        description: mat.description,
        um: mat.um,
        consumption_per_m2: mat.consumption_per_m2,
        quantity: Math.round(quantity * 100) / 100,
        product_id: bestProduct?.id || null,
        cod_intern: bestProduct?.cod_intern || null,
        product_name: bestProduct?.denumire_completa || null,
        list_unit_price: listUnitPrice,
        unit_price: unitPrice,
        discount_percent: discountNum,
        line_total: Math.round(lineTotal * 100) / 100,
        status: bestProduct ? "FOUND" : "NOT_FOUND",
      };
    });

    setLines(result);
    setGenerated(true);
    const found = result.filter((r) => r.status === "FOUND").length;
    toast.success(`Ofertă generată: ${found}/${result.length} materiale găsite`);
  };

  const productIdsInLines = useMemo(
    () => Array.from(new Set(lines.map((l) => l.product_id).filter(Boolean))) as string[],
    [lines]
  );

  const { data: specialPriceItems = [] } = useQuery({
    queryKey: ["special-price-items-recipe", activePriceSheet?.id, productIdsInLines.join("|")],
    enabled: Boolean(activePriceSheet?.id) && productIdsInLines.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_sheet_items")
        .select("id, product_id, label, unit, price")
        .eq("price_sheet_id", activePriceSheet!.id)
        .in("product_id", productIdsInLines)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as { id: string; product_id: string; label: string | null; unit: string | null; price: number }[];
    },
  });

  const specialPriceItemsByProductId = useMemo(() => {
    const map = new Map<string, { id: string; label: string | null; unit: string | null; price: number }[]>();
    for (const it of specialPriceItems) {
      const existing = map.get(it.product_id) || [];
      existing.push({ id: it.id, label: it.label, unit: it.unit, price: Number(it.price) });
      map.set(it.product_id, existing);
    }
    return map;
  }, [specialPriceItems]);

  useEffect(() => {
    if (!generated) return;
    if (!activePriceSheet?.id) return;
    if (lines.length === 0) return;

    setLines((prev) =>
      prev.map((l) => {
        if (l.status !== "FOUND" || !l.product_id) return l;
        if (l.price_sheet_item_id) return l;
        const options = specialPriceItemsByProductId.get(l.product_id);
        if (!options || options.length === 0) return l;
        const first = options[0];
        const updated = {
          ...l,
          price_sheet_item_id: first.id,
          unit_price: Number(first.price),
          discount_percent: 0,
        };
        const lineTotal = updated.quantity * updated.unit_price * (1 - updated.discount_percent / 100);
        return { ...updated, line_total: Math.round(lineTotal * 100) / 100 };
      })
    );
  }, [activePriceSheet?.id, generated, lines.length, specialPriceItemsByProductId]);

  const updateLine = (position: number, patch: Partial<Pick<GeneratedLine, "unit_price" | "discount_percent" | "price_sheet_item_id">>) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.position !== position) return l;
        const updated = { ...l, ...patch };
        const lineTotal = updated.quantity * updated.unit_price * (1 - updated.discount_percent / 100);
        return { ...updated, line_total: Math.round(lineTotal * 100) / 100 };
      })
    );
  };

  const totals = useMemo(() => {
    const net = lines.reduce((s, l) => s + l.line_total, 0);
    const tva = net * TVA_RATE;
    const totalList = lines.reduce((s, l) => s + l.quantity * l.list_unit_price, 0);
    const overallDiscountPercent = totalList > 0 ? (1 - net / totalList) * 100 : 0;
    return { net, tva, gross: net + tva, totalList, overallDiscountPercent };
  }, [lines]);

  const handleCreateQuote = async () => {
    if (!user) return;

    const maxDiscNum = maxDiscountPercent.trim() === "" ? null : Number(maxDiscountPercent);
    if (maxDiscNum !== null && (!Number.isFinite(maxDiscNum) || maxDiscNum < 0 || maxDiscNum > 100)) {
      toast.error("Discount maxim total invalid");
      return;
    }
    if (maxDiscNum !== null && totals.overallDiscountPercent > maxDiscNum + 1e-9) {
      toast.error(
        `Discount total (${totals.overallDiscountPercent.toFixed(2)}%) depășește maximul (${maxDiscNum.toFixed(2)}%)`
      );
      return;
    }

    const { data: quote, error: qErr } = await supabase
      .from("quotes")
      .insert({
        user_id: user.id,
        project_description: `${selectedRecipe?.recipe_name} × ${surface} m²`,
        status: "draft" as const,
        total_net: totals.net,
        total_tva: totals.tva,
        total_gross: totals.gross,
        max_discount_percent: maxDiscNum,
      })
      .select("id")
      .single();

    if (qErr || !quote) {
      toast.error("Eroare la crearea ofertei");
      return;
    }

    const items = lines
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
      }));

    if (items.length > 0) {
      const { error: iErr } = await supabase.from("quote_items").insert(items);
      if (iErr) {
        toast.error("Eroare la salvarea produselor");
        return;
      }
    }

    toast.success("Ofertă creată cu succes!");
    navigate(`/quote/${quote.id}/edit`);
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-5xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Generare Ofertă din Rețetă</h1>
          <p className="text-sm text-muted-foreground">
            Selectează tipul de lucrare și suprafața — oferta se generează automat
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
              <div className="sm:col-span-2">
                <Label>Tip lucrare</Label>
                <Select value={selectedRecipeId} onValueChange={setSelectedRecipeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Alege rețetă..." />
                  </SelectTrigger>
                  <SelectContent>
                    {recipes.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.recipe_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Suprafață (m²)</Label>
                <Input type="number" min={0} step="0.1" value={surface} onChange={(e) => setSurface(e.target.value)} />
              </div>
              <div>
                <Label>Discount global (%)</Label>
                <Input type="number" min={0} max={100} step="0.5" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </div>
              <div>
                <Label>Discount maxim total (%)</Label>
                <Input type="number" min={0} max={100} step="0.5" value={maxDiscountPercent} onChange={(e) => setMaxDiscountPercent(e.target.value)} />
              </div>
            </div>
            <div className="mt-4">
              <Button onClick={handleGenerate} className="gap-2" size="lg">
                <Calculator className="h-4 w-4" />
                GENEREAZĂ OFERTĂ
              </Button>
            </div>
          </CardContent>
        </Card>

        {generated && lines.length > 0 && (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  {selectedRecipe?.recipe_name}
                  <Badge variant="secondary">{surface} m²</Badge>
                  {parseFloat(discount) > 0 && <Badge variant="outline">-{discount}%</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table className="min-w-[900px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40px]">#</TableHead>
                        <TableHead>Material</TableHead>
                        <TableHead className="w-[80px]">Cod</TableHead>
                        <TableHead className="w-[90px] text-right">Cantitate</TableHead>
                        <TableHead className="w-[50px]">UM</TableHead>
                        <TableHead className="w-[90px] text-right">Preț/UM</TableHead>
                      <TableHead className="w-[160px]">Listă</TableHead>
                      <TableHead className="w-[80px] text-right">Disc.%</TableHead>
                        <TableHead className="w-[110px] text-right">Total</TableHead>
                        <TableHead className="w-[40px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lines.map((line) => (
                        <TableRow key={line.position}>
                          <TableCell className="text-muted-foreground">{line.position}</TableCell>
                          <TableCell>
                            <div className="text-sm">{line.product_name || line.description}</div>
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
                          <TableCell className="text-right font-medium">{line.quantity}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{line.um}</TableCell>
                          <TableCell>
                            {line.status === "FOUND" ? (
                              <Input
                                type="number"
                                min={0}
                                step="any"
                                value={line.unit_price}
                                onChange={(e) => updateLine(line.position, { unit_price: parseFloat(e.target.value) || 0, price_sheet_item_id: null })}
                                className="h-8 text-right"
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {line.status === "FOUND" && line.product_id && specialPriceItemsByProductId.get(line.product_id)?.length ? (
                              <Select
                                value={line.price_sheet_item_id || "list"}
                                onValueChange={(v) => {
                                  if (v === "list") {
                                    updateLine(line.position, { price_sheet_item_id: null, unit_price: line.list_unit_price, discount_percent: 0 });
                                    return;
                                  }
                                  const opt = specialPriceItemsByProductId.get(line.product_id!)?.find((o) => o.id === v);
                                  if (!opt) return;
                                  updateLine(line.position, { price_sheet_item_id: opt.id, unit_price: Number(opt.price), discount_percent: 0 });
                                }}
                              >
                                <SelectTrigger className="h-8">
                                  <SelectValue placeholder="Alege..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="list">Preț de listă</SelectItem>
                                  {specialPriceItemsByProductId.get(line.product_id)!.map((opt) => (
                                    <SelectItem key={opt.id} value={opt.id}>
                                      {(opt.label || "standard") + ` • ${Number(opt.price).toFixed(2)}`}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {line.status === "FOUND" ? (
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                step="0.5"
                                value={line.discount_percent}
                                onChange={(e) => updateLine(line.position, { discount_percent: parseFloat(e.target.value) || 0, price_sheet_item_id: line.price_sheet_item_id || null })}
                                className="h-8 w-[70px] text-right text-sm"
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-bold">{line.line_total > 0 ? `${line.line_total.toFixed(2)}` : "—"}</TableCell>
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
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex flex-col items-end gap-1 text-sm">
                  <div className="flex justify-between w-full max-w-xs">
                    <span className="text-muted-foreground">Total listă:</span>
                    <span className="font-medium">{totals.totalList.toFixed(2)} lei</span>
                  </div>
                  <div className="flex justify-between w-full max-w-xs">
                    <span className="text-muted-foreground">Discount total:</span>
                    <span className="font-medium">{totals.overallDiscountPercent.toFixed(2)}%</span>
                  </div>
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

            <div className="flex justify-end pb-8">
              <Button onClick={handleCreateQuote} size="lg" className="gap-2">
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
