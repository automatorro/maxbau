import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { CategoryTree } from "@/components/CategoryTree";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Package, ChevronLeft, ChevronRight, Filter, X } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

const PAGE_SIZE = 24;

const Catalog = () => {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

  // Reset page on filter change
  const handleCategorySelect = (id: string | null) => {
    setSelectedCategory(id);
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
    queryKey: ["catalog-products", search, categoryIds, page],
    queryFn: async () => {
      let query = supabase
        .from("products")
        .select("*, categories(name)", { count: "exact" })
        .order("denumire_completa");

      if (search) {
        query = query.or(
          `denumire_completa.ilike.%${search}%,cod_intern.ilike.%${search}%`
        );
      }

      if (categoryIds) {
        query = query.in("category_id", categoryIds);
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

  const CategorySidebar = (
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
        </div>

        {/* Search + Mobile filter */}
        <div className="flex gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Caută după denumire sau cod intern..."
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
              <ScrollArea className="h-full">{CategorySidebar}</ScrollArea>
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
            <ScrollArea className="h-[calc(100vh-220px)] pr-2">
              {CategorySidebar}
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
                      className="hover:shadow-md transition-shadow group"
                    >
                      <CardHeader className="pb-2 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <Badge
                            variant="outline"
                            className="text-xs font-mono shrink-0 border-primary/30 text-primary"
                          >
                            {product.cod_intern}
                          </Badge>
                          {product.categories && (
                            <Badge variant="secondary" className="text-xs truncate max-w-[120px]">
                              {(product.categories as any).name}
                            </Badge>
                          )}
                        </div>
                        <CardTitle className="text-sm leading-tight line-clamp-2">
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
