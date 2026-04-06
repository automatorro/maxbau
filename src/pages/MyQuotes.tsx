import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Plus, Eye } from "lucide-react";
import { useNavigate } from "react-router-dom";

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
              const itemCount =
                (quote.quote_items as any)?.[0]?.count ?? 0;
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
                        {new Date(quote.created_at).toLocaleDateString("ro-RO")} · {itemCount}{" "}
                        produse
                      </p>
                    </div>
                    <div className="text-right ml-4 shrink-0">
                      <p className="text-lg font-bold text-primary">
                        {Number(quote.total_gross).toFixed(2)} lei
                      </p>
                      <p className="text-xs text-muted-foreground">cu TVA</p>
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
