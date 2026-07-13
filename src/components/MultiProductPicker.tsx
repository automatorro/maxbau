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
import { Search, Plus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const [searchType, setSearchType] = useState<"standard" | "semantic">("standard");
  const [selected, setSelected] = useState<Map<string, PickedProduct>>(new Map());

  useEffect(() => {
    if (open) {
      setSearch(initialSearch);
      setSearchType("standard");
    }
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
    queryKey: ["multi-picker-products", search, searchType],
    queryFn: async () => {
      const norm = search.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      if (norm.length < 2) return [];

      if (searchType === "semantic") {
        const { data, error } = await supabase.functions.invoke("semantic-search", {
          body: { query: search, limit: 30, threshold: 0.50 }
        });
        if (error) throw error;
        
        return (data.results || []).map((r: any) => ({
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
      } else {
        const ROMANIAN_STOPWORDS = new Set([
          "cu", "la", "de", "din", "pe", "si", "pentru", "in", "o", "un", "sau",
          "al", "a", "ale", "cel", "cea", "cei", "cele"
        ]);
        const allTokens = norm
          .split(/[^a-z0-9]+/)
          .filter((t) => (t.length >= 2 && !ROMANIAN_STOPWORDS.has(t)) || /^\d+$/.test(t));

        const wordTokens = allTokens.filter((t) => !/^\d+$/.test(t));
        const numTokens = allTokens.filter((t) => /^\d+$/.test(t));

        // Phrase variants for code-suffix searches: "AF E" → "af-e", "afe"
        const phraseVariants = [...new Set([norm, norm.replace(/\s+/g, "-"), norm.replace(/[\s-]+/g, "")])]
          .filter((p) => p.length >= 2);

        let query = supabase
          .from("products")
          .select("id, cod_intern, denumire_completa, pret_lista, unit, category_id, categories(name), specifications")
          .limit(100);

        for (const t of allTokens) {
          const token = t.replace(/,/g, "\\,");
          query = query.or(`denumire_completa.ilike.%${token}%,cod_intern.ilike.%${token}%,brand.ilike.%${token}%,brand_slug.ilike.%${token}%`);
        }

        const { data, error } = await query;
        if (error) throw error;

        let results = (data ?? []) as any[];

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

        return scored;
      }
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
    setSearchType("standard");
    onOpenChange(false);
  };

  const handleClose = () => {
    setSelected(new Map());
    setSearch("");
    setSearchType("standard");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg flex flex-col gap-3 overflow-hidden" style={{ maxHeight: "85vh" }}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Selectați 1-3 produse echivalente din catalogul MaxBau
          </p>
        </DialogHeader>

        {/* Tab-uri căutare */}
        {!preloadedProducts && (
          <div className="flex border-b border-border mb-2 shrink-0">
            <button
              onClick={() => setSearchType("standard")}
              className={cn(
                "flex-1 py-1.5 text-xs font-medium border-b-2 transition-colors",
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
                "flex-1 py-1.5 text-xs font-medium border-b-2 transition-colors flex items-center justify-center gap-1.5",
                searchType === "semantic"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Sparkles className="h-3 w-3 text-primary" />
              Căutare Tehnică / AI (RAG)
            </button>
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={
              !preloadedProducts && searchType === "semantic"
                ? "Descrie proprietățile tehnice căutate..."
                : "Caută după denumire sau cod intern..."
            }
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

        <div className="-mx-2 overflow-y-auto" style={{ maxHeight: "55vh" }}>
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              {!preloadedProducts && searchType === "semantic" && (
                <span className="text-[11px] text-muted-foreground">Gemini generează vectorii de căutare...</span>
              )}
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
                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                          <Badge
                            variant="outline"
                            className="text-xs font-mono shrink-0 border-primary/30 text-primary"
                          >
                            {product.cod_intern}
                          </Badge>
                          {(product as unknown as { categories?: { name: string } | null }).categories && (
                            <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                              {(product as unknown as { categories: { name: string } }).categories.name}
                            </span>
                          )}
                          {/* Indicators */}
                          {(() => {
                            const specs = (product as any).specifications || {};
                            const ftSpecs = specs.fisa_tehnica_specs || null;
                            const aiInfo = specs.ai_info || null;
                            const source = ftSpecs ? "verified" : (aiInfo ? "ai" : "none");
                            return (
                              <>
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
                              </>
                            );
                          })()}
                          {/* Similarity match pct */}
                          {(product as any).similarity !== undefined && (
                            <span className="text-[9px] font-mono font-semibold bg-primary/10 text-primary px-1 py-0.2 rounded">
                              {Math.round((product as any).similarity * 100)}% match
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
            <div className="text-center text-sm text-muted-foreground py-8">
              {search.trim().length < 2 ? (
                "Introduceți cel puțin 2 caractere"
              ) : (
                <div className="space-y-1">
                  <p>Niciun produs găsit.</p>
                  {!preloadedProducts && searchType === "semantic" && (
                    <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                      Căutarea semantică utilizează RAG. Încearcă să reformulezi descrierea proprietăților (ex: clasa foc, conductivitate).
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

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
