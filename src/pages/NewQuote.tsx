import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Trash2, Save, Send, Plus } from "lucide-react";
import { toast } from "sonner";
import { TVA_PERCENT, TVA_RATE } from "@/lib/utils";

interface QuoteItem {
  tempId: string;
  product_id: string | null;
  cod_intern: string;
  denumire: string;
  quantity: number;
  unit: string;
  pret_lista?: number;
  pret_unitar: number;
  discount_percent: number;
  pret_final: number;
  subtotal: number;
  price_sheet_item_id?: string | null;
}

function calcLine(item: Partial<QuoteItem>): Pick<QuoteItem, "pret_final" | "subtotal"> {
  const pret = item.pret_unitar ?? 0;
  const disc = item.discount_percent ?? 0;
  const qty = item.quantity ?? 1;
  const pret_final = pret * (1 - disc / 100);
  return { pret_final, subtotal: pret_final * qty };
}

type ProductForQuote = {
  id: string;
  cod_intern: string;
  denumire_completa: string;
  pret_lista: number;
  unit: string | null;
  category_id: string | null;
};

const NewQuote = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id: editId } = useParams<{ id: string }>();
  const isEdit = Boolean(editId);

  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [projectDesc, setProjectDesc] = useState("");
  const [maxDiscountPercent, setMaxDiscountPercent] = useState("");
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [loaded, setLoaded] = useState(!isEdit);

  // Load existing quote for editing
  const { data: existingQuote } = useQuery({
    queryKey: ["quote-edit", editId],
    enabled: isEdit,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select("*")
        .eq("id", editId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: existingItems } = useQuery({
    queryKey: ["quote-items-edit", editId],
    enabled: isEdit,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_items")
        .select("*")
        .eq("quote_id", editId!);
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (isEdit && existingQuote && existingItems && !loaded) {
      setClientName(existingQuote.client_name || "");
      setClientPhone(existingQuote.client_phone || "");
      setClientEmail(existingQuote.client_email || "");
      setProjectDesc(existingQuote.project_description || "");
      setMaxDiscountPercent(
        existingQuote.max_discount_percent === null || existingQuote.max_discount_percent === undefined
          ? ""
          : String(existingQuote.max_discount_percent)
      );
      setItems(
        existingItems.map((it) => ({
          tempId: crypto.randomUUID(),
          product_id: it.product_id,
          cod_intern: it.cod_intern,
          denumire: it.denumire,
          quantity: Number(it.quantity),
          unit: it.unit || "buc",
          pret_unitar: Number(it.pret_unitar),
          discount_percent: Number(it.discount_percent) || 0,
          pret_final: Number(it.pret_final),
          subtotal: Number(it.subtotal),
        }))
      );
      setLoaded(true);
    }
  }, [isEdit, existingQuote, existingItems, loaded]);

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

  const productIdsInQuote = useMemo(
    () => Array.from(new Set(items.map((i) => i.product_id).filter(Boolean))) as string[],
    [items]
  );

  const { data: listPrices = [] } = useQuery({
    queryKey: ["quote-list-prices", productIdsInQuote.join("|")],
    enabled: productIdsInQuote.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, pret_lista")
        .in("id", productIdsInQuote);
      if (error) throw error;
      return data as { id: string; pret_lista: number }[];
    },
  });

  const listPriceByProductId = useMemo(() => {
    const map = new Map<string, number>();
    listPrices.forEach((p) => map.set(p.id, Number(p.pret_lista)));
    return map;
  }, [listPrices]);

  const { data: specialPriceItems = [] } = useQuery({
    queryKey: ["special-price-items", activePriceSheet?.id, productIdsInQuote.join("|")],
    enabled: Boolean(activePriceSheet?.id) && productIdsInQuote.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_sheet_items")
        .select("id, product_id, label, unit, price")
        .eq("price_sheet_id", activePriceSheet!.id)
        .in("product_id", productIdsInQuote)
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
            if (rule.product_id && rule.product_id === productId) matches = true;
            else if (rule.category_id && rule.category_id === categoryId) matches = true;
            else if (!rule.product_id && !rule.category_id) matches = true;
          }
        } else if (rule.rule_type === "promo") {
          if (rule.product_id && rule.product_id === productId) matches = true;
          else if (rule.category_id && rule.category_id === categoryId) matches = true;
          else if (!rule.product_id && !rule.category_id) matches = true;
        }
        if (matches) bestDiscount = Math.max(bestDiscount, Number(rule.discount_percent));
      });
      return bestDiscount;
    },
    [discountRules]
  );

  useEffect(() => {
    if (isEdit) return;
    if (!activePriceSheet?.id) return;
    if (items.length === 0) return;

    setItems((prev) =>
      prev.map((item) => {
        if (!item.product_id) return item;
        if (item.price_sheet_item_id) return item;
        const options = specialPriceItemsByProductId.get(item.product_id);
        if (!options || options.length === 0) return item;
        const first = options[0];
        const updated = {
          ...item,
          price_sheet_item_id: first.id,
          pret_unitar: Number(first.price),
          unit: (first.unit || item.unit) as string,
          discount_percent: 0,
        };
        const calced = calcLine(updated);
        return { ...updated, ...calced };
      })
    );
  }, [activePriceSheet?.id, specialPriceItemsByProductId, items.length, isEdit]);

  const updateItem = useCallback(
    (tempId: string, field: keyof QuoteItem, value: number | string | null) => {
      setItems((prev) =>
        prev.map((item) => {
          if (item.tempId !== tempId) return item;
          const updated = { ...item, [field]: value };
          if (field === "quantity") {
            const autoDisc = findBestDiscount(item.product_id, null, Number(value));
            if (autoDisc > updated.discount_percent) updated.discount_percent = autoDisc;
          }
          const calced = calcLine(updated);
          return { ...updated, ...calced };
        })
      );
    },
    [findBestDiscount]
  );

  const addProduct = useCallback(
    (product: ProductForQuote) => {
      const existing = items.find((i) => i.product_id === product.id);
      if (existing) {
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
        pret_lista: Number(product.pret_lista),
        pret_unitar: Number(product.pret_lista),
        discount_percent: autoDiscount,
        pret_final: 0,
        subtotal: 0,
      };
      const calced = calcLine(base);
      setItems((prev) => [...prev, { ...base, ...calced }]);
    },
    [items, findBestDiscount, updateItem]
  );

  const removeItem = (tempId: string) => {
    setItems((prev) => prev.filter((i) => i.tempId !== tempId));
  };

  const totals = useMemo(() => {
    const totalNet = items.reduce((s, i) => s + i.subtotal, 0);
    const totalTva = totalNet * TVA_RATE;
    const totalGross = totalNet + totalTva;
    const totalList = items.reduce((s, i) => {
      if (!i.product_id) return s;
      const list = i.pret_lista ?? listPriceByProductId.get(i.product_id) ?? 0;
      return s + list * i.quantity;
    }, 0);
    const overallDiscountPercent = totalList > 0 ? (1 - totalNet / totalList) * 100 : 0;
    return { totalNet, totalTva, totalGross, totalList, overallDiscountPercent };
  }, [items, listPriceByProductId]);

  const saveMutation = useMutation({
    mutationFn: async (status: "draft" | "sent") => {
      if (!user) throw new Error("Nu sunteți autentificat");
      if (items.length === 0) throw new Error("Adăugați cel puțin un produs");

      const maxDiscNum = maxDiscountPercent.trim() === "" ? null : Number(maxDiscountPercent);
      if (maxDiscNum !== null && (!Number.isFinite(maxDiscNum) || maxDiscNum < 0 || maxDiscNum > 100)) {
        throw new Error("Discount maxim total invalid");
      }
      if (maxDiscNum !== null && totals.overallDiscountPercent > maxDiscNum + 1e-9) {
        throw new Error(
          `Discount total (${totals.overallDiscountPercent.toFixed(2)}%) depășește maximul (${maxDiscNum.toFixed(2)}%)`
        );
      }

      const quotePayload = {
        user_id: user.id,
        client_name: clientName || null,
        client_phone: clientPhone || null,
        client_email: clientEmail || null,
        project_description: projectDesc || null,
        status,
        total_net: totals.totalNet,
        total_tva: totals.totalTva,
        total_gross: totals.totalGross,
        max_discount_percent: maxDiscNum,
      };

      let quoteId: string;

      if (isEdit && editId) {
        const { error } = await supabase
          .from("quotes")
          .update(quotePayload)
          .eq("id", editId);
        if (error) throw error;
        quoteId = editId;

        // Delete old items, insert new
        const { error: delErr } = await supabase
          .from("quote_items")
          .delete()
          .eq("quote_id", editId);
        if (delErr) throw delErr;
      } else {
        const { data: quote, error: qError } = await supabase
          .from("quotes")
          .insert(quotePayload)
          .select("id")
          .single();
        if (qError) throw qError;
        quoteId = quote.id;
      }

      const quoteItems = items.map((item) => ({
        quote_id: quoteId,
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

      const { error: iError } = await supabase.from("quote_items").insert(quoteItems);
      if (iError) throw iError;
      return quoteId;
    },
    onSuccess: (_, status) => {
      queryClient.invalidateQueries({ queryKey: ["my-quotes"] });
      toast.success(
        status === "draft" ? "Oferta a fost salvată ca ciornă" : "Oferta a fost trimisă"
      );
      navigate("/quotes");
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Eroare la salvare");
    },
  });

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-5xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {isEdit ? "Editare ofertă" : "Ofertă nouă"}
          </h1>
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
                <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Nume / Firmă" />
              </div>
              <div>
                <Label className="text-xs">Telefon</Label>
                <Input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="07xx xxx xxx" />
              </div>
              <div>
                <Label className="text-xs">Email</Label>
                <Input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="email@client.ro" />
              </div>
            </div>
            <div className="mt-3">
              <Label className="text-xs">Descriere proiect</Label>
              <Textarea value={projectDesc} onChange={(e) => setProjectDesc(e.target.value)} placeholder="Ex: Construcție casă P+1, faza zidărie..." rows={2} />
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
                <Table className="min-w-[900px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[80px]">Cod</TableHead>
                      <TableHead>Denumire</TableHead>
                      <TableHead className="w-[70px] text-right">Cant.</TableHead>
                      <TableHead className="w-[50px]">UM</TableHead>
                      <TableHead className="w-[160px]">Listă</TableHead>
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
                          <Input type="number" min={0.01} step="any" value={item.quantity}
                            onChange={(e) => updateItem(item.tempId, "quantity", parseFloat(e.target.value) || 0)}
                            className="h-8 w-[65px] text-right text-sm" />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{item.unit}</TableCell>
                        <TableCell>
                          {item.product_id && specialPriceItemsByProductId.get(item.product_id)?.length ? (
                            <Select
                              value={item.price_sheet_item_id || "list"}
                              onValueChange={(v) => {
                                if (v === "list") {
                                  const list = item.pret_lista ?? listPriceByProductId.get(item.product_id!) ?? 0;
                                  updateItem(item.tempId, "price_sheet_item_id", null);
                                  updateItem(item.tempId, "pret_unitar", list);
                                  updateItem(item.tempId, "discount_percent", 0);
                                  return;
                                }
                                const opt = specialPriceItemsByProductId
                                  .get(item.product_id!)
                                  ?.find((o) => o.id === v);
                                if (!opt) return;
                                updateItem(item.tempId, "price_sheet_item_id", opt.id);
                                updateItem(item.tempId, "pret_unitar", Number(opt.price));
                                if (opt.unit) updateItem(item.tempId, "unit", opt.unit);
                                updateItem(item.tempId, "discount_percent", 0);
                              }}
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder="Alege..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="list">Preț de listă</SelectItem>
                                {specialPriceItemsByProductId.get(item.product_id)!.map((opt) => (
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
                          <Input type="number" min={0} step="any" value={item.pret_unitar}
                            onChange={(e) => updateItem(item.tempId, "pret_unitar", parseFloat(e.target.value) || 0)}
                            className="h-8 w-[85px] text-right text-sm" />
                        </TableCell>
                        <TableCell>
                          <Input type="number" min={0} max={100} step="0.5" value={item.discount_percent}
                            onChange={(e) => updateItem(item.tempId, "discount_percent", parseFloat(e.target.value) || 0)}
                            className="h-8 w-[65px] text-right text-sm" />
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">{item.pret_final.toFixed(2)}</TableCell>
                        <TableCell className="text-right text-sm font-bold">{item.subtotal.toFixed(2)}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => removeItem(item.tempId)}>
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
              <div className="mb-4 max-w-xs">
                <Label>Discount maxim total (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={maxDiscountPercent}
                  onChange={(e) => setMaxDiscountPercent(e.target.value)}
                />
              </div>
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
                  <span className="font-medium">{totals.totalNet.toFixed(2)} lei</span>
                </div>
                <div className="flex justify-between w-full max-w-xs">
                  <span className="text-muted-foreground">TVA ({TVA_PERCENT}%):</span>
                  <span className="font-medium">{totals.totalTva.toFixed(2)} lei</span>
                </div>
                <div className="flex justify-between w-full max-w-xs border-t pt-1 mt-1">
                  <span className="font-bold">Total cu TVA:</span>
                  <span className="font-bold text-primary text-lg">{totals.totalGross.toFixed(2)} lei</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-end pb-8">
          <Button variant="outline" onClick={() => saveMutation.mutate("draft")}
            disabled={saveMutation.isPending || items.length === 0}>
            <Save className="h-4 w-4 mr-1" /> Salvează ciornă
          </Button>
          <Button onClick={() => saveMutation.mutate("sent")}
            disabled={saveMutation.isPending || items.length === 0}>
            <Send className="h-4 w-4 mr-1" /> Trimite oferta
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default NewQuote;
