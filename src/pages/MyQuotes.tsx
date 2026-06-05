import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { FileText, Plus, Pencil, Trash2, Download } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { exportQuoteToExcel } from "@/lib/exportExcel";

const statusLabels: Record<string, string> = {
  draft: "Ciornă",
  sent: "Trimisă",
  accepted: "Acceptată",
};

const statusVariant: Record<string, "default" | "secondary" | "outline"> = {
  draft: "secondary",
  sent: "outline",
  accepted: "default",
};

const MyQuotes = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: quotes, isLoading } = useQuery({
    queryKey: ["my-quotes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select("*, quote_items(count)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (quoteId: string) => {
      const { error: iErr } = await supabase.from("quote_items").delete().eq("quote_id", quoteId);
      if (iErr) throw iErr;
      const { error } = await supabase.from("quotes").delete().eq("id", quoteId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-quotes"] });
      toast.success("Oferta a fost ștearsă");
    },
    onError: () => toast.error("Eroare la ștergere"),
  });

  const handleExport = async (quote: {
    id: string;
    client_name?: string | null;
    client_phone?: string | null;
    client_email?: string | null;
    project_description?: string | null;
    total_net?: number | null;
    total_tva?: number | null;
    total_gross?: number | null;
    created_at: string;
  }) => {
    const { data: items, error } = await supabase
      .from("quote_items")
      .select("*")
      .eq("quote_id", quote.id)
      .order("created_at", { ascending: true });

    if (error || !items) {
      toast.error("Eroare la încărcarea produselor");
      return;
    }

    // Fetch product details for specifications
    const productIds = items.map((i) => i.product_id).filter(Boolean) as string[];
    let productDetails: Record<string, { consum?: string | null; ambalare?: string | null; similar_cu?: string | null }> = {};
    if (productIds.length > 0) {
      const { data: prods } = await supabase
        .from("products")
        .select("id, specifications")
        .in("id", productIds);
      if (prods) {
        prods.forEach((p) => {
          const specs = (p.specifications as Record<string, unknown>) || {};
          const aiInfo = (specs.ai_info as Record<string, unknown>) || {};
          productDetails[p.id] = {
            consum: (aiInfo.consum as string) || null,
            ambalare: (aiInfo.ambalaj as string) || null,
            similar_cu: (aiInfo.alternative as string[])?.join(", ") || null,
          };
        });
      }
    }

    exportQuoteToExcel(
      {
        nr_oferta: quote.id.slice(0, 8).toUpperCase(),
        data: new Date(quote.created_at).toLocaleDateString("ro-RO"),
        client_name: quote.client_name,
        client_phone: quote.client_phone,
        client_email: quote.client_email,
        project_description: quote.project_description,
        total_net: Number(quote.total_net ?? 0),
        total_tva: Number(quote.total_tva ?? 0),
        total_gross: Number(quote.total_gross ?? 0),
      },
      items.map((item) => {
        const prod = item.product_id ? productDetails[item.product_id] : undefined;
        return {
          cod_intern: item.cod_intern,
          denumire: item.denumire,
          cerere_initiala: (item as Record<string, unknown>).cerere_initiala as string | null | undefined,
          nota_echivalenta: (item as Record<string, unknown>).nota_echivalenta as string | null | undefined,
          consum: prod?.consum,
          ambalare: prod?.ambalare,
          similar_cu: prod?.similar_cu,
          quantity: Number(item.quantity),
          unit: item.unit || "buc",
          pret_unitar: Number(item.pret_unitar),
          discount_percent: Number(item.discount_percent ?? 0),
          pret_final: Number(item.pret_final),
          subtotal: Number(item.subtotal),
        };
      })
    );
    toast.success("Fișier Excel descărcat");
  };

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Ofertele mele</h1>
            <p className="text-sm text-muted-foreground">Istoric oferte generate</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/quote/smart")} className="gap-1">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Ofertă din cerere client</span>
            </Button>
            <Button size="sm" onClick={() => navigate("/quote/new")} className="gap-1">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Ofertă nouă</span>
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : quotes && quotes.length > 0 ? (
          <div className="space-y-3">
            {quotes.map((quote) => {
              const itemCount = (quote.quote_items as { count: number }[])?.[0]?.count ?? 0;
              return (
                <Card key={quote.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <p className="font-medium truncate">
                            {quote.client_name || "Client nespecificat"}
                          </p>
                          <Badge variant={statusVariant[quote.status] || "secondary"}>
                            {statusLabels[quote.status] || quote.status}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">
                          {quote.project_description || "Fără descriere"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(quote.created_at).toLocaleDateString("ro-RO")} · {itemCount} produse
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg font-bold text-primary">
                          {Number(quote.total_gross).toFixed(2)} lei
                        </p>
                        <p className="text-xs text-muted-foreground">cu TVA</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-border/40">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-1"
                        onClick={() => handleExport(quote)}
                      >
                        <Download className="h-4 w-4" />
                        <span>Excel</span>
                      </Button>
                      <Button variant="outline" size="sm" className="w-full gap-1"
                        onClick={() => navigate(`/quote/${quote.id}/edit`)}>
                        <Pencil className="h-4 w-4" />
                        <span>Editează</span>
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" className="w-full gap-1 text-destructive border-destructive/40 hover:bg-destructive hover:text-destructive-foreground">
                            <Trash2 className="h-4 w-4" />
                            <span>Șterge</span>
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Șterge oferta?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Această acțiune este ireversibilă. Oferta și toate produsele asociate vor fi șterse definitiv.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Anulează</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteMutation.mutate(quote.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                              Șterge
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">Nicio ofertă</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Creează prima ofertă folosind butonul de mai sus
            </p>
            <Button onClick={() => navigate("/quote/new")} className="gap-1">
              <Plus className="h-4 w-4" /> Ofertă nouă
            </Button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default MyQuotes;
