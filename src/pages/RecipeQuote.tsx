import { useState, useMemo } from "react";
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
import { Calculator, Loader2, AlertTriangle, CheckCircle2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

const TVA_RATE = 0.19;

interface RecipeMaterial {
  position: number;
  description: string;
  um: string;
  consumption_per_m2: number;
  keywords: string[];
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
  unit_price: number;
  discount_percent: number;
  line_total: number;
  status: "FOUND" | "NOT_FOUND";
}

// Fuzzy search: score keywords against product name + cod_intern
function fuzzyMatch(keywords: string[], productName: string, codIntern: string): number {
  const target = `${productName} ${codIntern}`.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (target.includes(kw.toLowerCase())) {
      score += kw.length; // longer matches = better
    }
  }
  return score;
}

const RecipeQuote = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedRecipeId, setSelectedRecipeId] = useState("");
  const [surface, setSurface] = useState("250");
  const [discount, setDiscount] = useState("0");
  const [lines, setLines] = useState<GeneratedLine[]>([]);
  const [generated, setGenerated] = useState(false);

  // Fetch recipes
  const { data: recipes = [] } = useQuery({
    queryKey: ["recipes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("retete_constructii")
        .select("id, recipe_name, category, unit, materials")
        .eq("status", "active");
      if (error) throw error;
      return data as unknown as { id: string; recipe_name: string; category: string | null; unit: string; materials: RecipeMaterial[] }[];
    },
  });

  // Fetch all products for matching
  const { data: products = [] } = useQuery({
    queryKey: ["all-products-for-recipe"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, cod_intern, denumire_completa, pret_lista, unit, category_id");
      if (error) throw error;
      return data;
    },
  });

  // Fetch active discount rules
  const { data: discountRules = [] } = useQuery({
    queryKey: ["discount-rules-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("discount_rules")
        .select("*")
        .eq("active", true);
      if (error) throw error;
      return data;
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

      // Fuzzy search in products
      let bestProduct: typeof products[number] | null = null;
      let bestScore = 0;
      for (const p of products) {
        const score = fuzzyMatch(mat.keywords, p.denumire_completa, p.cod_intern);
        if (score > bestScore) {
          bestScore = score;
          bestProduct = p;
        }
      }

      const unitPrice = bestProduct ? Number(bestProduct.pret_lista) : 0;
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
        unit_price: unitPrice,
        discount_percent: discountNum,
        line_total: Math.round(lineTotal * 100) / 100,
        status: bestProduct ? "FOUND" : "NOT_FOUND",
      };
    });

    setLines(result);
    setGenerated(true);
    toast.success(`Ofertă generată: ${result.length} materiale`);
  };

  const totals = useMemo(() => {
    const net = lines.reduce((s, l) => s + l.line_total, 0);
    const tva = net * TVA_RATE;
    return { net, tva, gross: net + tva };
  }, [lines]);

  const handleCreateQuote = async () => {
    if (!user) return;
    const discountNum = parseFloat(discount) || 0;

    // Create quote
    const { data: quote, error: qErr } = await supabase
      .from("quotes")
      .insert({
        user_id: user.id,
        project_description: `${selectedRecipe?.recipe_name} × ${surface} m²`,
        status: "draft" as const,
        total_net: totals.net,
        total_tva: totals.tva,
        total_gross: totals.gross,
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

        {/* Inputs */}
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
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  value={surface}
                  onChange={(e) => setSurface(e.target.value)}
                />
              </div>
              <div>
                <Label>Discount global (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
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

        {/* Results */}
        {generated && lines.length > 0 && (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  {selectedRecipe?.recipe_name}
                  <Badge variant="secondary">{surface} m²</Badge>
                  {parseFloat(discount) > 0 && (
                    <Badge variant="outline">-{discount}%</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40px]">#</TableHead>
                        <TableHead>Material</TableHead>
                        <TableHead className="w-[80px]">Cod</TableHead>
                        <TableHead className="w-[90px] text-right">Cantitate</TableHead>
                        <TableHead className="w-[50px]">UM</TableHead>
                        <TableHead className="w-[90px] text-right">Preț/UM</TableHead>
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
                          <TableCell className="text-right">
                            {line.unit_price > 0 ? `${line.unit_price.toFixed(2)}` : "—"}
                          </TableCell>
                          <TableCell className="text-right font-bold">
                            {line.line_total > 0 ? `${line.line_total.toFixed(2)}` : "—"}
                          </TableCell>
                          <TableCell>
                            {line.status === "FOUND" ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
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

            {/* Totals */}
            <Card>
              <CardContent className="pt-4">
                <div className="flex flex-col items-end gap-1 text-sm">
                  <div className="flex justify-between w-full max-w-xs">
                    <span className="text-muted-foreground">Total fără TVA:</span>
                    <span className="font-medium">{totals.net.toFixed(2)} lei</span>
                  </div>
                  <div className="flex justify-between w-full max-w-xs">
                    <span className="text-muted-foreground">TVA (19%):</span>
                    <span className="font-medium">{totals.tva.toFixed(2)} lei</span>
                  </div>
                  <div className="flex justify-between w-full max-w-xs border-t pt-1 mt-1">
                    <span className="font-bold">Total cu TVA:</span>
                    <span className="font-bold text-primary text-lg">{totals.gross.toFixed(2)} lei</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Action: save as quote */}
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
