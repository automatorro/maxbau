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
import { fetchWithProxy, parseBrandsPage, parseBrandListingPage } from "../utils/scraperUtils";

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
  fisa_tehnica_url?: string | null;
  fisa_tehnica_storage_path?: string | null;
  fisa_tehnica_processed?: boolean;
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

  // Brand sync state
  const [syncing, setSyncing] = useState(false);
  const [syncLog, setSyncLog] = useState<Array<{ brand: string; status: string; count?: number; error?: string }>>([]);
  const [syncSummary, setSyncSummary] = useState<{ imported: number; updated: number; deactivated: number; errors: number } | null>(null);

  // Brand selector dialog
  const [brandSelectorOpen, setBrandSelectorOpen] = useState(false);
  const [availableBrands, setAvailableBrands] = useState<string[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set());
  const [loadingBrands, setLoadingBrands] = useState(false);
  
  // Expanded row and Edit states
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [deleteProductId, setDeleteProductId] = useState<string | null>(null);
  const [aiLoadingId, setAiLoadingId] = useState<string | null>(null);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [uploadedStoragePath, setUploadedStoragePath] = useState<string | null>(null);
  const [extractingSpecs, setExtractingSpecs] = useState(false);

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
    fisa_tehnica_url: "",
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
          query = query.or(`denumire_completa.ilike.%${token}%,cod_intern.ilike.%${token}%,brand.ilike.%${token}%,brand_slug.ilike.%${token}%`);
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

  const SCRAPE_BATCH = 5;

  // Deschide dialogul de selecție branduri, încarcă lista de pe /marci
  const openBrandSelector = async () => {
    setLoadingBrands(true);
    setBrandSelectorOpen(true);
    setSyncLog([]);
    setSyncSummary(null);
    try {
      const { data: brandsData, error: brandsError } = await supabase.functions.invoke("scrape-maxbau", {
        body: { action: "list-brands" },
      });
      if (brandsError || !brandsData?.success) throw new Error(brandsData?.error || brandsError?.message);
      
      let slugs: string[] = brandsData.slugs || [];
      
      // Fallback: Dacă Edge function-ul returnează 0 branduri din cauza vechiului regex bug, folosim o listă hardcodată de rezervă
      if (slugs.length === 0) {
        const hardcoded = [
          "adeplast", "allianz-tc", "apla", "austrotherm", "baufan", "baumit", "bison", "bochemit", "bostik",
          "ceresit", "cesal", "cesarom", "den-braven", "duraziv", "fassa-bortolo", "fibran", "hasit", "holcim",
          "isomat", "isover", "kai", "knauf", "knauf-insulation", "kober", "leier", "macon", "masterplast",
          "murexin", "penosil", "policolor", "porotherm", "rigips", "rockwool", "romcim", "sika", "somaco",
          "swisspor", "tytan", "urso", "weber", "wienerberger", "yato", "brikston", "tassullo"
        ];
        // Adaugam si brandurile deja existente in DB
        const { data: dbProds } = await supabase.from("products").select("brand_slug");
        const dbSlugs = (dbProds || []).map((p: any) => p.brand_slug).filter(Boolean);
        slugs = Array.from(new Set([...hardcoded, ...dbSlugs]));
      }

      setAvailableBrands(slugs);
      setSelectedBrands(new Set(slugs)); // toate selectate implicit
    } catch (err) {
      toast({ title: "Eroare la încărcarea brandurilor", description: err instanceof Error ? err.message : "Eroare", variant: "destructive" });
      setBrandSelectorOpen(false);
    } finally {
      setLoadingBrands(false);
    }
  };

  const handleBrandSync = async (slugsToSync: string[]) => {
    setBrandSelectorOpen(false);
    setSyncing(true);
    setSyncLog([]);
    setSyncSummary(null);
    let totalImported = 0;
    let totalDeactivated = 0;
    let totalErrors = 0;

    try {
      setSyncLog([{ brand: "✓", status: `${slugsToSync.length} brand${slugsToSync.length !== 1 ? "uri" : ""} selectat${slugsToSync.length !== 1 ? "e" : ""} pentru sincronizare` }]);

      for (const slug of slugsToSync) {
        setSyncLog((prev) => [...prev, { brand: slug, status: "Se colectează URL-uri...", count: 0 }]);

        try {
          const allUrls: string[] = [];

          const htmlP1 = await fetchWithProxy(`https://maxbau.ro/marci/${slug}`);
          const { productUrls: p1Urls, totalPages } = parseBrandListingPage(htmlP1, slug);
          allUrls.push(...p1Urls);

          for (let pg = 2; pg <= totalPages; pg++) {
            const htmlPg = await fetchWithProxy(`https://maxbau.ro/marci/${slug}/pag-${pg}`);
            const { productUrls: pgUrls } = parseBrandListingPage(htmlPg, slug);
            allUrls.push(...pgUrls);
          }

          setSyncLog((prev) =>
            prev.map((l) =>
              l.brand === slug ? { ...l, status: `${allUrls.length} produse găsite. Se importă...`, count: allUrls.length } : l
            )
          );

          let brandImported = 0;
          let brandErrors = 0;
          for (let i = 0; i < allUrls.length; i += SCRAPE_BATCH) {
            const batch = allUrls.slice(i, i + SCRAPE_BATCH);
            const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke("scrape-maxbau", {
              body: { action: "scrape", urls: batch, brandSlug: slug },
            });
            if (!scrapeError && scrapeData?.success) {
              brandImported += scrapeData.imported || 0;
              brandErrors += scrapeData.errors || 0;
            } else {
              brandErrors += batch.length;
            }
          }

          const { data: deactData } = await supabase.functions.invoke("scrape-maxbau", {
            body: { action: "deactivate-missing", brandSlug: slug, urls: allUrls },
          });
          const deactivated = deactData?.deactivated || 0;
          totalDeactivated += deactivated;
          totalImported += brandImported;
          totalErrors += brandErrors;

          setSyncLog((prev) =>
            prev.map((l) =>
              l.brand === slug
                ? { ...l, status: `✓ ${brandImported} importate${deactivated > 0 ? `, ${deactivated} dezactivate` : ""}${brandErrors > 0 ? `, ${brandErrors} erori` : ""}` }
                : l
            )
          );
        } catch (err) {
          totalErrors++;
          setSyncLog((prev) =>
            prev.map((l) =>
              l.brand === slug ? { ...l, status: `✗ Eroare: ${err instanceof Error ? err.message : "necunoscută"}`, error: "true" } : l
            )
          );
        }
      }

      setSyncSummary({ imported: totalImported, updated: 0, deactivated: totalDeactivated, errors: totalErrors });
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      toast({ title: `Sincronizare completă: ${totalImported} produse, ${totalDeactivated} dezactivate` });
    } catch (err) {
      toast({ title: "Eroare la sincronizare", description: err instanceof Error ? err.message : "Eroare", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
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
    setUploadedStoragePath(product.fisa_tehnica_storage_path || null);
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
      fisa_tehnica_url: product.fisa_tehnica_url || "",
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
        fisa_tehnica_url: form.fisa_tehnica_url ? form.fisa_tehnica_url.trim() : null,
        fisa_tehnica_storage_path: uploadedStoragePath,
      };

      const { error, data: updateResult } = await supabase
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
      const product = products?.find((p: any) => p.id === productId);
      const hasExtractedSpecs = product?.specifications?.fisa_tehnica_specs;
      const hasPdf = product?.fisa_tehnica_url || product?.fisa_tehnica_storage_path;

      let result: any;
      if (hasExtractedSpecs) {
        // Dacă specificațiile din PDF există deja, apelăm doar funcția SQL (RPC) de mapare rapidă din DB, fără a apela API-ul Gemini
        const { data, error } = await supabase.rpc("get_ai_product_info", {
          p_product_id: productId,
        });
        if (error) throw error;
        result = data as any;
      } else if (hasPdf) {
        try {
          // Încercăm extragerea direct din PDF prin Edge Function
          const { data, error } = await supabase.functions.invoke("extract-pdf-specs", {
            body: { productId },
          });
          if (error) throw error;
          result = { success: true, data: { [productId]: data?.data } };
        } catch (edgeError) {
          console.warn("Edge function extract-pdf-specs failed, falling back to name-based RPC:", edgeError);
          // Fallback la RPC (bazat pe denumire) dacă extragerea din PDF a eșuat
          const { data, error } = await supabase.rpc("get_ai_product_info", {
            p_product_id: productId,
          });
          if (error) throw error;
          result = data as any;
        }
      } else {
        // Fallback: Dacă nu avem fișă tehnică deloc, lăsăm RPC-ul să apeleze Gemini bazat pe denumirea produsului
        const { data, error } = await supabase.rpc("get_ai_product_info", {
          p_product_id: productId,
        });
        if (error) throw error;
        result = data as any;
      }

      if (!result?.success) throw new Error(result?.error || "Eroare AI");

      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      toast({ 
        title: hasExtractedSpecs 
          ? "Date tehnice încărcate instantaneu din fișa tehnică existentă" 
          : (hasPdf ? "Date tehnice extrase cu succes din PDF" : "Date tehnice generate cu succes de AI") 
      });
    } catch (e: any) {
      console.error("AI fetch error:", e);
      toast({ title: "Eroare la obținerea datelor AI", description: e.message, variant: "destructive" });
    } finally {
      setAiLoadingId(null);
    }
  };

  const toggleExpand = (id: string) => {
    if (expandedRowId === id) setExpandedRowId(null);
    else setExpandedRowId(id);
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editProduct) return;
    
    setUploadingPdf(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${editProduct.cod_intern || Date.now()}_fisa_tehnica.${fileExt}`;
      const filePath = `${editProduct.cod_intern || "temp"}/${fileName}`;
      
      const { data, error } = await supabase.storage
        .from("fise-tehnice")
        .upload(filePath, file, {
          upsert: true,
        });
        
      if (error) throw error;
      
      const { data: { publicUrl } } = supabase.storage
        .from("fise-tehnice")
        .getPublicUrl(filePath);
        
      setForm(prev => ({
        ...prev,
        fisa_tehnica_url: publicUrl,
      }));
      setUploadedStoragePath(filePath);
      
      toast({ title: "Succes", description: "Fișierul PDF a fost încărcat în storage." });
    } catch (error: any) {
      console.error("PDF upload error:", error);
      toast({ title: "Eroare la încărcare", description: error.message, variant: "destructive" });
    } finally {
      setUploadingPdf(false);
    }
  };

  const handleExtractSpecsFromPdf = async () => {
    if (!editProduct) return;
    
    const currentUrl = form.fisa_tehnica_url.trim();
    if (!currentUrl && !uploadedStoragePath) {
      toast({ title: "Eroare", description: "Vă rugăm să uploadați un PDF sau să introduceți un URL de fișă tehnică mai întâi.", variant: "destructive" });
      return;
    }
    
    setExtractingSpecs(true);
    try {
      const { error: savePdfError } = await supabase
        .from("products")
        .update({
          fisa_tehnica_url: currentUrl || null,
          fisa_tehnica_storage_path: uploadedStoragePath || null
        })
        .eq("id", editProduct.id);
        
      if (savePdfError) throw savePdfError;

      const { data, error } = await supabase.functions.invoke("extract-pdf-specs", {
        body: { productId: editProduct.id },
      });
      
      if (error) throw error;
      
      if (data?.success && data?.data) {
        const specs = data.data;
        
        let compat = "";
        if (Array.isArray(specs.compatibil_cu)) {
          compat = specs.compatibil_cu.join(", ");
        } else {
          compat = specs.compatibil_cu || "";
        }
        
        let util = "";
        if (Array.isArray(specs.utilizare)) {
          util = specs.utilizare.join(", ");
        } else {
          util = specs.utilizare || "";
        }

        setForm(prev => ({
          ...prev,
          consum: specs.consum || prev.consum,
          ambalaj: specs.ambalaj || prev.ambalaj,
          compatibilitati: compat || prev.compatibilitati,
          utilizare: util || prev.utilizare,
          alternative: specs.alternative?.join(", ") || prev.alternative,
        }));
        
        toast({ title: "Succes", description: "Datele tehnice au fost extrase cu succes din PDF și completate în formular." });
      } else {
        throw new Error(data?.error || "Eroare la extragere date.");
      }
    } catch (error: any) {
      console.error("Specs extraction error:", error);
      toast({ title: "Eroare la extragere", description: error.message, variant: "destructive" });
    } finally {
      setExtractingSpecs(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Administrare produse</h1>
            <p className="text-muted-foreground">Gestionează catalogul și datele tehnice ale produselor</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={openBrandSelector}
              disabled={syncing || importing}
              size="sm"
              className="bg-primary"
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Building2 className="h-4 w-4 mr-2" />
              )}
              <span>{syncing ? "Sincronizare..." : "Sincronizare pe branduri"}</span>
            </Button>
            <Button onClick={handleImport} disabled={importing || syncing} size="sm" variant="outline">
              {importing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              <span className="hidden sm:inline">{importing ? "Se importă..." : "Import clasic"}</span>
              <span className="sm:hidden">{importing ? "..." : "Import"}</span>
            </Button>
          </div>
        </div>

        {importing && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-4">
            <p className="text-sm text-muted-foreground">{importStatus}</p>
            <Progress value={importProgress} className="h-2" />
            <p className="text-xs text-muted-foreground text-right">{importProgress}%</p>
          </div>
        )}

        {(syncing || syncLog.length > 0) && (
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center gap-2">
              {syncing && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              <p className="text-sm font-medium">Sincronizare pe branduri</p>
            </div>
            <div className="max-h-56 overflow-y-auto space-y-1 font-mono text-xs bg-background rounded-md border p-2">
              {syncLog.map((entry, i) => (
                <div key={i} className={`flex gap-2 ${entry.error ? "text-destructive" : "text-foreground"}`}>
                  <span className="text-muted-foreground w-32 shrink-0 truncate">{entry.brand}</span>
                  <span>{entry.status}</span>
                </div>
              ))}
              {syncing && <div className="text-muted-foreground animate-pulse">▌</div>}
            </div>
            {syncSummary && (
              <div className="flex gap-4 text-xs text-muted-foreground border-t pt-2">
                <span className="text-green-600 font-medium">✓ {syncSummary.imported} importate</span>
                {syncSummary.deactivated > 0 && <span className="text-amber-600 font-medium">⊘ {syncSummary.deactivated} dezactivate</span>}
                {syncSummary.errors > 0 && <span className="text-destructive font-medium">✗ {syncSummary.errors} erori</span>}
              </div>
            )}
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
                                    <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Se extrag date...</>
                                  ) : (
                                    <><Sparkles className="h-3.5 w-3.5 mr-1" /> {aiInfo ? "Re-extrage date" : "Extrage date tehnice"}</>
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
                              {product.specifications?.fisa_tehnica_specs && (
                                <div className="mt-4 pt-4 border-t border-border/50 space-y-3">
                                  <h5 className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
                                    <span>Fișă Tehnică Detaliată (PDF)</span>
                                    {product.fisa_tehnica_url && (
                                      <a 
                                        href={product.fisa_tehnica_url} 
                                        target="_blank" 
                                        rel="noreferrer" 
                                        className="text-xs text-blue-500 hover:text-blue-600 underline lowercase font-normal"
                                      >
                                        (vezi PDF original)
                                      </a>
                                    )}
                                  </h5>
                                  
                                  {(product.specifications.fisa_tehnica_specs as any).rezumat_tehnic && (
                                    <div className="text-xs bg-muted/40 p-2.5 rounded border italic text-muted-foreground">
                                      {(product.specifications.fisa_tehnica_specs as any).rezumat_tehnic}
                                    </div>
                                  )}

                                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
                                    {(product.specifications.fisa_tehnica_specs as any).conductivitate_termica && (
                                      <div>
                                        <p className="text-muted-foreground font-medium">Conductivitate termică λ</p>
                                        <p className="font-semibold">{(product.specifications.fisa_tehnica_specs as any).conductivitate_termica}</p>
                                      </div>
                                    )}
                                    {(product.specifications.fisa_tehnica_specs as any).densitate && (
                                      <div>
                                        <p className="text-muted-foreground font-medium">Densitate</p>
                                        <p className="font-semibold">{(product.specifications.fisa_tehnica_specs as any).densitate}</p>
                                      </div>
                                    )}
                                    {(product.specifications.fisa_tehnica_specs as any).rezistenta_compresiune && (
                                      <div>
                                        <p className="text-muted-foreground font-medium">Rezistență la compresiune</p>
                                        <p className="font-semibold">{(product.specifications.fisa_tehnica_specs as any).rezistenta_compresiune}</p>
                                      </div>
                                    )}
                                    {(product.specifications.fisa_tehnica_specs as any).rezistenta_tractiune && (
                                      <div>
                                        <p className="text-muted-foreground font-medium">Rezistență la tracțiune</p>
                                        <p className="font-semibold">{(product.specifications.fisa_tehnica_specs as any).rezistenta_tractiune}</p>
                                      </div>
                                    )}
                                    {(product.specifications.fisa_tehnica_specs as any).clasa_reactie_foc && (
                                      <div>
                                        <p className="text-muted-foreground font-medium">Clasă reacție foc</p>
                                        <p className="font-semibold">{(product.specifications.fisa_tehnica_specs as any).clasa_reactie_foc}</p>
                                      </div>
                                    )}
                                    {(product.specifications.fisa_tehnica_specs as any).grosime_strat && (
                                      <div>
                                        <p className="text-muted-foreground font-medium">Grosime strat</p>
                                        <p className="font-semibold">{(product.specifications.fisa_tehnica_specs as any).grosime_strat}</p>
                                      </div>
                                    )}
                                    {(product.specifications.fisa_tehnica_specs as any).timp_uscare && (
                                      <div>
                                        <p className="text-muted-foreground font-medium">Timp uscare</p>
                                        <p className="font-semibold">{(product.specifications.fisa_tehnica_specs as any).timp_uscare}</p>
                                      </div>
                                    )}
                                    {(product.specifications.fisa_tehnica_specs as any).garantie && (
                                      <div>
                                        <p className="text-muted-foreground font-medium">Garanție</p>
                                        <p className="font-semibold">{(product.specifications.fisa_tehnica_specs as any).garantie}</p>
                                      </div>
                                    )}
                                    {(product.specifications.fisa_tehnica_specs as any).norma_standard && 
                                     Array.isArray((product.specifications.fisa_tehnica_specs as any).norma_standard) && 
                                     (product.specifications.fisa_tehnica_specs as any).norma_standard.length > 0 && (
                                      <div className="col-span-2">
                                        <p className="text-muted-foreground font-medium">Norme / Standarde</p>
                                        <p className="font-semibold">{(product.specifications.fisa_tehnica_specs as any).norma_standard.join(', ')}</p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
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
                            {aiInfo ? "Re-extrage" : "Date"}
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

      {/* Brand Selector Dialog */}
      <Dialog open={brandSelectorOpen} onOpenChange={(o) => !o && setBrandSelectorOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Selectează brandurile de sincronizat
            </DialogTitle>
            <DialogDescription>
              Alege unul sau mai multe branduri. Se vor re-scrapa toate produsele brandurilor selectate.
            </DialogDescription>
          </DialogHeader>

          {loadingBrands ? (
            <div className="flex items-center justify-center py-10 gap-3 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Se încarcă brandurile de pe maxbau.ro...</span>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Select all / none */}
              <div className="flex gap-2 pb-2 border-b">
                <Button
                  size="sm" variant="outline"
                  onClick={() => setSelectedBrands(new Set(availableBrands))}
                >
                  Selectează toate ({availableBrands.length})
                </Button>
                <Button
                  size="sm" variant="ghost"
                  onClick={() => setSelectedBrands(new Set())}
                >
                  Deselectează toate
                </Button>
              </div>

              {/* Brand list */}
              <ScrollArea className="h-72 pr-2">
                <div className="space-y-1">
                  {availableBrands.map((slug) => {
                    const checked = selectedBrands.has(slug);
                    const label = slug === "alte-branduri"
                      ? "Alte branduri (842+ produse)"
                      : slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
                    return (
                      <button
                        key={slug}
                        onClick={() => {
                          setSelectedBrands((prev) => {
                            const next = new Set(prev);
                            if (next.has(slug)) next.delete(slug);
                            else next.add(slug);
                            return next;
                          });
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-left transition-colors ${
                          checked
                            ? "bg-primary/10 text-primary font-medium"
                            : "hover:bg-muted text-foreground"
                        }`}
                      >
                        <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${
                          checked ? "bg-primary border-primary" : "border-border"
                        }`}>
                          {checked && <span className="text-primary-foreground text-[10px] font-bold">✓</span>}
                        </div>
                        <span className="font-mono text-xs text-muted-foreground w-32 shrink-0">{slug}</span>
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setBrandSelectorOpen(false)}>
              Anulează
            </Button>
            <Button
              onClick={() => handleBrandSync(Array.from(selectedBrands))}
              disabled={selectedBrands.size === 0 || loadingBrands}
              className="gap-2"
            >
              <Building2 className="h-4 w-4" />
              Sincronizează {selectedBrands.size > 0 ? `${selectedBrands.size} brand${selectedBrands.size !== 1 ? "uri" : ""}` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

                {/* Documentație PDF */}
                <div className="space-y-4 border-t pt-4">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Documentație Fișă Tehnică PDF
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>URL Fișă Tehnică</Label>
                      <Input 
                        value={form.fisa_tehnica_url} 
                        onChange={e => setForm({...form, fisa_tehnica_url: e.target.value})} 
                        placeholder="ex: https://cdn.contentspeed.ro/..." 
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Încarcă Fișă Tehnică PDF locală</Label>
                      <div className="flex items-center gap-2">
                        <Input 
                          type="file" 
                          accept=".pdf" 
                          onChange={handlePdfUpload} 
                          disabled={uploadingPdf}
                          className="cursor-pointer"
                        />
                        {uploadingPdf && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                      </div>
                    </div>
                    
                    <div className="md:col-span-2 flex justify-end">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={handleExtractSpecsFromPdf}
                        disabled={extractingSpecs || uploadingPdf}
                        className="gap-1.5"
                      >
                        {extractingSpecs ? (
                          <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Se extrag datele...</>
                        ) : (
                          <><Sparkles className="h-3.5 w-3.5" /> Extrage date din PDF</>
                        )}
                      </Button>
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
