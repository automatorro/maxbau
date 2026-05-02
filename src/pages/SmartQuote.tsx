import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DashboardLayout } from "@/components/DashboardLayout";
import { MultiProductPicker, type PickedProduct } from "@/components/MultiProductPicker";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Trash2, Download, Save, Send, Search, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { TVA_RATE, TVA_PERCENT } from "@/lib/utils";
import { exportQuoteToExcel } from "@/lib/exportExcel";

type AiProductInfo = {
  consum: string;
  ambalaj: string;
  alternative: string[];
  compatibilitati: string;
  utilizare: string;
  updated_at: string;
};

interface OfertaItem {
  tempId: string;
  cerere_initiala: string;
  product_id: string;
  cod_intern: string;
  denumire: string;
  quantity: number;
  unit: string;
  pret_unitar: number;
  discount_percent: number;
  pret_final: number;
  subtotal: number;
}

function calcLine(item: Partial<OfertaItem>) {
  const pret = item.pret_unitar ?? 0;
  const disc = item.discount_percent ?? 0;
  const qty = item.quantity ?? 1;
  const pret_final = pret * (1 - disc / 100);
  return { pret_final, subtotal: pret_final * qty };
}

const SmartQuote = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [projectDesc, setProjectDesc] = useState("");

  const [cerereText, setCerereText] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [items, setItems] = useState<OfertaItem[]>([]);
  const [aiInfo, setAiInfo] = useState<Record<string, AiProductInfo>>({});
  const [aiLoading, setAiLoading] = useState(false);

  const fetchAiInfo = useCallback(async (productIds: string[], clientRequest: string) => {
    if (productIds.length === 0) return;
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-product-info", {
        body: { product_ids: productIds, client_request: clientRequest },
      });
      if (error) throw error;
      if (data?.success && data.data) {
        setAiInfo((prev) => ({ ...prev, ...data.data }));
        toast.success("Date tehnice AI primite");
      }
    } catch (e) {
      console.error("AI info error:", e);
      toast.error("Eroare la obținerea datelor tehnice AI");
    } finally {
      setAiLoading(false);
    }
  }, []);

  const handlePickerConfirm = useCallback(
    (picked: PickedProduct[]) => {
      if (!cerereText.trim() && picked.length > 0) {
        toast.warning("Completați ce a cerut clientul înainte de a adăuga produse");
        return;
      }
      const nou = picked
        .filter((p) => !items.some((i) => i.product_id === p.id))
        .map((p) => {
          const base: OfertaItem = {
            tempId: crypto.randomUUID(),
            cerere_initiala: cerereText.trim(),
            product_id: p.id,
            cod_intern: p.cod_intern,
            denumire: p.denumire_completa,
            quantity: 1,
            unit: p.unit || "buc",
            pret_unitar: Number(p.pret_lista),
            discount_percent: 0,
            pret_final: 0,
            subtotal: 0,
          };
          return { ...base, ...calcLine(base) };
        });

      if (nou.length === 0) {
        toast.info("Produsele selectate sunt deja în ofertă");
        return;
      }

      setItems((prev) => [...prev, ...nou]);
      setCerereText("");
      toast.success(`${nou.length} produs${nou.length > 1 ? "e adăugate" : " adăugat"} în ofertă`);
    },
    [cerereText, items]
  );

  const updateItem = useCallback(
    (tempId: string, field: keyof OfertaItem, value: number | string) => {
      setItems((prev) =>
        prev.map((item) => {
          if (item.tempId !== tempId) return item;
          const updated = { ...item, [field]: value };
          return { ...updated, ...calcLine(updated) };
        })
      );
    },
    []
  );

  const removeItem = (tempId: string) =>
    setItems((prev) => prev.filter((i) => i.tempId !== tempId));

  const totals = useMemo(() => {
    const net = items.reduce((s, i) => s + i.subtotal, 0);
    const tva = net * TVA_RATE;
    return { net, tva, gross: net + tva };
  }, [items]);

  const saveMutation = useMutation({
    mutationFn: async (status: "draft" | "sent") => {
      if (!user) throw new Error("Nu sunteți autentificat");
      if (items.length === 0) throw new Error("Adăugați cel puțin un produs");

      const { data: quote, error: qErr } = await supabase
        .from("quotes")
        .insert({
          user_id: user.id,
          client_name: clientName || null,
          client_phone: clientPhone || null,
          client_email: clientEmail || null,
          project_description: projectDesc || null,
          status,
          total_net: totals.net,
          total_tva: totals.tva,
          total_gross: totals.gross,
        })
        .select("id")
        .single();
      if (qErr || !quote) throw qErr ?? new Error("Eroare la creare ofertă");

      const rows = items.map((i) => ({
        quote_id: quote.id,
        product_id: i.product_id,
        cod_intern: i.cod_intern,
        denumire: i.denumire,
        quantity: i.quantity,
        unit: i.unit,
        pret_unitar: i.pret_unitar,
        discount_percent: i.discount_percent,
        pret_final: i.pret_final,
        subtotal: i.subtotal,
        cerere_initiala: i.cerere_initiala || null,
        nota_ai: aiInfo[i.product_id] ?? null,
      }));

      const { error: iErr } = await supabase.from("quote_items").insert(rows);
      if (iErr) throw iErr;
      return quote.id;
    },
    onSuccess: (_, status) => {
      queryClient.invalidateQueries({ queryKey: ["my-quotes"] });
      toast.success(status === "draft" ? "Ofertă salvată ca ciornă" : "Ofertă trimisă");
      navigate("/quotes");
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Eroare la salvare"),
  });

  const handleExport = () => {
    if (items.length === 0) {
      toast.error("Adăugați produse înainte de export");
      return;
    }
    exportQuoteToExcel(
      {
        data: new Date().toLocaleDateString("ro-RO"),
        client_name: clientName,
        client_phone: clientPhone,
        client_email: clientEmail,
        project_description: projectDesc,
        total_net: totals.net,
        total_tva: totals.tva,
        total_gross: totals.gross,
      },
      items.map((i) => ({
        cod_intern: i.cod_intern,
        denumire: i.denumire,
        cerere_initiala: i.cerere_initiala,
        quantity: i.quantity,
        unit: i.unit,
        pret_unitar: i.pret_unitar,
        discount_percent: i.discount_percent,
        pret_final: i.pret_final,
        subtotal: i.subtotal,
      }))
    );
    toast.success("Fișier Excel descărcat");
  };

  const groups = useMemo(() => {
    const map = new Map<string, OfertaItem[]>();
    for (const item of items) {
      const key = item.cerere_initiala || "—";
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [items]);

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-5xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Ofertă din cerere client
          </h1>
          <p className="text-sm text-muted-foreground">
            Notați ce a cerut clientul, căutați produse echivalente și construiți oferta pas cu pas
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Date client</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Nume client / Firmă</Label>
                <Input value={clientName} onChange={(e) => setClientName(e.target.value)}
                  placeholder="Popescu Ion / SC Construct SRL" />
              </div>
              <div>
                <Label className="text-xs">Telefon</Label>
                <Input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="07xx xxx xxx" />
              </div>
              <div>
                <Label className="text-xs">Email</Label>
                <Input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="email@client.ro" />
              </div>
            </div>
            <div className="mt-3">
              <Label className="text-xs">Descriere proiect</Label>
              <Textarea value={projectDesc} onChange={(e) => setProjectDesc(e.target.value)}
                placeholder="Ex: Amenajare baie 15 mp, placaj ceramic..." rows={2} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4" />
              Adaugă produse echivalente
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">
                Ce a cerut clientul{" "}
                <span className="text-muted-foreground">
                  (brand, denumire generică, caracteristici — exact cum a spus)
                </span>
              </Label>
              <Input
                value={cerereText}
                onChange={(e) => setCerereText(e.target.value)}
                placeholder='Ex: "Mapei Keraflex S2 25kg" sau "adeziv flexibil C2T pentru exterior"'
                className="mt-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && cerereText.trim()) setPickerOpen(true);
                }}
              />
            </div>
            <Button
              onClick={() => {
                if (!cerereText.trim()) {
                  toast.warning("Completați mai întâi ce a cerut clientul");
                  return;
                }
                setPickerOpen(true);
              }}
              className="gap-2"
            >
              <Search className="h-4 w-4" />
              Caută produse echivalente în catalog
            </Button>
            <p className="text-xs text-muted-foreground">
              Se va deschide catalogul MaxBau — puteți selecta până la 3 produse echivalente simultan
            </p>
          </CardContent>
        </Card>

        {items.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Produse în ofertă ({items.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table className="min-w-[860px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[200px]">Cerere client</TableHead>
                      <TableHead className="w-[90px]">Cod</TableHead>
                      <TableHead>Denumire MaxBau</TableHead>
                      <TableHead className="w-[70px] text-right">Cant.</TableHead>
                      <TableHead className="w-[45px]">UM</TableHead>
                      <TableHead className="w-[90px] text-right">Preț/UM</TableHead>
                      <TableHead className="w-[65px] text-right">Disc%</TableHead>
                      <TableHead className="w-[90px] text-right">Preț final</TableHead>
                      <TableHead className="w-[100px] text-right">Subtotal</TableHead>
                      <TableHead className="w-[36px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Array.from(groups.entries()).map(([cerere, groupItems], gi) =>
                      groupItems.map((item, idx) => (
                        <TableRow
                          key={item.tempId}
                          className={gi % 2 === 0 ? "bg-muted/20" : ""}
                        >
                          <TableCell className="text-xs text-muted-foreground align-top pt-3">
                            {idx === 0 && cerere !== "—" ? (
                              <span className="italic line-clamp-3">{cerere}</span>
                            ) : idx === 0 ? (
                              <span className="text-muted-foreground/50">—</span>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs font-mono border-primary/30 text-primary">
                              {item.cod_intern}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm max-w-[180px]">
                            <span className="line-clamp-2">{item.denumire}</span>
                          </TableCell>
                          <TableCell>
                            <Input type="number" min={0.01} step="any"
                              value={item.quantity}
                              onChange={(e) => updateItem(item.tempId, "quantity", parseFloat(e.target.value) || 0)}
                              className="h-8 w-[65px] text-right text-sm" />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{item.unit}</TableCell>
                          <TableCell>
                            <Input type="number" min={0} step="any"
                              value={item.pret_unitar}
                              onChange={(e) => updateItem(item.tempId, "pret_unitar", parseFloat(e.target.value) || 0)}
                              className="h-8 w-[85px] text-right text-sm" />
                          </TableCell>
                          <TableCell>
                            <Input type="number" min={0} max={100} step="0.5"
                              value={item.discount_percent}
                              onChange={(e) => updateItem(item.tempId, "discount_percent", parseFloat(e.target.value) || 0)}
                              className="h-8 w-[60px] text-right text-sm" />
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium">
                            {item.pret_final.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right text-sm font-bold">
                            {item.subtotal.toFixed(2)} lei
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => removeItem(item.tempId)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {items.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Detalii tehnice AI
                </CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={aiLoading}
                  onClick={() => {
                    const ids = items.map((i) => i.product_id);
                    const uniqueIds = [...new Set(ids)].slice(0, 5);
                    const lastCerere = items[items.length - 1]?.cerere_initiala || projectDesc || "";
                    fetchAiInfo(uniqueIds, lastCerere);
                  }}
                >
                  {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {aiLoading ? "Se încarcă..." : Object.keys(aiInfo).length > 0 ? "Reîncarcă" : "Obține date tehnice"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {Object.keys(aiInfo).length === 0 && !aiLoading && (
                <p className="text-sm text-muted-foreground italic">
                  Apasă butonul pentru a obține consum, ambalaj și alternative echivalente de la AI
                </p>
              )}
              {Object.keys(aiInfo).length > 0 && (
                <div className="space-y-3">
                  {items.map((item) => {
                    const info = aiInfo[item.product_id] as AiProductInfo | undefined;
                    if (!info) return null;
                    return (
                      <div key={item.tempId} className="rounded-md border p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs font-mono border-primary/30 text-primary">
                            {item.cod_intern}
                          </Badge>
                          <span className="text-sm font-medium truncate">{item.denumire}</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                          <div>
                            <span className="text-muted-foreground block">Consum:</span>
                            <span className="font-medium">{info.consum}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block">Ambalaj:</span>
                            <span className="font-medium">{info.ambalaj}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block">Utilizare:</span>
                            <span className="font-medium">{info.utilizare}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block">Compatibilități:</span>
                            <span className="font-medium">{info.compatibilitati}</span>
                          </div>
                        </div>
                        {info.alternative && info.alternative.length > 0 && (
                          <div className="text-xs">
                            <span className="text-muted-foreground">Alternative echivalente: </span>
                            {info.alternative.map((alt, i) => (
                              <Badge key={i} variant="secondary" className="text-[10px] mr-1 mb-1">
                                {alt}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {items.length > 0 && (
          <Card>
            <CardContent className="pt-4">
              <div className="flex flex-col items-end gap-1 text-sm">
                <div className="flex justify-between w-full max-w-xs">
                  <span className="text-muted-foreground">Total fără TVA:</span>
                  <span className="font-medium">{totals.net.toFixed(2)} lei</span>
                </div>
                <div className="flex justify-between w-full max-w-xs">
                  <span className="text-muted-foreground">TVA ({TVA_PERCENT}%):</span>
                  <span className="font-medium">{totals.tva.toFixed(2)} lei</span>
                </div>
                <div className="flex justify-between w-full max-w-xs border-t pt-1 mt-1">
                  <span className="font-bold">Total cu TVA:</span>
                  <span className="font-bold text-primary text-lg">
                    {totals.gross.toFixed(2)} lei
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {items.length > 0 && (
          <div className="flex gap-3 justify-end pb-8 flex-wrap">
            <Button variant="outline" onClick={handleExport} className="gap-2">
              <Download className="h-4 w-4" /> Exportă Excel
            </Button>
            <Button variant="outline"
              onClick={() => saveMutation.mutate("draft")}
              disabled={saveMutation.isPending}>
              <Save className="h-4 w-4 mr-1" /> Salvează ciornă
            </Button>
            <Button
              onClick={() => saveMutation.mutate("sent")}
              disabled={saveMutation.isPending}>
              <Send className="h-4 w-4 mr-1" /> Trimite oferta
            </Button>
          </div>
        )}
      </div>

      <MultiProductPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onConfirm={handlePickerConfirm}
        title={cerereText ? `Echivalente pentru: "${cerereText}"` : "Selectează produse"}
      />
    </DashboardLayout>
  );
};

export default SmartQuote;
