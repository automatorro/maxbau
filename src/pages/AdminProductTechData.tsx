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
import { Search, Pencil, CheckCircle2, Circle, Info } from "lucide-react";
import { toast } from "sonner";

interface Product {
  id: string;
  cod_intern: string;
  denumire_completa: string;
  unit: string | null;
  pret_lista: number;
  consum: string | null;
  ambalare: string | null;
  similar_cu: string | null;
  caracteristici: Record<string, unknown> | null;
}

interface EditForm {
  consum: string;
  ambalare: string;
  similar_cu: string;
  caracteristici_raw: string;
}

const EXAMPLE_CHARS = `{
  "tip": "adeziv",
  "clasa": "C2T",
  "standard": "EN 12004",
  "flexibil": true,
  "uz": "interior"
}`;

const AdminProductTechData = () => {
  const [search, setSearch] = useState("");
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<EditForm>({
    consum: "",
    ambalare: "",
    similar_cu: "",
    caracteristici_raw: "",
  });
  const [jsonError, setJsonError] = useState("");

  const queryClient = useQueryClient();

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["admin-tech-products", search],
    queryFn: async () => {
      let query = supabase
        .from("products")
        .select("id, cod_intern, denumire_completa, unit, pret_lista, consum, ambalare, similar_cu, caracteristici")
        .order("cod_intern");

      // Split by whitespace → AND logic per token (ca în AdminProducts)
      const tokens = search.trim().split(/\s+/).filter((t) => t.length >= 2);
      for (const raw of tokens) {
        const token = raw.replace(/,/g, "\\,");
        query = query.or(
          `denumire_completa.ilike.%${token}%,cod_intern.ilike.%${token}%`
        );
      }

      const { data, error } = await query.limit(100);
      if (error) throw error;
      return data as Product[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload: {
        consum: string | null;
        ambalare: string | null;
        similar_cu: string | null;
        caracteristici: Record<string, unknown> | null;
      };
    }) => {
      const { error } = await supabase
        .from("products")
        .update(payload)
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
    setForm({
      consum: product.consum || "",
      ambalare: product.ambalare || "",
      similar_cu: product.similar_cu || "",
      caracteristici_raw: product.caracteristici
        ? JSON.stringify(product.caracteristici, null, 2)
        : "",
    });
  };

  const handleSave = () => {
    if (!editProduct) return;

    let parsedChars: Record<string, unknown> | null = null;
    if (form.caracteristici_raw.trim()) {
      try {
        parsedChars = JSON.parse(form.caracteristici_raw);
        setJsonError("");
      } catch {
        setJsonError("JSON invalid — verificați sintaxa");
        return;
      }
    }

    saveMutation.mutate({
      id: editProduct.id,
      payload: {
        consum: form.consum.trim() || null,
        ambalare: form.ambalare.trim() || null,
        similar_cu: form.similar_cu.trim() || null,
        caracteristici: parsedChars,
      },
    });
  };

  const hasData = (p: Product) =>
    Boolean(p.consum || p.ambalare || p.similar_cu || p.caracteristici);

  const completenessPercent = (p: Product) => {
    const fields = [p.consum, p.ambalare, p.similar_cu, p.caracteristici];
    const filled = fields.filter(Boolean).length;
    return Math.round((filled / fields.length) * 100);
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
            Completați consum, ambalare, similar cu și caracteristici pentru a
            alimenta modulul de ofertare inteligentă
          </p>
        </div>

        {/* Progres completare */}
        {products.length > 0 && (
          <div className="flex items-center gap-3 text-sm p-3 bg-muted rounded-lg">
            <Info className="h-4 w-4 text-muted-foreground shrink-0" />
            <span>
              <strong>{totalWithData}</strong> din{" "}
              <strong>{products.length}</strong> produse afișate au cel puțin o
              dată tehnică completată
            </span>
            {totalWithData < products.length && (
              <Badge variant="secondary">
                {products.length - totalWithData} incomplete
              </Badge>
            )}
          </div>
        )}

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Caută produse (lăsați gol pentru toate)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="rounded-md border overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Cod</TableHead>
                <TableHead>Denumire</TableHead>
                <TableHead className="w-[40px]">UM</TableHead>
                <TableHead className="w-[110px]">Consum</TableHead>
                <TableHead className="w-[110px]">Ambalare</TableHead>
                <TableHead className="w-[160px]">Similar cu</TableHead>
                <TableHead className="w-[90px] text-center">Caractere.</TableHead>
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
                  <TableCell
                    colSpan={9}
                    className="text-center py-8 text-muted-foreground"
                  >
                    {search.length > 0
                      ? "Niciun produs găsit pentru această căutare"
                      : "Niciun produs în catalog"}
                  </TableCell>
                </TableRow>
              ) : (
                products.map((product) => {
                  const pct = completenessPercent(product);
                  return (
                    <TableRow key={product.id}>
                      <TableCell className="font-mono text-xs text-primary">
                        {product.cod_intern}
                      </TableCell>
                      <TableCell className="text-sm max-w-[220px]">
                        <span className="line-clamp-2">
                          {product.denumire_completa}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {product.unit || "buc"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {product.consum ? (
                          <span className="text-foreground">{product.consum}</span>
                        ) : (
                          <span className="text-muted-foreground italic">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {product.ambalare ? (
                          <span className="text-foreground">{product.ambalare}</span>
                        ) : (
                          <span className="text-muted-foreground italic">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs max-w-[160px]">
                        {product.similar_cu ? (
                          <span className="line-clamp-2 text-foreground">
                            {product.similar_cu}
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {product.caracteristici &&
                        Object.keys(product.caracteristici).length > 0 ? (
                          <Badge variant="secondary" className="text-xs">
                            {Object.keys(product.caracteristici).length} chei
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {pct === 100 ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600 mx-auto" />
                        ) : pct > 0 ? (
                          <span className="text-xs text-yellow-600 font-medium">
                            {pct}%
                          </span>
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground mx-auto" />
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(product)}
                        >
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
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>
                  Consum orientativ{" "}
                  <span className="text-muted-foreground text-xs">
                    (ex: "3-4 kg/m²")
                  </span>
                </Label>
                <Input
                  value={form.consum}
                  onChange={(e) => setForm((f) => ({ ...f, consum: e.target.value }))}
                  placeholder="ex: 3-4 kg/m²"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>
                  Ambalare{" "}
                  <span className="text-muted-foreground text-xs">
                    (ex: "sac 25 kg")
                  </span>
                </Label>
                <Input
                  value={form.ambalare}
                  onChange={(e) => setForm((f) => ({ ...f, ambalare: e.target.value }))}
                  placeholder="ex: sac 25 kg"
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label>
                Similar cu{" "}
                <span className="text-muted-foreground text-xs">
                  (produse echivalente alte branduri, separate prin virgulă)
                </span>
              </Label>
              <Input
                value={form.similar_cu}
                onChange={(e) =>
                  setForm((f) => ({ ...f, similar_cu: e.target.value }))
                }
                placeholder="ex: Mapei Keraflex Maxi S1, Baumit FlexMörtel, Ceresit CM 17"
                className="mt-1"
              />
            </div>

            <div>
              <Label>
                Caracteristici tehnice{" "}
                <span className="text-muted-foreground text-xs">(JSON)</span>
              </Label>
              <Textarea
                value={form.caracteristici_raw}
                onChange={(e) => {
                  setForm((f) => ({
                    ...f,
                    caracteristici_raw: e.target.value,
                  }));
                  setJsonError("");
                }}
                placeholder={EXAMPLE_CHARS}
                rows={8}
                className="mt-1 font-mono text-xs"
              />
              {jsonError && (
                <p className="text-xs text-destructive mt-1">{jsonError}</p>
              )}
              <details className="mt-2">
                <summary className="text-xs text-muted-foreground cursor-pointer">
                  Câmpuri recunoscute de motorul de matching
                </summary>
                <div className="mt-2 text-xs text-muted-foreground space-y-1 pl-2 border-l-2 border-muted">
                  <p><code>tip</code> — ex: "adeziv", "vopsea", "tencuiala", "chit"</p>
                  <p><code>clasa</code> — ex: "C1", "C2", "C2T", "C2TE", "C2S1", "TS1", "CG2"</p>
                  <p><code>standard</code> — ex: "EN 12004", "EN 13888", "EN 998"</p>
                  <p><code>flexibil</code> — true / false</p>
                  <p><code>uz</code> — "interior", "exterior"</p>
                  <p><code>priza_rapida</code> — true / false</p>
                  <p><code>bio</code> — true / false</p>
                </div>
              </details>
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
