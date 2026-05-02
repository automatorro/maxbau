import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Plus } from "lucide-react";

export interface PickedProduct {
  id: string;
  cod_intern: string;
  denumire_completa: string;
  pret_lista: number;
  unit: string | null;
  category_id: string | null;
}

interface MultiProductPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (products: PickedProduct[]) => void;
  title?: string;
}

export function MultiProductPicker({
  open,
  onOpenChange,
  onConfirm,
  title = "Selectează produse echivalente",
}: MultiProductPickerProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Map<string, PickedProduct>>(new Map());

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["multi-picker-products", search],
    queryFn: async () => {
      let query = supabase
        .from("products")
        .select("id, cod_intern, denumire_completa, pret_lista, unit, category_id, categories(name)")
        .order("denumire_completa")
        .limit(40);

      const tokens = search.trim().split(/\s+/).filter((t) => t.length >= 2);
      for (const raw of tokens) {
        const token = raw.replace(/,/g, "\\,");
        query = query.or(`denumire_completa.ilike.%${token}%,cod_intern.ilike.%${token}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as (PickedProduct & { categories: { name: string } | null })[];
    },
    enabled: open,
  });

  const toggle = (product: PickedProduct) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(product.id)) {
        next.delete(product.id);
      } else if (next.size < 3) {
        next.set(product.id, product);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    onConfirm(Array.from(selected.values()));
    setSelected(new Map());
    setSearch("");
    onOpenChange(false);
  };

  const handleClose = () => {
    setSelected(new Map());
    setSearch("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Selectați 1-3 produse echivalente din catalogul MaxBau
          </p>
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

        {selected.size > 0 && (
          <div className="flex flex-wrap gap-1 px-1">
            {Array.from(selected.values()).map((p) => (
              <Badge
                key={p.id}
                variant="secondary"
                className="text-xs cursor-pointer"
                onClick={() => toggle(p)}
              >
                {p.cod_intern} ×
              </Badge>
            ))}
          </div>
        )}

        <ScrollArea className="flex-1 -mx-2 min-h-0">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : products.length > 0 ? (
            <div className="space-y-1 px-2">
              {products.map((product) => {
                const isSelected = selected.has(product.id);
                const maxReached = selected.size >= 3 && !isSelected;
                return (
                  <button
                    key={product.id}
                    onClick={() => !maxReached && toggle(product)}
                    disabled={maxReached}
                    className={`w-full text-left rounded-md p-3 transition-colors border ${
                      isSelected
                        ? "bg-primary/5 border-primary/40"
                        : maxReached
                        ? "opacity-40 cursor-not-allowed border-transparent"
                        : "border-transparent hover:bg-accent/10 hover:border-border"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={isSelected}
                        className="mt-0.5 shrink-0"
                        onCheckedChange={() => !maxReached && toggle(product)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge
                            variant="outline"
                            className="text-xs font-mono shrink-0 border-primary/30 text-primary"
                          >
                            {product.cod_intern}
                          </Badge>
                          {product.categories && (
                            <span className="text-xs text-muted-foreground truncate">
                              {(product.categories as { name: string }).name}
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
                );
              })}
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground py-8">
              {search.trim().length < 2
                ? "Introduceți cel puțin 2 caractere"
                : "Niciun produs găsit"}
            </p>
          )}
        </ScrollArea>

        <div className="flex justify-between items-center pt-2 border-t">
          <span className="text-xs text-muted-foreground">
            {selected.size > 0
              ? `${selected.size} produs${selected.size > 1 ? "e" : ""} selectat${selected.size > 1 ? "e" : ""}`
              : "Niciun produs selectat"}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleClose}>
              Anulează
            </Button>
            <Button size="sm" onClick={handleConfirm} disabled={selected.size === 0}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Adaugă {selected.size > 0 ? `(${selected.size})` : ""}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
