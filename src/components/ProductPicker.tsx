import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Plus, Sparkles, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Product {
  id: string;
  cod_intern: string;
  denumire_completa: string;
  pret_lista: number;
  unit: string | null;
  category_id: string | null;
  categories: { name: string } | null;
  specifications?: any;
  similarity?: number;
}

interface ProductPickerProps {
  onSelect: (product: Product) => void;
  trigger?: React.ReactNode;
}

export function ProductPicker({ onSelect, trigger }: ProductPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [searchType, setSearchType] = useState<"standard" | "semantic">("standard");

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["picker-products", search, searchType],
    queryFn: async () => {
      if (search.length < 2) return [];

      if (searchType === "semantic") {
        const { data, error } = await supabase.functions.invoke("semantic-search", {
          body: { query: search, limit: 15, threshold: 0.35 }
        });
        if (error) throw error;
        
        const results = (data.results || []).map((r: any) => ({
          id: r.product_id,
          cod_intern: r.cod_intern,
          denumire_completa: r.denumire_completa,
          pret_lista: r.pret_lista || 0,
          unit: r.unit || "buc",
          category_id: r.category_id || null,
          categories: r.categories ? { name: r.categories.name } : null,
          specifications: r.specifications || null,
          similarity: r.similarity
        }));
        return results as Product[];
      } else {
        let query = supabase
          .from("products")
          .select("id, cod_intern, denumire_completa, pret_lista, unit, category_id, categories(name), specifications")
          .order("denumire_completa")
          .limit(30);

        const tokens = search.split(/\s+/).filter(Boolean);
        for (const raw of tokens) {
          const token = raw.replace(/,/g, "\\,");
          query = query.or(`denumire_completa.ilike.%${token}%,cod_intern.ilike.%${token}%,brand.ilike.%${token}%,brand_slug.ilike.%${token}%`);
        }
        const { data, error } = await query;
        if (error) throw error;
        return data as any[] as Product[];
      }
    },
    enabled: open && search.length >= 2,
  });

  const handleSelect = (product: Product) => {
    onSelect(product);
    setOpen(false);
    setSearch("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Plus className="h-4 w-4 mr-1" /> Adaugă produs
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col p-5">
        <DialogHeader className="pb-2">
          <DialogTitle>Selectează produs</DialogTitle>
        </DialogHeader>

        {/* Tab-uri căutare */}
        <div className="flex border-b border-border mb-3 shrink-0">
          <button
            onClick={() => setSearchType("standard")}
            className={cn(
              "flex-1 py-2 text-sm font-medium border-b-2 transition-colors",
              searchType === "standard"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Căutare Standard
          </button>
          <button
            onClick={() => setSearchType("semantic")}
            className={cn(
              "flex-1 py-2 text-sm font-medium border-b-2 transition-colors flex items-center justify-center gap-1.5",
              searchType === "semantic"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Sparkles className="h-4 w-4 text-primary" />
            Căutare Tehnică / AI (RAG)
          </button>
        </div>

        <div className="relative shrink-0 mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={
              searchType === "semantic"
                ? "Descrie proprietățile tehnice căutate..."
                : "Caută după denumire sau cod intern..."
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 h-10 rounded-lg"
            autoFocus
          />
        </div>

        <ScrollArea className="flex-1 min-h-0 h-[380px] -mx-2 pr-2">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-2">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              {searchType === "semantic" && (
                <span className="text-xs text-muted-foreground">Gemini generează vectorii de căutare...</span>
              )}
            </div>
          ) : products.length > 0 ? (
            <div className="space-y-1 px-2">
              {products.map((product) => {
                const specs = product.specifications || {};
                const ftSpecs = specs.fisa_tehnica_specs || null;
                const aiInfo = specs.ai_info || null;
                const source = ftSpecs ? "verified" : (aiInfo ? "ai" : "none");

                return (
                  <button
                    key={product.id}
                    onClick={() => handleSelect(product)}
                    className="w-full text-left rounded-md p-3 hover:bg-accent/10 transition-colors border border-transparent hover:border-border flex flex-col gap-1.5"
                  >
                    <div className="flex items-start justify-between gap-2 w-full">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                          <Badge variant="outline" className="text-xs font-mono shrink-0 border-primary/30 text-primary">
                            {product.cod_intern}
                          </Badge>
                          {product.categories && (
                            <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                              {product.categories.name}
                            </span>
                          )}
                          
                          {/* Indicators */}
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

                          {/* Similarity match pct */}
                          {product.similarity !== undefined && (
                            <span className="text-[10px] font-mono font-semibold bg-primary/10 text-primary px-1 py-0.2 rounded">
                              {Math.round(product.similarity * 100)}% match
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-medium leading-snug line-clamp-2">
                          {product.denumire_completa}
                        </p>
                      </div>
                      
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-primary">
                          {Number(product.pret_lista).toFixed(2)} lei
                        </p>
                        <p className="text-xs text-muted-foreground">
                          / {product.unit || "buc"}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-center text-sm text-muted-foreground py-16">
              {search.length < 2 ? (
                "Introduceți minim 2 caractere"
              ) : (
                <div className="space-y-1">
                  <p>Niciun produs găsit.</p>
                  {searchType === "semantic" && (
                    <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                      Căutarea semantică utilizează embeddings. Încearcă să reformulezi descrierea proprietăților (ex: clasa foc, conductivitate).
                    </p>
                  )}
                </div>
              )}
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
