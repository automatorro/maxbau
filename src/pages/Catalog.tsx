import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { buildSearchOrConditions } from "@/utils/searchUtils";
import { DashboardLayout } from "@/components/DashboardLayout";
import { CategoryTree } from "@/components/CategoryTree";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Package, ChevronLeft, ChevronRight, Filter, X } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";

const PAGE_SIZE = 24;

const Catalog = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSuppliers, setSelectedSuppliers] = useState<Set<string>>(new Set());
  const [onlyWithSpecs, setOnlyWithSpecs] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const q = searchParams.get("q");
    if (q) { setSearch(q); setPage(0); }
  }, [searchParams]);
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

  // Reset page on filter change
  const handleCategorySelect = (id: string | null) => {
    setSelectedCategory(id);
    setPage(0);
  };
  const handleSupplierToggle = (id: string) => {
    const newSet = new Set(selectedSuppliers);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedSuppliers(newSet);
    setPage(0);
  };
  const handleSearchChange = (val: string) => {
    setSearch(val);
    setPage(0);
  };

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["catalog-suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Build set of descendant category IDs for filtering
  const categoryIds = useMemo(() => {
    if (!selectedCategory) return null;
    const ids = new Set<string>([selectedCategory]);
    const addChildren = (parentId: string) => {
      categories.forEach((c) => {
        if (c.parent_id === parentId && !ids.has(c.id)) {
          ids.add(c.id);
          addChildren(c.id);
        }
      });
    };
    addChildren(selectedCategory);
    return Array.from(ids);
  }, [selectedCategory, categories]);

  const { data, isLoading } = useQuery({
    queryKey: ["catalog-products", search, categoryIds, Array.from(selectedSuppliers), onlyWithSpecs, page],
    queryFn: async () => {
      let query = supabase
        .from("products")
        .select("*, categories(name)", { count: "exact" })
        .order("denumire_completa");

      if (search) {
        // Căutare accent-insensitivă: generăm variante cu/fără diacritice românești
        // (ex: "vata bazaltica" găsește și produse cu "Vată bazaltică" în denumire)
        const tokens = search.trim().split(/\s+/).filter(Boolean);
        for (const raw of tokens) {
          query = query.or(buildSearchOrConditions(raw));
        }
      }

      if (categoryIds) {
        query = query.in("category_id", categoryIds);
      }

      if (selectedSuppliers.size > 0) {
        const hasNone = selectedSuppliers.has("none");
        const realSuppliers = Array.from(selectedSuppliers).filter(id => id !== "none");
        
        if (hasNone && realSuppliers.length > 0) {
          query = query.or(`supplier_id.is.null,supplier_id.in.(${realSuppliers.join(",")})`);
        } else if (hasNone) {
          query = query.is("supplier_id", null);
        } else {
          query = query.in("supplier_id", realSuppliers);
        }
      }

      if (onlyWithSpecs) {
        // Filtrăm produsele care au fișă tehnică PDF descărcată
        // (fisa_tehnica_processed este setat doar după extragerea specs cu Gemini,
        //  dar fisa_tehnica_url este disponibil imediat după scraping)
        query = query.not("fisa_tehnica_url", "is", null);
      }

      const { data, error, count } = await query
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (error) throw error;
      return { products: data, total: count ?? 0 };
    },
  });

  const products = data?.products ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const selectedCategoryName = useMemo(() => {
    if (!selectedCategory) return null;
    return categories.find((c) => c.id === selectedCategory)?.name;
  }, [selectedCategory, categories]);

  const FilterSidebar = (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-2">
          Date Tehnice
        </h3>
        <div className="px-2 space-y-2">
          <div className="flex items-center space-x-3">
            <Checkbox
              id="only-specs"
              checked={onlyWithSpecs}
              onCheckedChange={(checked) => {
                setOnlyWithSpecs(!!checked);
                setPage(0);
              }}
            />
            <label
              htmlFor="only-specs"
              className="text-sm font-medium leading-none cursor-pointer"
            >
              Doar cu fișă tehnică (🟢)
            </label>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-2">
          Categorii
        </h3>
        <CategoryTree
          categories={categories}
          selectedId={selectedCategory}
          onSelect={(id) => {
            handleCategorySelect(id);
            setMobileFilterOpen(false);
          }}
        />
      </div>

      {suppliers.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-2">
            Producători
          </h3>
          <div className="px-2 space-y-3">
            <div className="flex items-center space-x-3">
              <Checkbox 
                id="supplier-none" 
                checked={selectedSuppliers.has("none")}
                onCheckedChange={() => handleSupplierToggle("none")}
              />
              <label 
                htmlFor="supplier-none" 
                className="text-sm font-medium leading-none text-muted-foreground italic peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                Fără furnizor
              </label>
            </div>
            {suppliers.map(s => (
              <div key={s.id} className="flex items-center space-x-3">
                <Checkbox 
                  id={`supplier-${s.id}`} 
                  checked={selectedSuppliers.has(s.id)}
                  onCheckedChange={() => handleSupplierToggle(s.id)}
                />
                <label 
                  htmlFor={`supplier-${s.id}`} 
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  {s.name}
                </label>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <DashboardLayout>
      <div className="space-y-4">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Catalog produse</h1>
          <p className="text-muted-foreground text-sm">
            {total} produse {selectedCategoryName && `în ${selectedCategoryName}`}
          </p>
          <p className="text-xs text-muted-foreground mt-1 bg-amber-50 text-amber-800 p-2 rounded border border-amber-100 inline-block">
            💡 <strong>Sfat pentru căutare:</strong> Această căutare necesită ca <strong>toate</strong> cuvintele introduse să se regăsească în denumirea produsului. Folosiți doar cele mai importante 1-2 cuvinte (ex: tastați <em>"plasa sticla"</em>, nu <em>"plasa de armare din fibra de sticla"</em>). Pentru căutări cu text lung/complex folosiți modulele cu AI (Import sau Cerere).
          </p>
        </div>

        {/* Search + Mobile filter */}
        <div className="flex gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Caută după denumire sau cod intern (cuvinte esențiale)..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-10"
            />
          </div>
          {/* Mobile filter toggle */}
          <Sheet open={mobileFilterOpen} onOpenChange={setMobileFilterOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="lg:hidden shrink-0">
                <Filter className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-4">
              <ScrollArea className="h-full">{FilterSidebar}</ScrollArea>
            </SheetContent>
          </Sheet>
        </div>

        {/* Active filter badge */}
        {selectedCategoryName && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              {selectedCategoryName}
              <button onClick={() => handleCategorySelect(null)}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          </div>
        )}

        {/* Main layout */}
        <div className="flex gap-6">
          {/* Desktop sidebar */}
          <aside className="hidden lg:block w-60 shrink-0">
            <ScrollArea className="h-[calc(100vh-160px)] pr-2">
              {FilterSidebar}
            </ScrollArea>
          </aside>

          {/* Products grid */}
          <div className="flex-1 min-w-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : products.length > 0 ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {products.map((product) => (
                    <Card
                      key={product.id}
                      className="hover:shadow-md transition-shadow cursor-pointer group hover:border-primary/50"
                      onClick={() => navigate(`/catalog/product/${product.id}`)}
                    >
                      <CardHeader className="pb-2 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex flex-wrap gap-1.5 items-center min-w-0">
                            <Badge
                              variant="outline"
                              className="text-xs font-mono shrink-0 border-primary/30 text-primary"
                            >
                              {product.cod_intern}
                            </Badge>
                            {(() => {
                              const isImported = product.cod_intern?.startsWith("IMP-") || 
                                                 product.cod_intern?.startsWith("OCR-") || 
                                                 (product.grile_pret && typeof product.grile_pret === "object" && (product.grile_pret as any).import_code);
                              const isOcr = product.cod_intern?.startsWith("OCR-") || 
                                            (product.grile_pret && typeof product.grile_pret === "object" && String((product.grile_pret as any).import_code || "").startsWith("OCR-"));
                              if (isImported) {
                                return (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] py-0 px-1 shrink-0 border-orange-500/30 text-orange-600 bg-orange-50/50 font-medium"
                                  >
                                    {isOcr ? "OCR" : "Import"}
                                  </Badge>
                                );
                              }
                              return null;
                            })()}
                            {(() => {
                              const specs = (product.specifications || {}) as any;
                              if (specs.fisa_tehnica_specs) {
                                return (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] py-0 px-1 shrink-0 border-emerald-500/30 text-emerald-600 bg-emerald-50/50 font-medium font-sans"
                                    title="Verificat din fișă tehnică"
                                  >
                                    🟢 Fișă
                                  </Badge>
                                );
                              }
                              if (specs.ai_info) {
                                return (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] py-0 px-1 shrink-0 border-amber-500/30 text-amber-600 bg-amber-50/50 font-medium font-sans"
                                    title="Generat de AI — date orientative"
                                  >
                                    🟡 AI
                                  </Badge>
                                );
                              }
                              return (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] py-0 px-1 shrink-0 border-red-500/30 text-red-600 bg-red-50/50 font-medium font-sans"
                                  title="Fără date tehnice"
                                >
                                  🔴 Fără date
                                </Badge>
                              );
                            })()}
                          </div>
                          {product.categories && (
                            <Badge variant="secondary" className="text-xs truncate max-w-[120px]">
                              {(product.categories as any).name}
                            </Badge>
                          )}
                        </div>
                        <CardTitle className="text-sm leading-tight line-clamp-2 group-hover:text-primary transition-colors">
                          {product.denumire_completa}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="flex items-end justify-between">
                          <div>
                            <p className="text-xl font-bold text-primary">
                              {Number(product.pret_lista).toFixed(2)} lei
                            </p>
                            <p className="text-xs text-muted-foreground">
                              fără TVA / {product.unit || "buc"}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-6">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 0}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {page + 1} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Package className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">Niciun produs găsit</h3>
                <p className="text-sm text-muted-foreground">
                  {search
                    ? "Încercați alt termen de căutare"
                    : "Importați produse din Admin → Produse"}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Catalog;
