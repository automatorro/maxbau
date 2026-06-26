import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProductPicker } from "@/components/ProductPicker";
import { EquivalentsDialog } from "@/components/EquivalentsDialog";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Trash2, Save, Send, Plus, Download, Calculator, ArrowLeftRight } from "lucide-react";
import { toast } from "sonner";
import { TVA_PERCENT, TVA_RATE } from "@/lib/utils";
import { exportQuoteToExcel } from "@/lib/exportExcel";

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
  price_variant_id?: string | null;
}

function calcLine(item: Partial<QuoteItem>): Pick<QuoteItem, "pret_final" | "subtotal"> {
  const pret = item.pret_unitar ?? 0;
  const disc = item.discount_percent ?? 0;
  const qty = item.quantity ?? 1;
  const pret_final = pret * (1 - disc / 100);
  return { pret_final, subtotal: pret_final * qty };
}

function getProductSpecSummary(specifications: any) {
  const specs = specifications || {};
  const ftSpecs = specs.fisa_tehnica_specs || null;
  const aiInfo = specs.ai_info || null;
  
  const source = ftSpecs ? "verified" : (aiInfo ? "ai" : "none");
  
  let conductivitate = null;
  let clasa_foc = null;
  let consum = null;
  
  if (ftSpecs) {
    conductivitate = ftSpecs.conductivitate_termica || null;
    clasa_foc = ftSpecs.clasa_reactie_foc || null;
    consum = ftSpecs.consum || null;
  } else if (aiInfo) {
    conductivitate = aiInfo.conductivitate_termica || null;
    clasa_foc = aiInfo.clasa_reactie_foc || null;
    consum = aiInfo.consum || null;
  }
  
  return { source, conductivitate, clasa_foc, consum };
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
  
  const [equivalentsOpen, setEquivalentsOpen] = useState(false);
  const [itemForEquivalents, setItemForEquivalents] = useState<QuoteItem | null>(null);

  // States for Proposal 1: Save as Recipe
  const [saveAsRecipeOpen, setSaveAsRecipeOpen] = useState(false);
  const [recipeName, setRecipeName] = useState("");
  const [recipeCategory, setRecipeCategory] = useState("Tencuieli & Gleturi");
  const [customCategory, setCustomCategory] = useState("");
  const [referenceQuantity, setReferenceQuantity] = useState("100");
  const [referenceUnit, setReferenceUnit] = useState("m²");
  const [savingRecipe, setSavingRecipe] = useState(false);

  const handleSaveAsRecipe = async () => {
    if (!user) {
      toast.error("Nu sunteți autentificat");
      return;
    }
    const name = recipeName.trim();
    if (!name) {
      toast.error("Vă rugăm să introduceți un nume pentru rețetă");
      return;
    }
    const refQty = parseFloat(referenceQuantity);
    if (!refQty || refQty <= 0) {
      toast.error("Cantitatea de referință trebuie să fie mai mare decât 0");
      return;
    }

    const finalCategory = recipeCategory === "custom" ? customCategory.trim() : recipeCategory;
    if (!finalCategory) {
      toast.error("Vă rugăm să specificați o categorie");
      return;
    }

    setSavingRecipe(true);
    try {
      const materials = items.map((item, idx) => {
        const nameTokens = item.denumire
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .split(/[^a-z0-9ăâîșț]+/g)
          .filter((t) => t.length >= 2);

        return {
          position: idx + 1,
          description: item.denumire,
          um: item.unit,
          consumption_per_m2: Number((item.quantity / refQty).toFixed(5)),
          keywords: Array.from(new Set(nameTokens)),
          cod_intern: item.cod_intern,
        };
      });

      const { error } = await supabase.from("retete_constructii").insert({
        id: crypto.randomUUID(),
        recipe_name: name,
        category: finalCategory,
        unit: referenceUnit,
        status: "active",
        materials: materials as any,
      });

      if (error) throw error;

      toast.success(`Rețeta „${name}” a fost creată cu succes și este disponibilă în modulul de rețete!`);
      setSaveAsRecipeOpen(false);
      setRecipeName("");
      setCustomCategory("");
      setRecipeCategory("Tencuieli & Gleturi");
      setReferenceQuantity("100");
    } catch (e: any) {
      toast.error(e instanceof Error ? e.message : "Eroare la crearea rețetei");
    } finally {
      setSavingRecipe(false);
    }
  };

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
        .select("id, pret_lista, category_id, specifications")
        .in("id", productIdsInQuote);
      if (error) throw error;
      return data as { id: string; pret_lista: number; category_id: string | null; specifications: any }[];
    },
  });

  const { data: priceVariants = [] } = useQuery({
    queryKey: ["quote-price-variants", productIdsInQuote.join("|")],
    enabled: productIdsInQuote.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_prices")
        .select("id, product_id, supplier_id, price_type, price, currency, suppliers(name)")
        .in("product_id", productIdsInQuote)
        .is("valid_to", null)
        .order("price", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const listPriceByProductId = useMemo(() => {
    const map = new Map<string, number>();
    listPrices.forEach((p) => map.set(p.id, Number(p.pret_lista)));
    return map;
  }, [listPrices]);

  const productDetailsByProductId = useMemo(() => {
    const map = new Map<string, { category_id: string | null; specifications: any }>();
    listPrices.forEach((p) => map.set(p.id, { category_id: p.category_id, specifications: p.specifications }));
    return map;
  }, [listPrices]);

  const productForEquivalents = useMemo(() => {
    if (!itemForEquivalents || !itemForEquivalents.product_id) return null;
    const details = productDetailsByProductId.get(itemForEquivalents.product_id);
    return {
      id: itemForEquivalents.product_id,
      cod_intern: itemForEquivalents.cod_intern,
      denumire_completa: itemForEquivalents.denumire,
      category_id: details?.category_id || null,
    };
  }, [itemForEquivalents, productDetailsByProductId]);

  const handleReplaceItem = (newProduct: {
    id: string;
    cod_intern: string;
    denumire_completa: string;
    pret_lista: number;
    unit: string | null;
  }) => {
    if (!itemForEquivalents) return;
    
    setItems((prev) =>
      prev.map((item) => {
        if (item.tempId !== itemForEquivalents.tempId) return item;
        
        const categoryId = productForEquivalents?.category_id || null;
        const autoDisc = findBestDiscount(newProduct.id, categoryId, item.quantity);
        
        const updated = {
          ...item,
          product_id: newProduct.id,
          cod_intern: newProduct.cod_intern,
          denumire: newProduct.denumire_completa,
          unit: newProduct.unit || "buc",
          pret_lista: newProduct.pret_lista,
          pret_unitar: newProduct.pret_lista,
          discount_percent: autoDisc,
          price_variant_id: null,
        };
        const calced = calcLine(updated);
        return { ...updated, ...calced };
      })
    );
    setItemForEquivalents(null);
  };



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
      <div className="space-y-4 w-full">
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
              <>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                <Table className="min-w-[900px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[80px]">Cod</TableHead>
                      <TableHead>Denumire</TableHead>
                      <TableHead className="w-[70px] text-right">Cant.</TableHead>
                      <TableHead className="w-[50px]">UM</TableHead>
                      <TableHead className="w-[160px]">Grile preț</TableHead>
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
                        <TableCell className="text-sm max-w-[280px]">
                          <div className="flex flex-col gap-1">
                            <span className="font-medium leading-snug line-clamp-2">{item.denumire}</span>
                            {item.product_id && (() => {
                              const details = productDetailsByProductId.get(item.product_id);
                              if (!details) return null;
                              const { source, conductivitate, clasa_foc, consum } = getProductSpecSummary(details.specifications);
                              return (
                                <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                  {source === "verified" && (
                                    <Badge variant="outline" className="text-[9px] py-0 px-1 border-emerald-500/20 text-emerald-700 bg-emerald-50/50">
                                      🟢 Fișă Verificată
                                    </Badge>
                                  )}
                                  {source === "ai" && (
                                    <Badge variant="outline" className="text-[9px] py-0 px-1 border-amber-500/20 text-amber-700 bg-amber-50/50">
                                      🟡 Date AI
                                    </Badge>
                                  )}
                                  {source === "none" && (
                                    <Badge variant="outline" className="text-[9px] py-0 px-1 border-red-500/20 text-red-700 bg-red-50/50">
                                      🔴 Fără Date
                                    </Badge>
                                  )}
                                  {conductivitate && (
                                    <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded border" title="Conductivitate termică">
                                      λ: {conductivitate}
                                    </span>
                                  )}
                                  {clasa_foc && (
                                    <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded border" title="Clasă reacție la foc">
                                      Foc: {clasa_foc}
                                    </span>
                                  )}
                                  {consum && (
                                    <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded border" title="Consum specific">
                                      Consum: {consum}
                                    </span>
                                  )}
                                  <Link 
                                    to={`/catalog/product/${item.product_id}`} 
                                    className="text-[10px] text-primary hover:underline font-semibold ml-auto"
                                    target="_blank"
                                  >
                                    Detalii →
                                  </Link>
                                </div>
                              );
                            })()}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Input type="number" min={0.01} step="any" value={item.quantity}
                            onChange={(e) => updateItem(item.tempId, "quantity", parseFloat(e.target.value) || 0)}
                            className="h-8 w-[65px] text-right text-sm" />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{item.unit}</TableCell>
                        <TableCell>
                          {(() => {
                            const variants = priceVariants.filter((v: any) => v.product_id === item.product_id);
                            if (variants.length === 0) {
                              return <span className="text-xs text-muted-foreground text-center block">—</span>;
                            }
                            return (
                              <Select 
                                value={item.price_variant_id || ""} 
                                onValueChange={(val) => {
                                  const variant = variants.find((v: any) => v.id === val);
                                  if (variant) {
                                    updateItem(item.tempId, "price_variant_id", val);
                                    updateItem(item.tempId, "pret_unitar", Number(variant.price));
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
                          })()}
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
                          <div className="flex items-center gap-1">
                            {item.product_id && (() => {
                              const details = productDetailsByProductId.get(item.product_id);
                              const categoryId = details?.category_id || null;
                              if (!categoryId) return null;
                              return (
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-7 w-7 text-primary hover:text-primary-active hover:bg-primary/5"
                                  onClick={() => {
                                    setItemForEquivalents(item);
                                    setEquivalentsOpen(true);
                                  }}
                                  title="Schimbă cu un echivalent tehnic"
                                >
                                  <ArrowLeftRight className="h-3.5 w-3.5" />
                                </Button>
                              );
                            })()}
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => removeItem(item.tempId)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>

                {/* Mobile cards */}
                <div className="md:hidden divide-y divide-border/40">
                  {items.map((item) => (
                    <div key={item.tempId} className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                            <Badge variant="outline" className="text-xs font-mono border-primary/30 text-primary">
                              {item.cod_intern}
                            </Badge>
                            {item.product_id && (() => {
                              const details = productDetailsByProductId.get(item.product_id);
                              if (!details) return null;
                              const { source } = getProductSpecSummary(details.specifications);
                              return (
                                <>
                                  {source === "verified" && (
                                    <Badge variant="outline" className="text-[9px] py-0 px-1 border-emerald-500/20 text-emerald-700 bg-emerald-50/50">
                                      🟢 Fișă
                                    </Badge>
                                  )}
                                  {source === "ai" && (
                                    <Badge variant="outline" className="text-[9px] py-0 px-1 border-amber-500/20 text-amber-700 bg-amber-50/50">
                                      🟡 AI
                                    </Badge>
                                  )}
                                  {source === "none" && (
                                    <Badge variant="outline" className="text-[9px] py-0 px-1 border-red-500/20 text-red-700 bg-red-50/50">
                                      🔴 Fără date
                                    </Badge>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                          <p className="text-sm font-medium leading-snug mb-1">{item.denumire}</p>
                          
                          {item.product_id && (() => {
                            const details = productDetailsByProductId.get(item.product_id);
                            if (!details) return null;
                            const { conductivitate, clasa_foc, consum } = getProductSpecSummary(details.specifications);
                            if (!conductivitate && !clasa_foc && !consum) return null;
                            return (
                              <div className="flex flex-wrap gap-1 mb-2">
                                {conductivitate && (
                                  <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded border">
                                    λ: {conductivitate}
                                  </span>
                                )}
                                {clasa_foc && (
                                  <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded border">
                                    Foc: {clasa_foc}
                                  </span>
                                )}
                                {consum && (
                                  <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded border">
                                    Consum: {consum}
                                  </span>
                                )}
                              </div>
                            );
                          })()}

                          {(() => {
                            const variants = priceVariants.filter((v: any) => v.product_id === item.product_id);
                            if (variants.length > 0) {
                              return (
                                <div className="mt-2">
                                  <Select 
                                    value={item.price_variant_id || ""} 
                                    onValueChange={(val) => {
                                      const variant = variants.find((v: any) => v.id === val);
                                      if (variant) {
                                        updateItem(item.tempId, "price_variant_id", val);
                                        updateItem(item.tempId, "pret_unitar", Number(variant.price));
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
                        <div className="flex items-center gap-1 shrink-0">
                          {item.product_id && (() => {
                            const details = productDetailsByProductId.get(item.product_id);
                            const categoryId = details?.category_id || null;
                            if (!categoryId) return null;
                            return (
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-7 w-7 text-primary hover:text-primary-active hover:bg-primary/5"
                                onClick={() => {
                                  setItemForEquivalents(item);
                                  setEquivalentsOpen(true);
                                }}
                                title="Schimbă cu un echivalent tehnic"
                              >
                                <ArrowLeftRight className="h-3.5 w-3.5" />
                              </Button>
                            );
                          })()}
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
                            onClick={() => removeItem(item.tempId)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Cant. ({item.unit})</p>
                          <Input type="number" min={0.01} step="any" value={item.quantity}
                            onChange={(e) => updateItem(item.tempId, "quantity", parseFloat(e.target.value) || 0)}
                            className="h-8 text-right text-sm" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Preț/UM</p>
                          <Input type="number" min={0} step="any" value={item.pret_unitar}
                            onChange={(e) => updateItem(item.tempId, "pret_unitar", parseFloat(e.target.value) || 0)}
                            className="h-8 text-right text-sm" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Disc.%</p>
                          <Input type="number" min={0} max={100} step="0.5" value={item.discount_percent}
                            onChange={(e) => updateItem(item.tempId, "discount_percent", parseFloat(e.target.value) || 0)}
                            className="h-8 text-right text-sm" />
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-muted-foreground">
                          Preț final: <span className="font-medium text-foreground">{item.pret_final.toFixed(2)} lei</span>
                        </span>
                        <span className="text-sm font-bold text-primary">{item.subtotal.toFixed(2)} lei</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
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
        <div className="flex flex-col sm:flex-row gap-3 sm:justify-end pb-8">
          <Button
            disabled={items.length === 0}
            variant="outline"
            className="w-full sm:w-auto gap-1 border-primary/30 text-primary hover:bg-primary/5 sm:mr-auto"
            onClick={() => {
              setRecipeName(clientName ? `Rețetă ${clientName}` : "");
              setSaveAsRecipeOpen(true);
            }}
          >
            <Calculator className="h-4 w-4" /> Salvează ca rețetă
          </Button>
          <Button
            disabled={items.length === 0}
            className="w-full sm:w-auto"
            onClick={() => {
              exportQuoteToExcel(
                {
                  nr_oferta: editId ? editId.slice(0, 8).toUpperCase() : "CIORNĂ",
                  data: new Date().toLocaleDateString("ro-RO"),
                  client_name: clientName,
                  client_phone: clientPhone,
                  client_email: clientEmail,
                  project_description: projectDesc,
                  total_net: totals.totalNet,
                  total_tva: totals.totalTva,
                  total_gross: totals.totalGross,
                },
                items.map((item) => ({
                  cod_intern: item.cod_intern,
                  denumire: item.denumire,
                  quantity: item.quantity,
                  unit: item.unit,
                  pret_unitar: item.pret_unitar,
                  discount_percent: item.discount_percent,
                  pret_final: item.pret_final,
                  subtotal: item.subtotal,
                }))
              );
              toast.success("Fișier Excel descărcat");
            }}
          >
            <Download className="h-4 w-4 mr-1" /> Exportă Excel
          </Button>
          <Button variant="outline" onClick={() => saveMutation.mutate("draft")}
            disabled={saveMutation.isPending || items.length === 0}
            className="w-full sm:w-auto">
            <Save className="h-4 w-4 mr-1" /> Salvează ciornă
          </Button>
          <Button onClick={() => saveMutation.mutate("sent")}
            disabled={saveMutation.isPending || items.length === 0}
            className="w-full sm:w-auto">
            <Send className="h-4 w-4 mr-1" /> Trimite oferta
          </Button>
        </div>

        {/* Dialog pentru Salvare ca Rețetă */}
        <Dialog open={saveAsRecipeOpen} onOpenChange={setSaveAsRecipeOpen}>
          <DialogContent className="max-w-md sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Salvează ca rețetă / șablon</DialogTitle>
              <DialogDescription>
                Convertește produsele din această ofertă într-o rețetă reutilizabilă pe bază de suprafață.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-3">
              <div>
                <Label htmlFor="recipe-name" className="text-xs font-semibold">Nume Rețetă / Șablon</Label>
                <Input
                  id="recipe-name"
                  value={recipeName}
                  onChange={(e) => setRecipeName(e.target.value)}
                  placeholder="Ex: Tencuială mecanizată MPI 25 + BetonPrimer"
                  className="mt-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="recipe-category" className="text-xs font-semibold">Categorie</Label>
                  <Select value={recipeCategory} onValueChange={setRecipeCategory}>
                    <SelectTrigger id="recipe-category" className="mt-1">
                      <SelectValue placeholder="Alege categorie" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Tencuieli & Gleturi">Tencuieli & Gleturi</SelectItem>
                      <SelectItem value="Termoizolații">Termoizolații</SelectItem>
                      <SelectItem value="Adezivi & Șape">Adezivi & Șape</SelectItem>
                      <SelectItem value="Gips-Carton">Gips-Carton</SelectItem>
                      <SelectItem value="Pardoseli">Pardoseli</SelectItem>
                      <SelectItem value="Altele">Altele</SelectItem>
                      <SelectItem value="custom" className="text-primary font-medium">✨ Categorie personalizată...</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="reference-unit" className="text-xs font-semibold">U.M. de Referință</Label>
                  <Select value={referenceUnit} onValueChange={setReferenceUnit}>
                    <SelectTrigger id="reference-unit" className="mt-1">
                      <SelectValue placeholder="Alege U.M." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="m²">m² (mp)</SelectItem>
                      <SelectItem value="ml">ml (metri liniari)</SelectItem>
                      <SelectItem value="buc">buc (bucăți)</SelectItem>
                      <SelectItem value="mc">mc (metri cubi)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {recipeCategory === "custom" && (
                <div className="animate-in slide-in-from-top-1 duration-200">
                  <Label htmlFor="custom-category" className="text-xs font-semibold text-primary">Nume Categorie Personalizată</Label>
                  <Input
                    id="custom-category"
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    placeholder="Introduceți o categorie nouă (ex: Zidărie, Acoperișuri)"
                    className="mt-1 border-primary/40 focus-visible:ring-primary"
                  />
                </div>
              )}

              <div>
                <Label htmlFor="reference-qty" className="text-xs font-semibold">
                  Cantitate / Suprafață de Referință a Ofertei
                </Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    id="reference-qty"
                    type="number"
                    min={0.01}
                    value={referenceQuantity}
                    onChange={(e) => setReferenceQuantity(e.target.value)}
                    className="flex-1"
                  />
                  <span className="text-sm font-medium text-muted-foreground bg-muted px-3 py-2 rounded-md border">
                    {referenceUnit}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Sistemul va împărți cantitățile din ofertă la această suprafață pentru a determina consumul specific per {referenceUnit}.
                </p>
              </div>

              {/* Preview Table */}
              <div className="border rounded-md overflow-hidden bg-muted/20">
                <div className="bg-muted/50 px-3 py-1.5 border-b flex justify-between text-xs font-semibold text-muted-foreground">
                  <span>Material preview</span>
                  <span>Consum calculat</span>
                </div>
                <div className="max-h-[140px] overflow-y-auto px-3 divide-y divide-border/40">
                  {items.map((item) => {
                    const qty = item.quantity;
                    const ref = parseFloat(referenceQuantity) || 100;
                    const consumption = ref > 0 ? (qty / ref).toFixed(4) : "0.0000";
                    return (
                      <div key={item.tempId} className="py-2 flex items-center justify-between text-xs gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{item.denumire}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">
                            {qty} {item.unit} în ofertă
                          </p>
                        </div>
                        <div className="shrink-0 font-bold text-primary text-right whitespace-nowrap">
                          {consumption} {item.unit} / {referenceUnit}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSaveAsRecipeOpen(false)} disabled={savingRecipe}>
                Anulează
              </Button>
              <Button onClick={handleSaveAsRecipe} disabled={savingRecipe || !recipeName.trim() || (recipeCategory === "custom" && !customCategory.trim())}>
                {savingRecipe ? "Se salvează..." : "Creează Rețetă"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {/* Equivalents Dialog */}
        <EquivalentsDialog
          open={equivalentsOpen}
          onOpenChange={setEquivalentsOpen}
          product={productForEquivalents}
          onReplace={handleReplaceItem}
        />
      </div>
    </DashboardLayout>
  );
};

export default NewQuote;
