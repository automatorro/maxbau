import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Search, Upload, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BATCH_SIZE = 5;

const AdminProducts = () => {
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [importProgress, setImportProgress] = useState(0);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: products, isLoading } = useQuery({
    queryKey: ["admin-products", search],
    queryFn: async () => {
      let query = supabase
        .from("products")
        .select("*, categories(name)")
        .order("cod_intern");

      if (search) {
        const tokens = search.split(/\s+/).filter(Boolean);
        for (const raw of tokens) {
          const token = raw.replace(/,/g, "\\,");
          query = query.or(`denumire_completa.ilike.%${token}%,cod_intern.ilike.%${token}%`);
        }
      }

      const { data, error } = await query.limit(100);
      if (error) throw error;
      return data;
    },
  });

  const handleImport = async () => {
    setImporting(true);
    setImportProgress(0);
    setImportStatus("Se descoperă URL-urile produselor de pe maxbau.ro...");

    try {
      // Step 1: Map the site
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

      // Step 2: Scrape in batches
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

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Administrare produse</h1>
            <p className="text-muted-foreground">Gestionează catalogul de produse</p>
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

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Caută produse..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Desktop table */}
        <div className="hidden md:block rounded-md border overflow-x-auto">
          <Table className="min-w-[1100px]">
            <TableHeader>
              <TableRow>
                <TableHead>Cod intern</TableHead>
                <TableHead>Denumire</TableHead>
                <TableHead>Categorie</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Producător</TableHead>
                <TableHead>Ambalare</TableHead>
                <TableHead>Cantitate/pachet</TableHead>
                <TableHead>UM</TableHead>
                <TableHead className="text-right">Preț (fără TVA)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
                  </TableCell>
                </TableRow>
              ) : products && products.length > 0 ? (
                products.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="font-mono text-sm">{product.cod_intern}</TableCell>
                    <TableCell className="max-w-xs truncate">{product.denumire_completa}</TableCell>
                    <TableCell>{(product.categories as any)?.name || "-"}</TableCell>
                    <TableCell className="max-w-[140px] truncate">{product.brand || "-"}</TableCell>
                    <TableCell className="max-w-[160px] truncate">{product.manufacturer || "-"}</TableCell>
                    <TableCell className="max-w-[160px] truncate">{product.packaging || "-"}</TableCell>
                    <TableCell className="max-w-[140px] truncate">{product.pack_quantity || "-"}</TableCell>
                    <TableCell>{product.unit}</TableCell>
                    <TableCell className="text-right font-medium">
                      {Number(product.pret_lista).toFixed(2)} lei
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    Niciun produs. Importați produse de pe maxbau.ro.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Mobile card list */}
        <div className="md:hidden space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : products && products.length > 0 ? (
            products.map((product) => (
              <div key={product.id} className="rounded-lg border bg-card p-3 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary mb-1">
                      {product.cod_intern}
                    </Badge>
                    <p className="text-sm font-medium leading-snug line-clamp-2">{product.denumire_completa}</p>
                  </div>
                  <span className="text-base font-bold text-primary shrink-0">
                    {Number(product.pret_lista).toFixed(2)} lei
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {(product.categories as any)?.name && <span>{(product.categories as any).name}</span>}
                  {product.brand && <span>{product.brand}</span>}
                  {product.unit && <span>UM: {product.unit}</span>}
                  {product.packaging && <span>{product.packaging}</span>}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Niciun produs. Importați produse de pe maxbau.ro.
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AdminProducts;
