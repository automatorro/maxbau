import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText } from "lucide-react";

const statusLabels: Record<string, string> = {
  draft: "Ciornă",
  sent: "Trimisă",
  accepted: "Acceptată",
};

const MyQuotes = () => {
  const { data: quotes, isLoading } = useQuery({
    queryKey: ["my-quotes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Ofertele mele</h1>
          <p className="text-muted-foreground">Istoric oferte generate</p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : quotes && quotes.length > 0 ? (
          <div className="space-y-3">
            {quotes.map((quote) => (
              <Card key={quote.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium">{quote.client_name || "Client nespecificat"}</p>
                    <p className="text-sm text-muted-foreground">{quote.project_description || "Fără descriere"}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(quote.created_at).toLocaleDateString("ro-RO")}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge variant={quote.status === "accepted" ? "default" : "secondary"}>
                      {statusLabels[quote.status] || quote.status}
                    </Badge>
                    <p className="text-lg font-bold mt-1">
                      {Number(quote.total_gross).toFixed(2)} lei
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">Nicio ofertă</h3>
            <p className="text-sm text-muted-foreground">Creează prima ofertă din meniul lateral</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default MyQuotes;
