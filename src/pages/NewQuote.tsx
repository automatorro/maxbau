import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProductPicker } from "@/components/ProductPicker";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Trash2, Save, Send, Plus } from "lucide-react";
import { toast } from "sonner";

const TVA_RATE = 0.19;

interface QuoteItem {
  tempId: string;
  product_id: string | null;
  cod_intern: string;
  denumire: string;
  quantity: number;
  unit: string;
  pret_unitar: number;
  discount_percent: number;
  pret_final: number;
  subtotal: number;
}

function calcLine(item: Partial<QuoteItem>): Pick<QuoteItem, "pret_final" | "subtotal"> {
  const pret = item.pret_unitar ?? 0;
  const disc = item.discount_percent ?? 0;
  const qty = item.quantity ?? 1;
  const pret_final = pret * (1 - disc / 100);
  return { pret_final, subtotal: pret_final * qty };
}

const NewQuote = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [projectDesc, setProjectDesc] = useState("");
  const [items, setItems] = useState<QuoteItem[]>([]);

  // Fetch discount rules for auto-applying
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

  const findBestDiscount = useCallback(
    (productId: string | null, categoryId: string | null, quantity: number) => {
      let bestDiscount = 0;

      discountRules.forEach((rule) => {
        let matches = false;

        if (rule.rule_type === "quantity") {
          const minQty = Number(rule.min_quantity) || 0;
          if (quantity >= minQty) {
            // Match by product or category
            if (rule.product_id && rule.product_id === productId) matches = true;
            else if (rule.category_id && rule.category_id === categoryId) matches = true;
            else if (!rule.product_id && !rule.category_id) matches = true;
          }
        } else if (rule.rule_type === "promo") {
          if (rule.product_id && rule.product_id === productId) matches = true;
          else if (rule.category_id && rule.category_id === categoryId) matches = true;
          else if (!rule.product_id && !rule.category_id) matches = true;
        }

        if (matches) {
          bestDiscount = Math.max(bestDiscount, Number(rule.discount_percent));
        }
      });

      return bestDiscount;
    },
    [discountRules]
  );

  const addProduct = useCallback(
    (product: any) => {
      const existing = items.find((i) => i.product_id === product.id);
      if (existing) {
        // Increase quantity instead
        updateItem(existing.tempId, "quantity", existing.quantity + 1);
        return;
      }

      const autoDiscount = findBestDiscount(product.id, product.category_id, 1);
      const base: QuoteItem = {
        tempId: crypto.randomUUID(),
        product_id: product.id,
        cod_intern: product.cod_intern,
        denumire: product.denumire_completa,
        quantity: 1,
        unit: product.unit || "buc",
        pret_unitar: Number(product.pret_lista),
        discount_percent: autoDiscount,
        pret_final: 0,
        subtotal: 0,
      };
      const calced = calcLine(base);
      setItems((prev) => [...prev, { ...base, ...calced }]);
    },
    [items, findBestDiscount]
  );

  const updateItem = useCallback(
    (tempId: string, field: keyof QuoteItem, value: number | string) => {
      setItems((prev) =>
        prev.map((item) => {
          if (item.tempId !== tempId) return item;
          const updated = { ...item, [field]: value };

          // Auto-recalculate discount when quantity changes
          if (field === "quantity") {
            const autoDisc = findBestDiscount(
              item.product_id,
              null,
              Number(value)
            );
            if (autoDisc > updated.discount_percent) {
              updated.discount_percent = autoDisc;
            }
          }

          const calced = calcLine(updated);
          return { ...updated, ...calced };
        })
      );
    },
    [findBestDiscount]
  );

  const removeItem = (tempId: string) => {
    setItems((prev) => prev.filter((i) => i.tempId !== tempId));
  };

  const totals = useMemo(() => {
    const totalNet = items.reduce((s, i) => s + i.subtotal, 0);
    const totalTva = totalNet * TVA_RATE;
    const totalGross = totalNet + totalTva;
    return { totalNet, totalTva, totalGross };
  }, [items]);

  const saveMutation = useMutation({
    mutationFn: async (status: "draft" | "sent") => {
      if (!user) throw new Error("Nu sunteți autentificat");
      if (items.length === 0) throw new Error("Adăugați cel puțin un produs");

      // Create quote
      const { data: quote, error: qError } = await supabase
        .from("quotes")
        .insert({
          user_id: user.id,
          client_name: clientName || null,
          client_phone: clientPhone || null,
          client_email: clientEmail || null,
          project_description: projectDesc || null,
          status,
          total_net: totals.totalNet,
          total_tva: totals.totalTva,
          total_gross: totals.totalGross,
        })
        .select("id")
        .single();

      if (qError) throw qError;

      // Insert items
      const quoteItems = items.map((item) => ({
        quote_id: quote.id,
        product_id: item.product_id,
        cod_intern: item.cod_intern,
        denumire: item.denumire,
        quantity: item.quantity,
        unit: item.unit,
        pret_unitar: item.pret_unitar,
        discount_percent: item.discount_percent,
        pret_final: item.pret_final,
        subtotal: item.subtotal,
      }));

      const { error: iError } = await supabase
        .from("quote_items")
        .insert(quoteItems);

      if (iError) throw iError;
      return quote.id;
    },
    onSuccess: (_, status) => {
      toast.success(
        status === "draft" ? "Oferta a fost salvată ca ciornă" : "Oferta a fost trimisă"
      );
      navigate("/quotes");
    },
    onError: (err: any) => {
      toast.error(err.message || "Eroare la salvare");
    },
  });

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-5xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Ofertă nouă</h1>
          <p className="text-sm text-muted-foreground">
            Adaugă produse, configurează cantități și discounturi
          </p>
        </div>

        {/* Client info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Date client</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Nume client</Label>
                <Input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Nume / Firmă"
                />
              </div>
              <div>
                <Label className="text-xs">Telefon</Label>
                <Input
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="07xx xxx xxx"
                />
              </div>
              <div>
                <Label className="text-xs">Email</Label>
                <Input
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="email@client.ro"
                />
              </div>
            </div>
            <div className="mt-3">
              <Label className="text-xs">Descriere proiect</Label>
              <Textarea
                value={projectDesc}
                onChange={(e) => setProjectDesc(e.target.value)}
                placeholder="Ex: Construcție casă P+1, faza zidărie..."
                rows={2}
              />
            </div>
          </CardContent>
        </Card>

        {/* Product lines */}
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Produse</CardTitle>
            <ProductPicker
              onSelect={addProduct}
              trigger={
                <Button size="sm" className="gap-1">
                  <Plus className="h-4 w-4" /> Adaugă produs
                </Button>
              }
            />
          </CardHeader>
          <CardContent className="p-0">
            {items.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                Niciun produs adăugat. Apasă „Adaugă produs" pentru a începe.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[80px]">Cod</TableHead>
                      <TableHead>Denumire</TableHead>
                      <TableHead className="w-[70px] text-right">Cant.</TableHead>
                      <TableHead className="w-[50px]">UM</TableHead>
                      <TableHead className="w-[90px] text-right">Preț/UM</TableHead>
                      <TableHead className="w-[70px] text-right">Disc.%</TableHead>
                      <TableHead className="w-[90px] text-right">Preț final</TableHead>
                      <TableHead className="w-[100px] text-right">Subtotal</TableHead>
                      <TableHead className="w-[40px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.tempId}>
                        <TableCell>
                          <Badge variant="outline" className="text-xs font-mono border-primary/30 text-primary">
                            {item.cod_intern}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm max-w-[200px]">
                          <span className="line-clamp-2">{item.denumire}</span>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0.01}
                            step="any"
                            value={item.quantity}
                            onChange={(e) =>
                              updateItem(item.tempId, "quantity", parseFloat(e.target.value) || 0)
                            }
                            className="h-8 w-[65px] text-right text-sm"
                          />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {item.unit}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={item.pret_unitar}
                            onChange={(e) =>
                              updateItem(item.tempId, "pret_unitar", parseFloat(e.target.value) || 0)
                            }
                            className="h-8 w-[85px] text-right text-sm"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            step="0.5"
                            value={item.discount_percent}
                            onChange={(e) =>
                              updateItem(item.tempId, "discount_percent", parseFloat(e.target.value) || 0)
                            }
                            className="h-8 w-[65px] text-right text-sm"
                          />
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          {item.pret_final.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right text-sm font-bold">
                          {item.subtotal.toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => removeItem(item.tempId)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Totals */}
        {items.length > 0 && (
          <Card>
            <CardContent className="pt-4">
              <div className="flex flex-col items-end gap-1 text-sm">
                <div className="flex justify-between w-full max-w-xs">
                  <span className="text-muted-foreground">Total fără TVA:</span>
                  <span className="font-medium">{totals.totalNet.toFixed(2)} lei</span>
                </div>
                <div className="flex justify-between w-full max-w-xs">
                  <span className="text-muted-foreground">TVA (19%):</span>
                  <span className="font-medium">{totals.totalTva.toFixed(2)} lei</span>
                </div>
                <div className="flex justify-between w-full max-w-xs border-t pt-1 mt-1">
                  <span className="font-bold">Total cu TVA:</span>
                  <span className="font-bold text-primary text-lg">
                    {totals.totalGross.toFixed(2)} lei
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-end pb-8">
          <Button
            variant="outline"
            onClick={() => saveMutation.mutate("draft")}
            disabled={saveMutation.isPending || items.length === 0}
          >
            <Save className="h-4 w-4 mr-1" /> Salvează ciornă
          </Button>
          <Button
            onClick={() => saveMutation.mutate("sent")}
            disabled={saveMutation.isPending || items.length === 0}
          >
            <Send className="h-4 w-4 mr-1" /> Trimite oferta
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default NewQuote;
