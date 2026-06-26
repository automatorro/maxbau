import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeftRight, BookOpen, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface EquivalentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: {
    id: string;
    cod_intern: string;
    denumire_completa: string;
    category_id: string | null;
  } | null;
  onReplace: (newProduct: {
    id: string;
    cod_intern: string;
    denumire_completa: string;
    pret_lista: number;
    unit: string | null;
  }) => void;
}

export function EquivalentsDialog({ open, onOpenChange, product, onReplace }: EquivalentsDialogProps) {
  const { data: equivalents = [], isLoading } = useQuery({
    queryKey: ["picker-equivalents", product?.id, product?.category_id],
    enabled: !!product && !!product.category_id && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, cod_intern, denumire_completa, pret_lista, unit, brand, specifications, fisa_tehnica_url")
        .eq("category_id", product!.category_id!)
        .eq("is_active", true)
        .neq("id", product!.id)
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col p-5">
        <DialogHeader className="pb-2">
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 text-primary animate-pulse" />
            Echivalente reale din DB
          </DialogTitle>
        </DialogHeader>

        {product && (
          <div className="bg-muted/40 border rounded-lg p-3 shrink-0 text-xs mb-3 space-y-1">
            <p className="font-semibold text-muted-foreground uppercase tracking-wider">Produs de înlocuit:</p>
            <p className="font-medium text-foreground text-sm leading-snug">{product.denumire_completa}</p>
            <p className="font-mono text-muted-foreground mt-0.5">Cod: {product.cod_intern}</p>
          </div>
        )}

        <p className="text-xs text-muted-foreground mb-2 shrink-0">
          Următoarele produse fac parte din aceeași categorie și pot servi ca echivalente reale din catalog:
        </p>

        <ScrollArea className="flex-1 min-h-0 h-[320px] -mx-2 pr-2">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-2">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-xs text-muted-foreground">Căutăm echivalente în baza de date...</span>
            </div>
          ) : equivalents.length > 0 ? (
            <div className="space-y-2 px-2">
              {equivalents.map((eq) => {
                const specs = eq.specifications || {};
                const ftSpecs = specs.fisa_tehnica_specs || null;
                const aiInfo = specs.ai_info || null;
                const source = ftSpecs ? "verified" : (aiInfo ? "ai" : "none");

                return (
                  <div
                    key={eq.id}
                    className="flex items-start justify-between gap-4 p-3 border rounded-lg hover:bg-accent/5 transition-colors"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="text-xs font-mono border-primary/20 text-primary">
                          {eq.cod_intern}
                        </Badge>
                        {eq.brand && (
                          <span className="text-xs text-muted-foreground font-medium">{eq.brand}</span>
                        )}
                        
                        {/* Source Badges */}
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
                      </div>
                      
                      <p className="text-sm font-semibold leading-snug line-clamp-2">
                        {eq.denumire_completa}
                      </p>

                      {ftSpecs?.rezumat_tehnic && (
                        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                          {ftSpecs.rezumat_tehnic}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col items-end justify-between self-stretch shrink-0 min-h-[60px]">
                      <div className="text-right">
                        <p className="text-sm font-bold text-primary">
                          {Number(eq.pret_lista).toFixed(2)} lei
                        </p>
                        <p className="text-xs text-muted-foreground">
                          / {eq.unit || "buc"}
                        </p>
                      </div>

                      <button
                        onClick={() => {
                          onReplace({
                            id: eq.id,
                            cod_intern: eq.cod_intern,
                            denumire_completa: eq.denumire_completa,
                            pret_lista: Number(eq.pret_lista),
                            unit: eq.unit,
                          });
                          onOpenChange(false);
                        }}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary-active border border-primary/20 hover:border-primary/50 px-2.5 py-1 rounded bg-primary/5 hover:bg-primary/10 transition-colors mt-2"
                        title="Înlocuiește produsul în ofertă"
                      >
                        <ArrowLeftRight className="h-3 w-3" />
                        Alege
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12 text-sm text-muted-foreground">
              Nu s-au găsit alte produse active în această categorie.
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

const Loader2 = ({ className }: { className?: string }) => (
  <div className={cn("animate-spin", className)}>
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-loader-2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
  </div>
);
