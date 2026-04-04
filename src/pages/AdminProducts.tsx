import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const AdminProducts = () => {
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  const { data: products, isLoading } = useQuery({
    queryKey: ["admin-products", search],
    queryFn: async () => {
      let query = supabase
        .from("products")
        .select("*, categories(name)")
        .order("cod_intern");

      if (search) {
        query = query.or(`denumire_completa.ilike.%${search}%,cod_intern.ilike.%${search}%`);
      }

      const { data, error } = await query.limit(100);
      if (error) throw error;
      return data;
    },
  });

  const handleImport = () => {
    toast({
      title: "Import produse",
      description: "Funcționalitatea de import va fi implementată cu Firecrawl în faza următoare.",
    });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Administrare produse</h1>
            <p className="text-muted-foreground">Gestionează catalogul de produse</p>
          </div>
          <Button onClick={handleImport}>
            <Upload className="h-4 w-4 mr-2" />
            Import de pe maxbau.ro
          </Button>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Caută produse..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cod intern</TableHead>
                <TableHead>Denumire</TableHead>
                <TableHead>Categorie</TableHead>
                <TableHead className="text-right">Preț (fără TVA)</TableHead>
                <TableHead>UM</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">
                    <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
                  </TableCell>
                </TableRow>
              ) : products && products.length > 0 ? (
                products.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="font-mono text-sm">{product.cod_intern}</TableCell>
                    <TableCell className="max-w-xs truncate">{product.denumire_completa}</TableCell>
                    <TableCell>{(product.categories as any)?.name || "-"}</TableCell>
                    <TableCell className="text-right font-medium">
                      {Number(product.pret_lista).toFixed(2)} lei
                    </TableCell>
                    <TableCell>{product.unit}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Niciun produs. Importați produse de pe maxbau.ro.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AdminProducts;
