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
import { FileText, Plus, Pencil, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

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
      // Delete items first, then the quote
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

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Ofertele mele</h1>
            <p className="text-sm text-muted-foreground">Istoric oferte generate</p>
          </div>
          <Button onClick={() => navigate("/quote/new")} className="gap-1">
            <Plus className="h-4 w-4" /> Ofertă nouă
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : quotes && quotes.length > 0 ? (
          <div className="space-y-3">
            {quotes.map((quote) => {
              const itemCount = (quote.quote_items as any)?.[0]?.count ?? 0;
              return (
                <Card key={quote.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
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
                    <div className="flex items-center gap-3 ml-4 shrink-0">
                      <div className="text-right">
                        <p className="text-lg font-bold text-primary">
                          {Number(quote.total_gross).toFixed(2)} lei
                        </p>
                        <p className="text-xs text-muted-foreground">cu TVA</p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8"
                        onClick={() => navigate(`/quote/${quote.id}/edit`)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
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
