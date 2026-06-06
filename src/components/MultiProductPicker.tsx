import { useState, useEffect } from "react";
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
  initialSearch?: string;
  /** When provided, skip the independent DB query and filter locally from these pre-scored products. */
  preloadedProducts?: PickedProduct[];
}

export function MultiProductPicker({
  open,
  onOpenChange,
  onConfirm,
  title = "Selectează produse echivalente",
  initialSearch = "",
  preloadedProducts,
}: MultiProductPickerProps) {
  const [search, setSearch] = useState(initialSearch);
  const [selected, setSelected] = useState<Map<string, PickedProduct>>(new Map());

  useEffect(() => {
    if (open) setSearch(initialSearch);
  }, [open, initialSearch]);

  // ── When preloadedProducts are provided, filter them locally by the search input.
  // This ensures the modal shows the same result set as the inline list (no independent DB query).
  const filteredPreloaded = preloadedProducts
    ? (() => {
        const norm = search
          .trim()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();
        if (norm.length < 2) return preloadedProducts;
        return preloadedProducts.filter((p) => {
          const target = `${p.denumire_completa} ${p.cod_intern ?? ""}`
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();
          return target.includes(norm);
        });
      })()
    : null;

  const { data: dbProducts = [], isLoading } = useQuery({
    queryKey: ["multi-picker-products", search],
    queryFn: async () => {
      const norm = search.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const allTokens = norm
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2 || /^\d+$/.test(t));

      const wordTokens = allTokens.filter((t) => !/^\d+$/.test(t));
      const numTokens = allTokens.filter((t) => /^\d+$/.test(t));

      // Phrase variants for code-suffix searches: "AF E" → "af-e", "afe"
      const phraseVariants = [...new Set([norm, norm.replace(/\s+/g, "-"), norm.replace(/[\s-]+/g, "")])]
        .filter((p) => p.length >= 2);

      // Use OR logic (same as SmartQuote inline search) to ensure consistent counts.
      // This avoids AND-logic returning far fewer results than the "X produse găsite" indicator shows.
      const tokenParts = wordTokens.map(
        (t) =>
          `denumire_completa.ilike.%${t}%,cod_intern.ilike.%${t}%,brand.ilike.%${t}%,brand_slug.ilike.%${t}%`
      );
      const phraseParts = phraseVariants.map(
        (p) =>
          `denumire_completa.ilike.%${p}%,cod_intern.ilike.%${p}%,brand.ilike.%${p}%,brand_slug.ilike.%${p}%`
      );
      const orFilter = [...tokenParts, ...phraseParts].join(",");

      let query = supabase
        .from("products")
        .select("id, cod_intern, denumire_completa, pret_lista, unit, category_id, categories(name)")
        .limit(100);

      if (orFilter) {
        query = query.or(orFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      let results = (data ?? []) as (PickedProduct & { categories: { name: string } | null })[];

      // Word-boundary filter for numbers
      if (numTokens.length > 0) {
        results = results.filter((p) => {
          const target = `${p.denumire_completa} ${p.cod_intern ?? ""}`
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();
          return numTokens.every((n) =>
            new RegExp(`(?<![0-9])${n}(?![0-9])`).test(target)
          );
        });
      }

      // Client-side scoring: same token scoring as SmartQuote for consistent ranking
      const scored = results
        .map((p) => {
          const target = `${p.denumire_completa} ${p.cod_intern ?? ""}`
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();
          const tokenScore = wordTokens.reduce(
            (s, t) => s + (target.includes(t) ? t.length : 0),
            0
          );
          const phraseBonus = phraseVariants.reduce(
            (best, phrase) =>
              target.includes(phrase) ? Math.max(best, phrase.length * 3) : best,
            0
          );
          return { ...p, _score: tokenScore + phraseBonus };
        })
        .filter((p) => p._score > 0)
        .sort((a, b) => b._score - a._score);

      return scored as unknown as (PickedProduct & { categories: { name: string } | null })[];
    },
    // Skip DB query when preloadedProducts are provided
    enabled: open && !preloadedProducts,
  });

  // Use preloaded (locally filtered) products when available, otherwise fall back to DB results
  const products = filteredPreloaded ?? dbProducts;

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
