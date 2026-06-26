import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2, Sparkles, BookOpen, AlertTriangle, ArrowRight, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchResult {
  product_id: string;
  cod_intern: string;
  denumire_completa: string;
  brand: string | null;
  fisa_tehnica_url: string | null;
  specs_text: string | null;
  specifications: Record<string, any> | null;
  similarity: number;
}

export default function TechnicalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanQuery = query.trim();
    if (!cleanQuery) return;

    setLoading(true);
    setSearched(true);
    try {
      const { data, error } = await supabase.functions.invoke("semantic-search", {
        body: { query: cleanQuery, limit: 12, threshold: 0.4 },
      });

      if (error || !data?.success) {
        throw new Error(error?.message || data?.error || "Căutarea semantică a eșuat.");
      }

      setResults(data.results || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Hero Section */}
        <div className="text-center space-y-3 py-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-semibold mb-2">
            <Sparkles className="h-4 w-4" />
            Căutare Semantică Inteligentă
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
            Caută după Specificații Tehnice
          </h1>
          <p className="text-muted-foreground text-sm max-w-xl mx-auto">
            Descrie în limbaj natural materialele sau proprietățile căutate (ex: 
            <span className="italic text-foreground font-medium"> " conductivitate termică sub 0.035 W/mK"</span> sau 
            <span className="italic text-foreground font-medium"> " adeziv flexibil clasă foc A1"</span>).
          </p>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearch} className="flex gap-2 max-w-2xl mx-auto">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Descrie cerințele tehnice ale materialelor..."
              className="pl-10 h-12 text-base rounded-xl shadow-sm border-muted-foreground/20 focus-visible:ring-primary"
              disabled={loading}
            />
          </div>
          <Button
            type="submit"
            size="lg"
            className="h-12 px-6 rounded-xl font-medium shadow"
            disabled={loading || !query.trim()}
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Căutare...
              </>
            ) : (
              "Caută"
            )}
          </Button>
        </form>

        {/* Search Results */}
        <div className="space-y-4 mt-8">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Gemini procesează interogarea tehnică...</p>
            </div>
          ) : results.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {results.map((r) => {
                const specs = r.specifications || {};
                const ftSpecs = specs.fisa_tehnica_specs || null;
                const aiInfo = specs.ai_info || null;
                const source = ftSpecs ? "verified" : (aiInfo ? "ai" : "none");
                const similarityPct = Math.round(r.similarity * 100);

                return (
                  <Card
                    key={r.product_id}
                    className="hover:shadow-md transition-all cursor-pointer border hover:border-primary/40 group flex flex-col justify-between"
                    onClick={() => navigate(`/catalog/product/${r.product_id}`)}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-wrap gap-1.5 items-center min-w-0">
                          <Badge variant="outline" className="font-mono text-[11px] text-primary border-primary/20 bg-primary/5">
                            {r.cod_intern}
                          </Badge>
                          {source === "verified" && (
                            <Badge variant="outline" className="text-[10px] py-0 px-1 border-emerald-500/20 text-emerald-700 bg-emerald-50/50 font-sans">
                              🟢 Fișă Verificată
                            </Badge>
                          )}
                          {source === "ai" && (
                            <Badge variant="outline" className="text-[10px] py-0 px-1 border-amber-500/20 text-amber-700 bg-amber-50/50 font-sans">
                              🟡 Date AI
                            </Badge>
                          )}
                          {source === "none" && (
                            <Badge variant="outline" className="text-[10px] py-0 px-1 border-red-500/20 text-red-700 bg-red-50/50 font-sans">
                              🔴 Fără Date
                            </Badge>
                          )}
                        </div>
                        
                        {/* Similarity Score */}
                        <div 
                          className={cn(
                            "text-xs font-semibold px-2 py-0.5 rounded font-mono shrink-0",
                            similarityPct >= 75 ? "bg-emerald-50 text-emerald-700 border border-emerald-100" :
                            similarityPct >= 60 ? "bg-blue-50 text-blue-700 border border-blue-100" :
                            "bg-gray-50 text-gray-700 border border-gray-100"
                          )}
                        >
                          {similarityPct}% potrivire
                        </div>
                      </div>
                      <CardTitle className="text-base leading-tight mt-2 group-hover:text-primary transition-colors">
                        {r.denumire_completa}
                      </CardTitle>
                      {r.brand && (
                        <p className="text-xs text-muted-foreground mt-0.5">Brand: {r.brand}</p>
                      )}
                    </CardHeader>

                    <CardContent className="pt-2 flex-1 flex flex-col justify-between space-y-4">
                      {/* Specs highlights */}
                      <div className="text-sm bg-muted/30 border border-muted/50 rounded-lg p-3 space-y-2">
                        {ftSpecs?.rezumat_tehnic ? (
                          <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                            {ftSpecs.rezumat_tehnic}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground italic">
                            Specificații complete în pagina produsului.
                          </p>
                        )}
                        
                        {/* Inline specs table */}
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-2 border-t border-muted/60 text-xs">
                          {ftSpecs?.conductivitate_termica && (
                            <div>
                              <span className="text-muted-foreground font-medium">Conductivitate (λ): </span>
                              <span className="font-semibold">{ftSpecs.conductivitate_termica}</span>
                            </div>
                          )}
                          {ftSpecs?.clasa_reactie_foc && (
                            <div>
                              <span className="text-muted-foreground font-medium">Clasă foc: </span>
                              <span className="font-semibold">{ftSpecs.clasa_reactie_foc}</span>
                            </div>
                          )}
                          {ftSpecs?.densitate && (
                            <div>
                              <span className="text-muted-foreground font-medium">Densitate: </span>
                              <span className="font-semibold">{ftSpecs.densitate}</span>
                            </div>
                          )}
                          {(ftSpecs?.consum || aiInfo?.consum) && (
                            <div>
                              <span className="text-muted-foreground font-medium">Consum: </span>
                              <span className="font-semibold">{ftSpecs?.consum || aiInfo?.consum}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2">
                        {r.fisa_tehnica_url ? (
                          <a
                            href={r.fisa_tehnica_url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            <BookOpen className="h-3 w-3" />
                            Vezi PDF
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground italic flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3 text-amber-500" />
                            Fără fișă PDF
                          </span>
                        )}
                        <span className="text-xs text-primary font-medium flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                          Detalii produs
                          <ArrowRight className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : searched ? (
            <div className="text-center py-16 bg-muted/20 border border-dashed rounded-2xl max-w-md mx-auto">
              <Sparkles className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-lg font-semibold">Niciun rezultat potrivit</h3>
              <p className="text-sm text-muted-foreground mt-1 px-4">
                Nu am găsit produse care să corespundă descrierii tale. Încearcă să reformulezi căutarea tehnică.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </DashboardLayout>
  );
}
