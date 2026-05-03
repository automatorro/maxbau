import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, Pencil, CheckCircle2, Circle, Info, AlertTriangle, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface AiInfo {
  consum?: string;
  ambalaj?: string;
  alternative?: string[];
  compatibilitati?: string;
  utilizare?: string;
  updated_at?: string;
}

interface Product {
  id: string;
  cod_intern: string;
  denumire_completa: string;
  unit: string | null;
  pret_lista: number;
  brand: string | null;
  specifications: Record<string, unknown> | null;
}

interface EditForm {
  consum: string;
  ambalaj: string;
  alternative: string;
  compatibilitati: string;
  utilizare: string;
  caracteristici_raw: string;
}

const getAiInfo = (p: Product): AiInfo | null => {
  const specs = p.specifications || {};
  return (specs.ai_info as AiInfo) || null;
};

const hasData = (p: Product) => {
  const ai = getAiInfo(p);
  if (!ai) return false;
  return Boolean(ai.consum || ai.ambalaj || ai.alternative?.length || ai.compatibilitati || ai.utilizare);
};

const completenessPercent = (p: Product) => {
  const ai = getAiInfo(p);
  if (!ai) return 0;
  const fields = [ai.consum, ai.ambalaj, ai.alternative?.length ? "yes" : null, ai.compatibilitati, ai.utilizare];
  const filled = fields.filter(Boolean).length;
  return Math.round((filled / fields.length) * 100);
};

const EXAMPLE_CHARS = `{
  "tip": "adeziv",
  "clasa": "C2T",
  "standard": "EN 12004"
}`;

