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
 * 1. If material has cod_intern → exact match
 * 2. Break down keywords into individual words, filter by length > 2
 * 3. Match at least 60% of the words
 * 4. Boost score if UM matches
 */
function findCandidateProducts(
  mat: RecipeMaterial,
  products: Product[]
): Product[] {
  const rawKeywords = mat.keywords.flatMap(k => k.split(/[\s+]+/)).map(k => k.toLowerCase());
  const keywords = Array.from(new Set(rawKeywords.filter(k => k.length > 2)));
  
  if (keywords.length === 0 && !mat.cod_intern) return [];

  const candidates = products.map(p => {
    // Priority 1: Exact code match gets maximum score
    if (mat.cod_intern && p.cod_intern === mat.cod_intern) {
      return { p, score: 999999 };
    }

    if (keywords.length === 0) return { p, score: 0 };

    const targetNoSpace = `${p.denumire_completa}${p.cod_intern}`.toLowerCase().replace(/[\s+]+/g, '');
    let score = 0;
    let matchedKeywords = 0;
    
    for (const kw of keywords) {
      const kwNoSpace = kw.replace(/[\s+]+/g, '');
      if (kwNoSpace.length > 0 && targetNoSpace.includes(kwNoSpace)) {
        score += kw.length;
        matchedKeywords++;
      }
    }

    // Relaxed threshold: require at least 40% of keywords to match to allow broad alternatives
    const matchRatio = matchedKeywords / keywords.length;
    if (matchRatio < 0.4) return { p, score: 0 };

    if (umCompatible(mat.um, p.unit)) {
      score *= 1.5;
    } else {
      score *= 0.5;
    }

    if (Number(p.pret_lista) > 0) score += 5;

    return { p, score };
  }).filter(c => c.score > 0).sort((a, b) => b.score - a.score);

  // Return top 15 alternatives to give user plenty of choices
  return candidates.map(c => c.p).slice(0, 15);
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
      const alternatives = findCandidateProducts(mat, products);
      const bestProduct = alternatives.length > 0 ? alternatives[0] : null;

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
        alternatives,
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

  const updateLine = (position: number, patch: Partial<Pick<GeneratedLine, "unit_price" | "discount_percent" | "price_sheet_item_id" | "price_variant_id">>) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.position !== position) return l;
        const updated = { ...l, ...patch };
        const lineTotal = updated.quantity * updated.unit_price * (1 - updated.discount_percent / 100);
        return { ...updated, line_total: Math.round(lineTotal * 100) / 100 };
      })
    );
  };

  const handleAlternativeChange = (position: number, newProductId: string) => {
    setLines((prev) => prev.map(l => {
      if (l.position !== position) return l;
      const newProduct = l.alternatives.find(p => p.id === newProductId);
      if (!newProduct) return l;
      
      const listUnitPrice = Number(newProduct.pret_lista) || 0;
      const unitPrice = listUnitPrice;
      const lineTotal = l.quantity * unitPrice * (1 - l.discount_percent / 100);
      
      return {
        ...l,
        product_id: newProduct.id,
        cod_intern: newProduct.cod_intern,
        product_name: newProduct.denumire_completa,
        list_unit_price: listUnitPrice,
        unit_price: unitPrice,
        line_total: Math.round(lineTotal * 100) / 100,
        status: "FOUND"
      };
    }));
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
              <div className="sm:col-span-2 lg:col-span-2">
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
              <Button onClick={handleGenerate} className="gap-2 w-full sm:w-auto" size="lg">
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
                <div className="hidden md:block overflow-x-auto">
                  <Table className="min-w-[900px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40px]">#</TableHead>
                        <TableHead>Material</TableHead>
                        <TableHead className="w-[80px]">Cod</TableHead>
                        <TableHead className="w-[90px] text-right">Cantitate</TableHead>
                        <TableHead className="w-[50px]">UM</TableHead>
                        <TableHead className="w-[90px] text-right">Preț/UM</TableHead>
                      <TableHead className="w-[160px]">Grile preț</TableHead>
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
                                      {alt.denumire_completa} (UM: {alt.unit || "-"}) - {Number(alt.pret_lista).toFixed(2)} lei
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
                            {line.status === "FOUND" ? (
                              (() => {
                                const variants = priceVariants.filter((v: any) => v.product_id === line.product_id);
                                if (variants.length === 0) {
                                  return <span className="text-xs text-muted-foreground text-center block">—</span>;
                                }
                                return (
                                  <Select 
                                    value={line.price_variant_id || ""} 
                                    onValueChange={(val) => {
                                      const variant = variants.find((v: any) => v.id === val);
                                      if (variant) {
                                        updateLine(line.position, { price_variant_id: val, unit_price: Number(variant.price) });
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="h-8 text-[11px] w-[140px]">
                                      <SelectValue placeholder="Alege preț..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {variants.map((v: any) => (
                                        <SelectItem key={v.id} value={v.id} className="text-[11px]">
                                          {v.price_type}: {v.price} {v.currency} {v.min_quantity > 1 ? `(min. ${v.min_quantity})` : ""} {v.suppliers?.name ? `(${v.suppliers.name})` : ""}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                );
                              })()
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
                {/* Mobile card list */}
                <div className="md:hidden divide-y divide-border/30">
                  {lines.map((line) => (
                    <div key={line.position} className={`p-3 space-y-2.5 ${line.status === "NOT_FOUND" ? "bg-destructive/5" : ""}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs text-muted-foreground">#{line.position}</span>
                            {line.cod_intern ? (
                              <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary">
                                {line.cod_intern}
                              </Badge>
                            ) : null}
                          </div>
                          {line.alternatives && line.alternatives.length > 0 ? (
                            <Select
                              value={line.product_id || ""}
                              onValueChange={(val) => handleAlternativeChange(line.position, val)}
                            >
                              <SelectTrigger className="w-full text-sm h-auto py-1 mt-1">
                                <SelectValue placeholder="Alege alternativă..." />
                              </SelectTrigger>
                              <SelectContent>
                                {line.alternatives.map((alt) => (
                                  <SelectItem key={alt.id} value={alt.id} className="text-sm">
                                    {alt.denumire_completa} (UM: {alt.unit || "-"})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <p className="text-sm font-medium leading-snug line-clamp-2">
                              {line.product_name || line.description}
                            </p>
                          )}
                          {line.status === "NOT_FOUND" && (
                            <p className="text-xs text-destructive flex items-center gap-1 mt-0.5">
                              <AlertTriangle className="h-3 w-3" /> Produs negăsit în catalog
                            </p>
                          )}
                        </div>
                        <div className="shrink-0">
                          {line.status === "FOUND" ? (
                            <CheckCircle2 className="h-4 w-4 text-primary" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-destructive" />
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="text-muted-foreground text-xs">Cant: <strong>{line.quantity} {line.um}</strong></span>
                        {line.line_total > 0 && (
                          <span className="ml-auto font-bold text-primary">{line.line_total.toFixed(2)} lei</span>
                        )}
                      </div>
                      {line.status === "FOUND" && (
                        <div className="grid grid-cols-2 gap-2">
                          <div className="col-span-2">
                            {(() => {
                              const variants = priceVariants.filter((v: any) => v.product_id === line.product_id);
                              if (variants.length > 0) {
                                return (
                                  <div className="mb-2">
                                    <p className="text-[10px] text-muted-foreground mb-1">Grile preț</p>
                                    <Select 
                                      value={line.price_variant_id || ""} 
                                      onValueChange={(val) => {
                                        const variant = variants.find((v: any) => v.id === val);
                                        if (variant) {
                                          updateLine(line.position, { price_variant_id: val, unit_price: Number(variant.price) });
                                        }
                                      }}
                                    >
                                      <SelectTrigger className="h-7 text-xs w-full bg-muted/50">
                                        <SelectValue placeholder="Selectează o grilă de preț..." />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {variants.map((v: any) => (
                                          <SelectItem key={v.id} value={v.id} className="text-xs">
                                            {v.price_type}: {v.price} {v.currency} {v.min_quantity > 1 ? `(min. ${v.min_quantity})` : ""} {v.suppliers?.name ? `(${v.suppliers.name})` : ""}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                );
                              }
                              return null;
                            })()}
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">Preț/UM</p>
                            <Input
                              type="number" min={0} step="any"
                              value={line.unit_price}
                              onChange={(e) => updateLine(line.position, { unit_price: parseFloat(e.target.value) || 0, price_sheet_item_id: null })}
                              className="h-8 text-right text-sm"
                            />
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">Disc.%</p>
                            <Input
                              type="number" min={0} max={100} step="0.5"
                              value={line.discount_percent}
                              onChange={(e) => updateLine(line.position, { discount_percent: parseFloat(e.target.value) || 0, price_sheet_item_id: line.price_sheet_item_id || null })}
                              className="h-8 text-right text-sm"
                            />
                          </div>

                        </div>
                      )}
                    </div>
                  ))}
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

            <div className="flex justify-center sm:justify-end pb-8">
              <Button onClick={handleCreateQuote} size="lg" className="gap-2 w-full sm:w-auto">
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
