import { useState, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Search, Upload, Loader2, Pencil, Trash2, ChevronDown, ChevronUp, Sparkles, Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const BATCH_SIZE = 5;
const PAGE_SIZE = 50;

interface AiInfo {
  consum?: string;
  ambalaj?: string;
  alternative?: string[];
  compatibilitati?: string;
  utilizare?: string;
  updated_at?: string;
}

interface Product {
  id: string;
  cod_intern: string;
  denumire_completa: string;
  unit: string | null;
  pret_lista: number;
  brand: string | null;
  manufacturer: string | null;
  supplier_id: string | null;
  category_id: string | null;
  packaging: string | null;
  pack_quantity: string | null;
  specifications: Record<string, unknown> | null;
  categories?: { name: string } | null;
}

const getAiInfo = (p: Product): AiInfo | null => {
  const specs = p.specifications || {};
  return (specs.ai_info as AiInfo) || null;
};

function ProductPricesTab({ productId }: { productId: string }) {
  const { data: prices, isLoading } = useQuery({
    queryKey: ["product-prices", productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_prices")
        .select(`
          id, price_type, price, currency, min_quantity, unit, valid_from, valid_to,
          suppliers ( name )
        `)
        .eq("product_id", productId)
        .order("valid_to", { ascending: false, nullsFirst: true })
        .order("valid_from", { ascending: false });
      if (error) throw error;
      return data;
    }
  });

  if (isLoading) return <div className="py-8 text-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" /> Se încarcă prețurile...</div>;
  if (!prices?.length) return <div className="text-muted-foreground text-sm py-8 text-center border rounded-md bg-muted/20">Nu există grile de preț pentru acest produs. (Importați din Excel)</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Furnizor</TableHead>
              <TableHead>Tip preț</TableHead>
              <TableHead className="text-right">Preț</TableHead>
              <TableHead className="w-[100px] text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {prices.map((p: any) => (
              <TableRow key={p.id} className={p.valid_to ? "opacity-50 bg-muted/20" : ""}>
                <TableCell className="font-medium text-xs">{p.suppliers?.name || "Nespecificat"}</TableCell>
                <TableCell className="text-xs">{p.price_type}</TableCell>
                <TableCell className="text-right text-xs font-bold">{p.price} {p.currency}</TableCell>
                <TableCell className="text-center">
                  {p.valid_to ? (
                    <span className="text-[10px] text-muted-foreground" title={new Date(p.valid_to).toLocaleString()}>Arhivat</span>
                  ) : (
                    <Badge variant="outline" className="border-green-500/50 text-green-700 bg-green-50">Activ</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

const AdminProducts = () => {
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [importProgress, setImportProgress] = useState(0);
  const [page, setPage] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  
  // Expanded row and Edit states
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [deleteProductId, setDeleteProductId] = useState<string | null>(null);
  const [aiLoadingId, setAiLoadingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    cod_intern: "",
    denumire_completa: "",
    pret_lista: "",
    unit: "",
    category_id: "none",
    brand: "",
    manufacturer: "",
    supplier_id: "none",
    consum: "",
    ambalaj: "",
    alternative: "",
    compatibilitati: "",
    utilizare: "",
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-products", search, categoryFilter, supplierFilter, page],
    queryFn: async () => {
      let query = supabase
        .from("products")
        .select("*, categories(name)", { count: "exact" })
        .order("cod_intern");

      if (search) {
        const tokens = search.split(/\s+/).filter(Boolean);
        for (const raw of tokens) {
          const token = raw.replace(/,/g, "\\,");
          query = query.or(`denumire_completa.ilike.%${token}%,cod_intern.ilike.%${token}%`);
        }
      }

      if (categoryFilter !== "all") {
        if (categoryFilter === "none") {
          query = query.is("category_id", null);
        } else {
          query = query.eq("category_id", categoryFilter);
        }
      }

      if (supplierFilter !== "all") {
        if (supplierFilter === "none") {
          query = query.is("supplier_id", null);
        } else {
          query = query.eq("supplier_id", supplierFilter);
        }
      }

      const { data, error, count } = await query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (error) throw error;
      return { products: (data as any) as Product[], total: count ?? 0 };
    },
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const products = data?.products || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(0);
    setExpandedRowId(null);
  };

  const handleImport = async () => {
    setImporting(true);
    setImportProgress(0);
    setImportStatus("Se descoperă URL-urile produselor de pe maxbau.ro...");

    try {
      const { data: mapData, error: mapError } = await supabase.functions.invoke("scrape-maxbau", {
        body: { action: "map" },
      });

      if (mapError || !mapData?.success) {
        throw new Error(mapData?.error || mapError?.message || "Eroare la maparea site-ului");
      }

      const productUrls: string[] = mapData.productUrls || [];
      if (productUrls.length === 0) {
        toast({ title: "Niciun produs găsit", description: "Nu s-au găsit URL-uri de produse pe maxbau.ro.", variant: "destructive" });
        setImporting(false);
        return;
      }

      setImportStatus(`S-au găsit ${productUrls.length} produse. Se importă...`);

      let totalImported = 0;
      let totalErrors = 0;
      const allErrors: string[] = [];

      for (let i = 0; i < productUrls.length; i += BATCH_SIZE) {
        const batch = productUrls.slice(i, i + BATCH_SIZE);
        const progress = Math.round(((i + batch.length) / productUrls.length) * 100);
        setImportProgress(progress);
        setImportStatus(
          `Se importă produsele ${i + 1}-${Math.min(i + BATCH_SIZE, productUrls.length)} din ${productUrls.length}...`
        );

        const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke("scrape-maxbau", {
          body: { action: "scrape", urls: batch },
        });

        if (scrapeError) {
          allErrors.push(`Batch ${i}: ${scrapeError.message}`);
          totalErrors += batch.length;
          continue;
        }

        totalImported += scrapeData?.imported || 0;
        totalErrors += scrapeData?.errors || 0;
        if (scrapeData?.errorDetails) {
          allErrors.push(...scrapeData.errorDetails);
        }
      }

      setImportProgress(100);
      setImportStatus("");

      toast({
        title: "Import finalizat!",
        description: `${totalImported} produse importate, ${totalErrors} erori.`,
      });

      if (allErrors.length > 0) {
        console.warn("Import errors:", allErrors);
      }

      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
    } catch (error) {
      console.error("Import error:", error);
      toast({
        title: "Eroare la import",
        description: error instanceof Error ? error.message : "Eroare necunoscută",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  const openEdit = (product: Product) => {
    setEditProduct(product);
    const ai = getAiInfo(product);
    setForm({
      cod_intern: product.cod_intern || "",
      denumire_completa: product.denumire_completa || "",
      pret_lista: product.pret_lista?.toString() || "0",
      unit: product.unit || "",
      category_id: product.category_id || "none",
      brand: product.brand || "",
      manufacturer: product.manufacturer || "",
      supplier_id: product.supplier_id || "none",
      consum: ai?.consum || "",
      ambalaj: ai?.ambalaj || "",
      alternative: ai?.alternative?.join(", ") || "",
      compatibilitati: ai?.compatibilitati || "",
      utilizare: ai?.utilizare || "",
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editProduct) return;
      
      const aiInfo: AiInfo = {
        consum: form.consum.trim() || undefined,
        ambalaj: form.ambalaj.trim() || undefined,
        alternative: form.alternative.trim()
          ? form.alternative.split(",").map(s => s.trim()).filter(Boolean)
          : [],
        compatibilitati: form.compatibilitati.trim() || undefined,
        utilizare: form.utilizare.trim() || undefined,
      };

      const existingSpecs = (editProduct.specifications as Record<string, unknown>) || {};
      const newSpecs = {
        ...existingSpecs,
        ai_info: { ...aiInfo, updated_at: new Date().toISOString() },
      };

      const updateData = {
        cod_intern: form.cod_intern,
        denumire_completa: form.denumire_completa,
        pret_lista: parseFloat(form.pret_lista) || 0,
        unit: form.unit,
        category_id: form.category_id === "none" ? null : form.category_id,
        brand: form.brand || null,
        manufacturer: form.manufacturer || null,
        supplier_id: form.supplier_id === "none" ? null : form.supplier_id,
        specifications: newSpecs,
      };

      const { error, data: updateResult, count } = await supabase
        .from("products")
        .update(updateData)
        .eq("id", editProduct.id)
        .select();
      if (error) throw error;
      if (!updateResult || updateResult.length === 0) {
        throw new Error("Salvarea a eșuat — verificați dacă aveți rolul de administrator (RLS).");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      toast({ title: "Produs salvat cu succes" });
      setEditProduct(null);
    },
    onError: (e) => toast({ title: "Eroare la salvare", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      toast({ title: "Produs șters cu succes" });
      setDeleteProductId(null);
    },
    onError: (e) => toast({ title: "Eroare la ștergere", description: e.message, variant: "destructive" }),
  });

  const fetchAiData = async (productId: string) => {
    setAiLoadingId(productId);
    try {
      const { data, error } = await supabase.functions.invoke("ai-product-info", {
        body: { product_ids: [productId] },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Eroare AI");

      const aiResult = data.data?.[productId] as AiInfo | undefined;
      if (aiResult) {
        const p = products.find(prod => prod.id === productId);
        if (p) {
          const existingSpecs = (p.specifications as Record<string, unknown>) || {};
          const newSpecs = {
            ...existingSpecs,
            ai_info: { ...aiResult, updated_at: new Date().toISOString() },
          };
          await supabase.from("products").update({ specifications: newSpecs }).eq("id", productId);
          queryClient.invalidateQueries({ queryKey: ["admin-products"] });
          toast({ title: "Date tehnice AI obținute și salvate" });
        }
      } else {
        toast({ title: "AI nu a returnat date pentru acest produs" });
      }
    } catch (e) {
      console.error("AI fetch error:", e);
      toast({ title: "Eroare la obținerea datelor AI", variant: "destructive" });
    } finally {
      setAiLoadingId(null);
    }
  };

  const toggleExpand = (id: string) => {
    if (expandedRowId === id) setExpandedRowId(null);
    else setExpandedRowId(id);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Administrare produse</h1>
            <p className="text-muted-foreground">Gestionează catalogul și datele tehnice ale produselor</p>
          </div>
          <Button onClick={handleImport} disabled={importing} size="sm">
            {importing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            <span className="hidden sm:inline">{importing ? "Se importă..." : "Import de pe maxbau.ro"}</span>
            <span className="sm:hidden">{importing ? "..." : "Import"}</span>
          </Button>
        </div>

        {importing && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-4">
            <p className="text-sm text-muted-foreground">{importStatus}</p>
            <Progress value={importProgress} className="h-2" />
            <p className="text-xs text-muted-foreground text-right">{importProgress}%</p>
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Caută produse..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          
          <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setPage(0); }}>
            <SelectTrigger className="w-full md:w-[200px]">
              <SelectValue placeholder="Toate categoriile" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toate categoriile</SelectItem>
              <SelectItem value="none">Fără categorie</SelectItem>
              {categories.map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={supplierFilter} onValueChange={(v) => { setSupplierFilter(v); setPage(0); }}>
            <SelectTrigger className="w-full md:w-[200px]">
              <SelectValue placeholder="Toți furnizorii" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toți furnizorii</SelectItem>
              <SelectItem value="none">Fără furnizor</SelectItem>
              {suppliers.map((s: any) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block rounded-md border overflow-x-auto bg-card">
          <Table className="min-w-[1200px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]"></TableHead>
                <TableHead>Cod intern</TableHead>
                <TableHead>Denumire</TableHead>
                <TableHead>Categorie</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>UM</TableHead>
                <TableHead className="text-right">Preț (fără TVA)</TableHead>
                <TableHead className="text-right w-[100px]">Acțiuni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
                  </TableCell>
                </TableRow>
              ) : products && products.length > 0 ? (
                products.map((product) => {
                  const isExpanded = expandedRowId === product.id;
                  const aiInfo = getAiInfo(product);
                  return (
                    <Fragment key={product.id}>
                      <TableRow className={isExpanded ? "bg-muted/50" : ""}>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleExpand(product.id)}>
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{product.cod_intern}</TableCell>
                        <TableCell className="max-w-xs truncate font-medium">{product.denumire_completa}</TableCell>
                        <TableCell>{product.categories?.name || "-"}</TableCell>
                        <TableCell className="max-w-[140px] truncate">{product.brand || "-"}</TableCell>
                        <TableCell>{product.unit}</TableCell>
                        <TableCell className="text-right font-bold text-primary">
                          {Number(product.pret_lista).toFixed(2)} lei
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => openEdit(product)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setDeleteProductId(product.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={8} className="p-0">
                            <div className="p-4 border-b border-border/50">
                              <div className="flex items-center justify-between mb-4">
                                <h4 className="text-sm font-semibold flex items-center gap-2">
                                  <Sparkles className="h-4 w-4 text-primary" />
                                  Date Tehnice 
                                  {aiInfo?.updated_at && <span className="text-xs font-normal text-muted-foreground ml-2">(completate)</span>}
                                </h4>
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  onClick={() => fetchAiData(product.id)}
                                  disabled={aiLoadingId === product.id}
                                >
                                  {aiLoadingId === product.id ? (
                                    <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Se caută...</>
                                  ) : (
                                    <><Sparkles className="h-3.5 w-3.5 mr-1" /> {aiInfo ? "Re-generează cu AI" : "Completează cu AI"}</>
                                  )}
                                </Button>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                                <div className="space-y-1">
                                  <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Consum</p>
                                  <p>{aiInfo?.consum || "-"}</p>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Ambalaj</p>
                                  <p>{aiInfo?.ambalaj || "-"}</p>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Utilizare</p>
                                  <p>{aiInfo?.utilizare || "-"}</p>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Producător/Furnizor</p>
                                  <p>{product.manufacturer || product.brand || "-"}</p>
                                </div>
                                <div className="space-y-1 col-span-2">
                                  <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Alternative</p>
                                  <p>{aiInfo?.alternative?.join(", ") || "-"}</p>
                                </div>
                                <div className="space-y-1 col-span-2">
                                  <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Compatibilități</p>
                                  <p>{aiInfo?.compatibilitati || "-"}</p>
                                </div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    Niciun produs. Importați produse de pe maxbau.ro.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Mobile card view */}
        <div className="md:hidden space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : products && products.length > 0 ? (
            products.map((product) => {
              const isExpanded = expandedRowId === product.id;
              const aiInfo = getAiInfo(product);
              return (
                <div key={product.id} className="rounded-lg border bg-card">
                  <button
                    onClick={() => toggleExpand(product.id)}
                    className="w-full text-left p-3 flex items-start gap-3"
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs font-mono border-primary/30 text-primary shrink-0">
                          {product.cod_intern}
                        </Badge>
                        {product.categories?.name && (
                          <Badge variant="secondary" className="text-[10px] truncate max-w-[100px]">
                            {product.categories.name}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm font-medium line-clamp-2">{product.denumire_completa}</p>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">{product.brand || ""} · {product.unit || "buc"}</span>
                        <span className="text-base font-bold text-primary">{Number(product.pret_lista).toFixed(2)} lei</span>
                      </div>
                    </div>
                    {isExpanded ? <ChevronUp className="h-4 w-4 shrink-0 mt-1 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 mt-1 text-muted-foreground" />}
                  </button>

                  {isExpanded && (
                    <div className="border-t px-3 pb-3 space-y-3">
                      {/* Actions */}
                      <div className="flex gap-2 pt-2">
                        <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={() => openEdit(product)}>
                          <Pencil className="h-3.5 w-3.5" /> Editează
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => setDeleteProductId(product.id)}>
                          <Trash2 className="h-3.5 w-3.5" /> Șterge
                        </Button>
                      </div>

                      {/* AI Info */}
                      <div className="rounded-md border p-2.5 space-y-2 bg-muted/20">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-semibold flex items-center gap-1.5">
                            <Sparkles className="h-3.5 w-3.5 text-primary" />
                            Date Tehnice
                            {aiInfo?.updated_at && <span className="text-[10px] font-normal text-muted-foreground">(✓)</span>}
                          </h4>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs gap-1"
                            onClick={() => fetchAiData(product.id)}
                            disabled={aiLoadingId === product.id}
                          >
                            {aiLoadingId === product.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Sparkles className="h-3 w-3" />
                            )}
                            AI
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <p className="text-muted-foreground text-[10px] uppercase">Consum</p>
                            <p className="font-medium">{aiInfo?.consum || "—"}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-[10px] uppercase">Ambalaj</p>
                            <p className="font-medium">{aiInfo?.ambalaj || "—"}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-[10px] uppercase">Utilizare</p>
                            <p className="font-medium">{aiInfo?.utilizare || "—"}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-[10px] uppercase">Producător</p>
                            <p className="font-medium">{product.manufacturer || product.brand || "—"}</p>
                          </div>
                        </div>
                        {aiInfo?.alternative && aiInfo.alternative.length > 0 && (
                          <div className="text-xs">
                            <p className="text-muted-foreground text-[10px] uppercase">Alternative</p>
                            <p className="font-medium">{aiInfo.alternative.join(", ")}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Niciun produs. Importați produse de pe maxbau.ro.
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              Pagina {page + 1} din {totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={Boolean(editProduct)} onOpenChange={(o) => !o && setEditProduct(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <DialogTitle>Editare Produs</DialogTitle>
            <DialogDescription>
              Modificați informațiile de bază și datele tehnice pentru <span className="font-mono text-primary">{editProduct?.cod_intern}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            <Tabs defaultValue="detalii" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="detalii">Detalii Produs</TabsTrigger>
                <TabsTrigger value="preturi">Grile & Istoric Prețuri</TabsTrigger>
              </TabsList>
              
              <TabsContent value="detalii" className="space-y-6 mt-0">
                {/* Informatii de baza */}
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm border-b pb-2">Informații de bază</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Cod intern</Label>
                      <Input value={form.cod_intern} onChange={e => setForm({...form, cod_intern: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                      <Label>Denumire completă</Label>
                      <Input value={form.denumire_completa} onChange={e => setForm({...form, denumire_completa: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                      <Label>Preț de listă implicit (fără TVA)</Label>
                      <Input type="number" step="0.01" value={form.pret_lista} onChange={e => setForm({...form, pret_lista: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                      <Label>Unitate de măsură</Label>
                      <Input value={form.unit} onChange={e => setForm({...form, unit: e.target.value})} placeholder="ex: buc, kg, m" />
                    </div>
                    <div className="space-y-2">
                      <Label>Categorie</Label>
                      <Select value={form.category_id} onValueChange={v => setForm({...form, category_id: v})}>
                        <SelectTrigger><SelectValue placeholder="Selectează categoria" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Fără categorie</SelectItem>
                          {categories.map((c: any) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Furnizor MaxBau implicit</Label>
                      <Select value={form.supplier_id} onValueChange={v => setForm({...form, supplier_id: v})}>
                        <SelectTrigger><SelectValue placeholder="Selectează furnizorul" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Fără furnizor</SelectItem>
                          {suppliers.map((s: any) => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Brand</Label>
                      <Input value={form.brand} onChange={e => setForm({...form, brand: e.target.value})} placeholder="ex: Ceresit" />
                    </div>
                    <div className="space-y-2">
                      <Label>Producător Oficial</Label>
                      <Input value={form.manufacturer} onChange={e => setForm({...form, manufacturer: e.target.value})} placeholder="ex: Henkel" />
                    </div>
                  </div>
                </div>

                {/* Date tehnice */}
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm border-b pb-2 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Date Tehnice & Utilizare
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Consum orientativ</Label>
                      <Input value={form.consum} onChange={e => setForm({...form, consum: e.target.value})} placeholder="ex: 3-4 kg/m²" />
                    </div>
                    <div className="space-y-2">
                      <Label>Ambalaj</Label>
                      <Input value={form.ambalaj} onChange={e => setForm({...form, ambalaj: e.target.value})} placeholder="ex: sac 25 kg" />
                    </div>
                    <div className="space-y-2">
                      <Label>Compatibilități</Label>
                      <Input value={form.compatibilitati} onChange={e => setForm({...form, compatibilitati: e.target.value})} placeholder="ex: beton, zidărie" />
                    </div>
                    <div className="space-y-2">
                      <Label>Utilizare</Label>
                      <Input value={form.utilizare} onChange={e => setForm({...form, utilizare: e.target.value})} placeholder="ex: interior/exterior" />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>Alternative echivalente (separate prin virgulă)</Label>
                      <Input value={form.alternative} onChange={e => setForm({...form, alternative: e.target.value})} placeholder="ex: Mapei Keraflex Maxi S1, Baumit FlexMörtel" />
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="preturi" className="mt-0">
                {editProduct && <ProductPricesTab productId={editProduct.id} />}
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter className="px-6 py-4 border-t shrink-0">
            <Button variant="outline" onClick={() => setEditProduct(null)}>Anulează</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Se salvează..." : "Salvează modificările"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={Boolean(deleteProductId)} onOpenChange={(o) => !o && setDeleteProductId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmare ștergere</DialogTitle>
            <DialogDescription>
              Sunteți sigur că doriți să ștergeți acest produs? Acțiunea este ireversibilă și va șterge produsul din toate ofertele nefinalizate.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteProductId(null)}>Anulează</Button>
            <Button variant="destructive" onClick={() => deleteProductId && deleteMutation.mutate(deleteProductId)} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Se șterge..." : "Șterge definitiv"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default AdminProducts;
