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
import { Search, Plus } from "lucide-react";

interface Product {
  id: string;
  cod_intern: string;
  denumire_completa: string;
  pret_lista: number;
  unit: string | null;
  category_id: string | null;
  categories: { name: string } | null;
}

interface ProductPickerProps {
  onSelect: (product: Product) => void;
  trigger?: React.ReactNode;
}

export function ProductPicker({ onSelect, trigger }: ProductPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["picker-products", search],
    queryFn: async () => {
      let query = supabase
        .from("products")
        .select("id, cod_intern, denumire_completa, pret_lista, unit, category_id, categories(name)")
        .order("denumire_completa")
        .limit(30);

      if (search.length >= 2) {
        query = query.or(
          `denumire_completa.ilike.%${search}%,cod_intern.ilike.%${search}%`
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Product[];
    },
    enabled: open,
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
      <DialogContent className="max-w-lg max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Selectează produs</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Caută după denumire sau cod intern..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
            autoFocus
          />
        </div>
        <ScrollArea className="h-[400px] -mx-2">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : products.length > 0 ? (
            <div className="space-y-1 px-2">
              {products.map((product) => (
                <button
                  key={product.id}
                  onClick={() => handleSelect(product)}
                  className="w-full text-left rounded-md p-3 hover:bg-accent/10 transition-colors border border-transparent hover:border-border"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs font-mono shrink-0 border-primary/30 text-primary">
                          {product.cod_intern}
                        </Badge>
                        {product.categories && (
                          <span className="text-xs text-muted-foreground truncate">
                            {product.categories.name}
                          </span>
                        )}
                      </div>
                      <p className="text-sm leading-tight line-clamp-2">
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
              ))}
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground py-8">
              {search.length < 2 ? "Introduceți minim 2 caractere" : "Niciun produs găsit"}
            </p>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