const AdminProductTechData = () => {
  const [search, setSearch] = useState("");
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<EditForm>({
    consum: "",
    ambalaj: "",
    alternative: "",
    compatibilitati: "",
    utilizare: "",
    caracteristici_raw: "",
  });
  const [jsonError, setJsonError] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const queryClient = useQueryClient();

  const { data: products = [], isLoading, error: queryError } = useQuery({
    queryKey: ["admin-tech-products", search],
    queryFn: async () => {
      let query = supabase
        .from("products")
        .select("id, cod_intern, denumire_completa, unit, pret_lista, brand, specifications")
        .order("cod_intern");

      const tokens = search.trim().split(/\s+/).filter((t) => t.length >= 2);
      for (const raw of tokens) {
        const token = raw.replace(/,/g, "\\,");
        query = query.or(
          `denumire_completa.ilike.%${token}%,cod_intern.ilike.%${token}%`
        );
      }

      const { data, error } = await query.limit(200);
      if (error) throw error;
      return (data ?? []) as Product[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async ({ id, aiInfo, extraSpecs }: { id: string; aiInfo: AiInfo; extraSpecs: Record<string, unknown> | null }) => {
      const product = products.find(p => p.id === id);
      const existingSpecs = (product?.specifications as Record<string, unknown>) || {};
      const newSpecs = {
        ...existingSpecs,
        ai_info: { ...aiInfo, updated_at: new Date().toISOString() },
        ...(extraSpecs ? extraSpecs : {}),
      };
      const { error } = await supabase
        .from("products")
        .update({ specifications: newSpecs })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-tech-products"] });
      queryClient.invalidateQueries({ queryKey: ["all-products-smart-quote"] });
      toast.success("Date tehnice salvate");
      setEditProduct(null);
    },
    onError: () => toast.error("Eroare la salvare"),
  });

  const openEdit = (product: Product) => {
    setEditProduct(product);
    setJsonError("");
    const ai = getAiInfo(product);
    const specs = (product.specifications as Record<string, unknown>) || {};
    // Remove ai_info from specs for the "extra characteristics" editor
    const { ai_info, ...restSpecs } = specs;
    setForm({
      consum: ai?.consum || "",
      ambalaj: ai?.ambalaj || "",
      alternative: ai?.alternative?.join(", ") || "",
      compatibilitati: ai?.compatibilitati || "",
      utilizare: ai?.utilizare || "",
      caracteristici_raw: Object.keys(restSpecs).length > 0
        ? JSON.stringify(restSpecs, null, 2)
        : "",
    });
  };

  const handleSave = () => {
    if (!editProduct) return;

    let extraSpecs: Record<string, unknown> | null = null;
    if (form.caracteristici_raw.trim()) {
      try {
        extraSpecs = JSON.parse(form.caracteristici_raw);
        setJsonError("");
      } catch {
        setJsonError("JSON invalid — verificați sintaxa");
        return;
      }
    }

    const aiInfo: AiInfo = {
      consum: form.consum.trim() || undefined,
      ambalaj: form.ambalaj.trim() || undefined,
      alternative: form.alternative.trim()
        ? form.alternative.split(",").map(s => s.trim()).filter(Boolean)
        : [],
      compatibilitati: form.compatibilitati.trim() || undefined,
      utilizare: form.utilizare.trim() || undefined,
    };

    saveMutation.mutate({ id: editProduct.id, aiInfo, extraSpecs });
  };

  const fetchAiData = async () => {
    if (!editProduct) return;
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-product-info", {
        body: { product_ids: [editProduct.id] },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Eroare AI");

      const aiResult = data.data?.[editProduct.id] as AiInfo | undefined;
      const fromCache = (data.cached_ids as string[] || []).includes(editProduct.id);
      if (aiResult) {
        setForm(f => ({
          ...f,
          consum: aiResult.consum || f.consum,
          ambalaj: aiResult.ambalaj || f.ambalaj,
          alternative: aiResult.alternative?.join(", ") || f.alternative,
          compatibilitati: aiResult.compatibilitati || f.compatibilitati,
          utilizare: aiResult.utilizare || f.utilizare,
        }));
        toast.success(fromCache ? "Date încărcate din cache — verifică și salvează" : "Date AI noi primite — verifică și salvează");
      } else {
        toast.info("AI nu a returnat date pentru acest produs");
      }
    } catch (e) {
      console.error("AI fetch error:", e);
      toast.error("Eroare la obținerea datelor AI");
    } finally {
      setAiLoading(false);
    }
  };

  const totalWithData = products.filter(hasData).length;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Date tehnice produse
          </h1>
          <p className="text-sm text-muted-foreground">
            Completați consum, ambalare, alternative și caracteristici — manual sau cu ajutorul AI
          </p>
        </div>

        {queryError && (
          <div className="flex items-center gap-2 text-sm p-3 bg-destructive/10 text-destructive rounded-lg border border-destructive/20">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Eroare la încărcarea produselor: {(queryError as Error).message}</span>
          </div>
        )}

        {products.length > 0 && (
          <div className="flex items-center gap-3 text-sm p-3 bg-muted rounded-lg">
            <Info className="h-4 w-4 text-muted-foreground shrink-0" />
            <span>
              <strong>{totalWithData}</strong> din <strong>{products.length}</strong> produse afișate au date tehnice
            </span>
            {totalWithData < products.length && (
              <Badge variant="secondary">{products.length - totalWithData} incomplete</Badge>
            )}
          </div>
        )}

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Caută produse..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Desktop table */}
        <div className="hidden md:block rounded-md border overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Cod</TableHead>
                <TableHead>Denumire</TableHead>
                <TableHead className="w-[40px]">UM</TableHead>
                <TableHead className="w-[110px]">Consum</TableHead>
                <TableHead className="w-[110px]">Ambalaj</TableHead>
                <TableHead className="w-[160px]">Alternative</TableHead>
                <TableHead className="w-[70px] text-center">AI</TableHead>
                <TableHead className="w-[70px] text-center">Complet</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
                  </TableCell>
                </TableRow>
              ) : products.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    {search.length > 0 ? `Niciun produs găsit pentru "${search}"` : "Niciun produs în catalog"}
                  </TableCell>
                </TableRow>
              ) : (
                products.map((product) => {
                  const ai = getAiInfo(product);
                  const pct = completenessPercent(product);
                  return (
                    <TableRow key={product.id}>
                      <TableCell className="font-mono text-xs text-primary">{product.cod_intern}</TableCell>
                      <TableCell className="text-sm max-w-[220px]">
                        <span className="line-clamp-2">{product.denumire_completa}</span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{product.unit || "buc"}</TableCell>
                      <TableCell className="text-xs">
                        {ai?.consum ? (
                          <span className="text-foreground">{ai.consum}</span>
                        ) : (
                          <span className="text-muted-foreground italic">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {ai?.ambalaj ? (
                          <span className="text-foreground">{ai.ambalaj}</span>
                        ) : (
                          <span className="text-muted-foreground italic">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs max-w-[160px]">
                        {ai?.alternative?.length ? (
                          <span className="line-clamp-2 text-foreground">{ai.alternative.join(", ")}</span>
                        ) : (
                          <span className="text-muted-foreground italic">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {ai?.updated_at ? (
                          <Sparkles className="h-4 w-4 text-primary mx-auto" />
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {pct === 100 ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600 mx-auto" />
                        ) : pct > 0 ? (
                          <span className="text-xs text-yellow-600 font-medium">{pct}%</span>
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground mx-auto" />
                        )}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(product)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Mobile card list */}
        <div className="md:hidden space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              {search.length > 0 ? `Niciun produs găsit pentru "${search}"` : "Niciun produs în catalog"}
            </div>
          ) : (
            products.map((product) => {
              const ai = getAiInfo(product);
              const pct = completenessPercent(product);
              return (
                <div key={product.id} className="rounded-lg border bg-card p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary">
                          {product.cod_intern}
                        </Badge>
                        {ai?.updated_at && <Sparkles className="h-3 w-3 text-primary" />}
                      </div>
                      <p className="text-sm font-medium leading-snug line-clamp-2">{product.denumire_completa}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {pct === 100 ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : pct > 0 ? (
                        <span className="text-xs text-yellow-600 font-medium">{pct}%</span>
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground" />
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(product)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    {ai?.consum && <div><span className="text-muted-foreground">Consum: </span>{ai.consum}</div>}
                    {ai?.ambalaj && <div><span className="text-muted-foreground">Ambalaj: </span>{ai.ambalaj}</div>}
                    {ai?.alternative?.length ? (
                      <div className="col-span-2"><span className="text-muted-foreground">Alternative: </span>{ai.alternative.join(", ")}</div>
                    ) : null}
                    {!ai?.consum && !ai?.ambalaj && !ai?.alternative?.length && (
                      <div className="col-span-2 text-muted-foreground italic">Fără date tehnice</div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Dialog editare */}
      <Dialog open={Boolean(editProduct)} onOpenChange={(o) => !o && setEditProduct(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Date tehnice — {editProduct?.cod_intern}</DialogTitle>
            <p className="text-sm text-muted-foreground line-clamp-2">
              {editProduct?.denumire_completa}
            </p>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* AI Button */}
            <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
              <Sparkles className="h-5 w-5 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Completare automată cu AI</p>
                <p className="text-xs text-muted-foreground">
                  AI va căuta date tehnice și va completa câmpurile goale
                </p>
              </div>
              <Button
                size="sm"
                onClick={fetchAiData}
                disabled={aiLoading}
                className="shrink-0"
              >
                {aiLoading ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Se caută...</>
                ) : (
                  <><Sparkles className="h-3.5 w-3.5 mr-1" /> Obține date AI</>
                )}
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Consum orientativ <span className="text-muted-foreground text-xs">(ex: "3-4 kg/m²")</span></Label>
                <Input
                  value={form.consum}
                  onChange={(e) => setForm((f) => ({ ...f, consum: e.target.value }))}
                  placeholder="ex: 3-4 kg/m²"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Ambalaj <span className="text-muted-foreground text-xs">(ex: "sac 25 kg")</span></Label>
                <Input
                  value={form.ambalaj}
                  onChange={(e) => setForm((f) => ({ ...f, ambalaj: e.target.value }))}
                  placeholder="ex: sac 25 kg"
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label>Alternative echivalente <span className="text-muted-foreground text-xs">(separate prin virgulă)</span></Label>
              <Input
                value={form.alternative}
                onChange={(e) => setForm((f) => ({ ...f, alternative: e.target.value }))}
                placeholder="ex: Mapei Keraflex Maxi S1, Baumit FlexMörtel"
                className="mt-1"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Compatibilități</Label>
                <Input
                  value={form.compatibilitati}
                  onChange={(e) => setForm((f) => ({ ...f, compatibilitati: e.target.value }))}
                  placeholder="ex: beton, zidărie, gips-carton"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Utilizare</Label>
                <Input
                  value={form.utilizare}
                  onChange={(e) => setForm((f) => ({ ...f, utilizare: e.target.value }))}
                  placeholder="ex: interior/exterior"
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label>Caracteristici suplimentare <span className="text-muted-foreground text-xs">(JSON)</span></Label>
              <Textarea
                value={form.caracteristici_raw}
                onChange={(e) => {
                  setForm((f) => ({ ...f, caracteristici_raw: e.target.value }));
                  setJsonError("");
                }}
                placeholder={EXAMPLE_CHARS}
                rows={6}
                className="mt-1 font-mono text-xs"
              />
              {jsonError && <p className="text-xs text-destructive mt-1">{jsonError}</p>}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditProduct(null)}>
              Anulează
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Se salvează..." : "Salvează"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default AdminProductTechData;
