import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  Plus,
  Download,
  CheckCircle2,
  Package,
  Ruler,
  Tag,
  Info,
  ShoppingCart,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { TVA_RATE, TVA_PERCENT } from "@/lib/utils";
import {
  findEquivalentProducts,
  extractCaracteristici,
  calculeazaCantitate,
  type ProductForMatching,
  type ClientRequest,
  type MatchResult,
} from "@/lib/matchingEngine";
import { exportQuoteToExcel } from "@/lib/exportExcel";

const TIP_PRODUSE = [
  "Adeziv ceramic",
  "Chit / Rost",
  "Tencuială",
  "Glet / Șpaclu",
  "Vopsea / Zugrăveală",
  "Termoizolație",
  "Hidroizolație",
  "Pardoseală / Șapă",
  "Beton / Mortar",
  "Silicon / Etanșant",
  "Amorsă / Grund",
  "Altele",
];

interface SelectedMatch {
  result: MatchResult;
  cantitate: number;
  unitate: string;
  discount: number;
  cerere_initiala: string;
}

const SmartQuote = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  // ── Formular cerere ──────────────────────────────────────────────────────
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [projectDesc, setProjectDesc] = useState("");

  const [descriere, setDescriere] = useState("");
  const [tipProdus, setTipProdus] = useState("");
  const [suprafata, setSuprafata] = useState("");
  const [cantitateManual, setCantitateManual] = useState("");
  const [unitateManual, setUnitateManual] = useState("buc");

  // ── Rezultate matching ───────────────────────────────────────────────────
  const [results, setResults] = useState<MatchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedMatches, setSelectedMatches] = useState<SelectedMatch[]>([]);
  const [ofertaItems, setOfertaItems] = useState<SelectedMatch[]>([]);

  // ── Date produse (toate, pentru matching local) ──────────────────────────
  const { data: allProducts = [], isLoading: loadingProducts } = useQuery({
    queryKey: ["all-products-smart-quote"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id, cod_intern, denumire_completa, pret_lista, unit, category_id, consum, ambalare, similar_cu, caracteristici"
        );
      if (error) throw error;
      return data as ProductForMatching[];
    },
    staleTime: 5 * 60 * 1000,
  });

  // ── Căutare ──────────────────────────────────────────────────────────────
  const handleSearch = () => {
    if (!descriere.trim()) {
      toast.error("Introduceți descrierea cererii clientului");
      return;
    }

    const request: ClientRequest = {
      descriere: descriere + (tipProdus ? ` ${tipProdus}` : ""),
      tip_produs: tipProdus || undefined,
      suprafata: suprafata ? parseFloat(suprafata) : undefined,
      cantitate: cantitateManual ? parseFloat(cantitateManual) : undefined,
      unitate: unitateManual || undefined,
    };

    const found = findEquivalentProducts(request, allProducts, 3);
    setResults(found);
    setSearched(true);
    setSelectedIds(new Set());
    setSelectedMatches([]);

    if (found.length === 0) {
      toast.warning("Niciun produs echivalent găsit. Verificați descrierea.");
    } else {
      toast.success(`${found.length} produs${found.length > 1 ? "e" : ""} echivalent${found.length > 1 ? "e" : ""} găsit${found.length > 1 ? "e" : ""}`);
    }
  };

  const toggleSelect = (result: MatchResult) => {
    const id = result.product.id;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setSelectedMatches((sm) => sm.filter((s) => s.result.product.id !== id));
      } else {
        next.add(id);
        const sup = suprafata ? parseFloat(suprafata) : 0;
        const calc = calculeazaCantitate(
          sup,
          result.product.consum,
          result.product.ambalare
        );
        const cantitate =
          calc.cantitate > 0
            ? calc.cantitate
            : cantitateManual
            ? parseFloat(cantitateManual)
            : 1;
        setSelectedMatches((sm) => [
          ...sm,
          {
            result,
            cantitate,
            unitate: result.unitate_calculata || result.product.unit || unitateManual || "buc",
            discount: 0,
            cerere_initiala: descriere,
          },
        ]);
      }
      return next;
    });
  };

  const updateSelectedCantitate = (productId: string, val: number) => {
    setSelectedMatches((prev) =>
      prev.map((s) =>
        s.result.product.id === productId ? { ...s, cantitate: val } : s
      )
    );
  };

  const updateSelectedDiscount = (productId: string, val: number) => {
    setSelectedMatches((prev) =>
      prev.map((s) =>
        s.result.product.id === productId ? { ...s, discount: val } : s
      )
    );
  };

  const handleAdaugaLaOferta = () => {
    if (selectedMatches.length === 0) {
      toast.error("Selectați cel puțin un produs echivalent");
      return;
    }
    setOfertaItems((prev) => {
      const existingIds = new Set(prev.map((i) => i.result.product.id));
      const nou = selectedMatches.filter(
        (s) => !existingIds.has(s.result.product.id)
      );
      return [...prev, ...nou];
    });
    setDescriere("");
    setTipProdus("");
    setSuprafata("");
    setCantitateManual("");
    setResults([]);
    setSearched(false);
    setSelectedIds(new Set());
    setSelectedMatches([]);
    toast.success("Produse adăugate în ofertă. Puteți adăuga o nouă cerere.");
  };

  const removeFromOferta = (productId: string) => {
    setOfertaItems((prev) =>
      prev.filter((i) => i.result.product.id !== productId)
    );
  };

  const totals = useMemo(() => {
    const net = ofertaItems.reduce((s, i) => {
      const pretFinal =
        Number(i.result.product.pret_lista) * (1 - i.discount / 100);
      return s + pretFinal * i.cantitate;
    }, 0);
    const tva = net * TVA_RATE;
    return { net, tva, gross: net + tva };
  }, [ofertaItems]);

  const handleSalveazaOferta = async () => {
    if (!user) return;
    if (ofertaItems.length === 0) {
      toast.error("Adăugați cel puțin un produs în ofertă");
      return;
    }

    const { data: quote, error: qErr } = await supabase
      .from("quotes")
      .insert({
        user_id: user.id,
        client_name: clientName || null,
        client_phone: clientPhone || null,
        client_email: clientEmail || null,
        project_description: projectDesc || null,
        status: "draft" as const,
        total_net: totals.net,
        total_tva: totals.tva,
        total_gross: totals.gross,
      })
      .select("id")
      .single();

    if (qErr || !quote) {
      toast.error("Eroare la crearea ofertei");
      return;
    }

    const items = ofertaItems.map((i) => {
      const pretFinal =
        Number(i.result.product.pret_lista) * (1 - i.discount / 100);
      return {
        quote_id: quote.id,
        product_id: i.result.product.id,
        cod_intern: i.result.product.cod_intern,
        denumire: i.result.product.denumire_completa,
        quantity: i.cantitate,
        unit: i.unitate,
        pret_unitar: Number(i.result.product.pret_lista),
        discount_percent: i.discount,
        pret_final: pretFinal,
        subtotal: pretFinal * i.cantitate,
        cerere_initiala: i.cerere_initiala || null,
        nota_echivalenta: i.result.match_reason || null,
      };
    });

    const { error: iErr } = await supabase.from("quote_items").insert(items);
    if (iErr) {
      toast.error("Eroare la salvarea produselor");
      return;
    }

    // Salvează cererea clientului
    if (projectDesc || clientName) {
      await supabase.from("cereri_clienti").insert({
        user_id: user.id,
        descriere_client: ofertaItems.map((i) => i.cerere_initiala).join("; "),
        quote_id: quote.id,
      });
    }

    toast.success("Ofertă salvată! Poți edita detalii suplimentare.");
    navigate(`/quote/${quote.id}/edit`);
  };

  const handleExportExcel = () => {
    if (ofertaItems.length === 0) {
      toast.error("Adăugați produse în ofertă înainte de export");
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
      ofertaItems.map((i) => {
        const pretFinal =
          Number(i.result.product.pret_lista) * (1 - i.discount / 100);
        return {
          cod_intern: i.result.product.cod_intern,
          denumire: i.result.product.denumire_completa,
          cerere_initiala: i.cerere_initiala,
          nota_echivalenta: i.result.match_reason,
          consum: i.result.product.consum,
          ambalare: i.result.product.ambalare,
          similar_cu: i.result.product.similar_cu,
          quantity: i.cantitate,
          unit: i.unitate,
          pret_unitar: Number(i.result.product.pret_lista),
          discount_percent: i.discount,
          pret_final: pretFinal,
          subtotal: pretFinal * i.cantitate,
        };
      })
    );
    toast.success("Fișier Excel descărcat");
  };

  const extractedChars = useMemo(
    () => extractCaracteristici(descriere),
    [descriere]
  );

  const hasExtracted = Object.keys(extractedChars).length > 0;

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-5xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Ofertă din cerere client
          </h1>
          <p className="text-sm text-muted-foreground">
            Introduceți descrierea clientului — sistemul găsește automat produse
            echivalente din catalogul MaxBau
          </p>
        </div>

        {/* Date client */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Date client</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Nume client / Firmă</Label>
                <Input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Popescu Ion / SC Construct SRL"
                />
              </div>
              <div>
                <Label className="text-xs">Telefon</Label>
                <Input
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="07xx xxx xxx"
                />
              </div>
              <div>
                <Label className="text-xs">Email</Label>
                <Input
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="email@client.ro"
                />
              </div>
            </div>
            <div className="mt-3">
              <Label className="text-xs">Descriere proiect</Label>
              <Textarea
                value={projectDesc}
                onChange={(e) => setProjectDesc(e.target.value)}
                placeholder="Ex: Amenajare baie 15 mp, placaj ceramic..."
                rows={2}
              />
            </div>
          </CardContent>
        </Card>

        {/* Cerere produs */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4" />
              Cerere produs
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">
                Descrierea cererii clientului{" "}
                <span className="text-muted-foreground">
                  (branduri, caracteristici, standarde)
                </span>
              </Label>
              <Textarea
                value={descriere}
                onChange={(e) => setDescriere(e.target.value)}
                placeholder="Ex: adeziv flexibil pentru faianță și gresie clasa C2T EN 12004, sau: Mapei Keraflex Maxi S1 25kg"
                rows={3}
                className="mt-1"
              />
            </div>

            {/* Caracteristici auto-extrase */}
            {hasExtracted && (
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Info className="h-3 w-3" /> Detectat automat:
                </span>
                {Object.entries(extractedChars).map(([k, v]) => (
                  <Badge key={k} variant="secondary" className="text-xs">
                    {k}: {v}
                  </Badge>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs">Tip produs</Label>
                <Select value={tipProdus} onValueChange={setTipProdus}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Orice tip" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Orice tip</SelectItem>
                    {TIP_PRODUSE.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Suprafață (m²)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  value={suprafata}
                  onChange={(e) => setSuprafata(e.target.value)}
                  placeholder="Ex: 25"
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs">Cantitate manuală</Label>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={cantitateManual}
                  onChange={(e) => setCantitateManual(e.target.value)}
                  placeholder="Opțional"
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs">UM</Label>
                <Select value={unitateManual} onValueChange={setUnitateManual}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["buc", "sac", "kg", "L", "m²", "m", "ml", "rola", "set"].map(
                      (u) => (
                        <SelectItem key={u} value={u}>
                          {u}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button
              onClick={handleSearch}
              disabled={loadingProducts || !descriere.trim()}
              className="gap-2"
            >
              {loadingProducts ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Găsește echivalente
            </Button>
          </CardContent>
        </Card>

        {/* Rezultate matching */}
        {searched && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {results.length > 0
                  ? `${results.length} produs${results.length > 1 ? "e echivalente" : " echivalent"} găsit${results.length > 1 ? "e" : ""}`
                  : "Niciun produs echivalent găsit"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {results.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                  <AlertTriangle className="h-5 w-5 text-yellow-500" />
                  Niciun produs din catalog nu se potrivește cu această cerere.
                  Completați câmpurile de date tehnice din admin pentru mai multe produse.
                </div>
              ) : (
                results.map((result) => {
                  const isSelected = selectedIds.has(result.product.id);
                  const selMatch = selectedMatches.find(
                    (s) => s.result.product.id === result.product.id
                  );
                  const sup = suprafata ? parseFloat(suprafata) : 0;
                  const calc = calculeazaCantitate(
                    sup,
                    result.product.consum,
                    result.product.ambalare
                  );

                  return (
                    <div
                      key={result.product.id}
                      className={`border rounded-lg p-4 transition-all cursor-pointer ${
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
                      onClick={() => toggleSelect(result)}
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelect(result)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1 shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          {/* Header produs */}
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <Badge
                                  variant="outline"
                                  className="font-mono text-xs border-primary/30 text-primary shrink-0"
                                >
                                  {result.product.cod_intern}
                                </Badge>
                                <ScoreBadge score={result.score} />
                              </div>
                              <p className="font-medium text-sm leading-tight">
                                {result.product.denumire_completa}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-lg font-bold text-primary">
                                {Number(result.product.pret_lista).toFixed(2)} lei
                              </p>
                              <p className="text-xs text-muted-foreground">
                                / {result.product.unit || "buc"}
                              </p>
                            </div>
                          </div>

                          {/* Date tehnice */}
                          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                            {result.product.consum && (
                              <span className="flex items-center gap-1">
                                <Ruler className="h-3 w-3" />
                                Consum: {result.product.consum}
                              </span>
                            )}
                            {result.product.ambalare && (
                              <span className="flex items-center gap-1">
                                <Package className="h-3 w-3" />
                                {result.product.ambalare}
                              </span>
                            )}
                            {result.product.similar_cu && (
                              <span className="flex items-center gap-1">
                                <Tag className="h-3 w-3" />
                                Similar: {result.product.similar_cu}
                              </span>
                            )}
                          </div>

                          {/* Motiv potrivire */}
                          <p className="mt-1 text-xs text-muted-foreground italic">
                            {result.match_reason}
                          </p>

                          {/* Calcul cantitate */}
                          {sup > 0 && calc.cantitate > 0 && (
                            <div className="mt-2 text-xs bg-muted rounded px-2 py-1 inline-block">
                              {calc.descriere}
                            </div>
                          )}

                          {/* Câmpuri editabile când e selectat */}
                          {isSelected && selMatch && (
                            <div
                              className="mt-3 flex gap-3 items-end flex-wrap"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div>
                                <Label className="text-xs">Cantitate</Label>
                                <Input
                                  type="number"
                                  min={0.01}
                                  step="any"
                                  value={selMatch.cantitate}
                                  onChange={(e) =>
                                    updateSelectedCantitate(
                                      result.product.id,
                                      parseFloat(e.target.value) || 0
                                    )
                                  }
                                  className="h-8 w-[90px] text-right"
                                />
                              </div>
                              <div>
                                <Label className="text-xs">UM</Label>
                                <Input
                                  value={selMatch.unitate}
                                  readOnly
                                  className="h-8 w-[60px] text-center bg-muted"
                                />
                              </div>
                              <div>
                                <Label className="text-xs">Disc. %</Label>
                                <Input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step="0.5"
                                  value={selMatch.discount}
                                  onChange={(e) =>
                                    updateSelectedDiscount(
                                      result.product.id,
                                      parseFloat(e.target.value) || 0
                                    )
                                  }
                                  className="h-8 w-[70px] text-right"
                                />
                              </div>
                              <div className="text-sm">
                                <span className="text-muted-foreground text-xs">Subtotal:</span>
                                <span className="font-bold ml-1">
                                  {(
                                    Number(result.product.pret_lista) *
                                    (1 - selMatch.discount / 100) *
                                    selMatch.cantitate
                                  ).toFixed(2)}{" "}
                                  lei
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}

              {results.length > 0 && (
                <div className="flex justify-end pt-2">
                  <Button
                    onClick={handleAdaugaLaOferta}
                    disabled={selectedIds.size === 0}
                    className="gap-2"
                  >
                    <ShoppingCart className="h-4 w-4" />
                    Adaugă {selectedIds.size > 0 ? `(${selectedIds.size})` : ""} la ofertă
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Oferta curentă */}
        {ofertaItems.length > 0 && (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  Oferta curentă ({ofertaItems.length} produs
                  {ofertaItems.length > 1 ? "e" : ""})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table className="min-w-[860px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[90px]">Cod</TableHead>
                        <TableHead>Denumire MaxBau</TableHead>
                        <TableHead className="w-[180px]">Cerere client</TableHead>
                        <TableHead className="w-[100px]">Similar cu</TableHead>
                        <TableHead className="w-[90px]">Consum</TableHead>
                        <TableHead className="w-[80px]">Ambalare</TableHead>
                        <TableHead className="w-[70px] text-right">Cant.</TableHead>
                        <TableHead className="w-[45px]">UM</TableHead>
                        <TableHead className="w-[80px] text-right">Preț/UM</TableHead>
                        <TableHead className="w-[60px] text-right">Disc%</TableHead>
                        <TableHead className="w-[90px] text-right">Subtotal</TableHead>
                        <TableHead className="w-[36px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ofertaItems.map((item) => {
                        const pretFinal =
                          Number(item.result.product.pret_lista) *
                          (1 - item.discount / 100);
                        const subtotal = pretFinal * item.cantitate;
                        return (
                          <TableRow key={item.result.product.id}>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className="text-xs font-mono border-primary/30 text-primary"
                              >
                                {item.result.product.cod_intern}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm max-w-[160px]">
                              <span className="line-clamp-2">
                                {item.result.product.denumire_completa}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[180px]">
                              <span className="line-clamp-2">{item.cerere_initiala}</span>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {item.result.product.similar_cu || "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {item.result.product.consum || "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {item.result.product.ambalare || "—"}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {item.cantitate}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {item.unitate}
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {Number(item.result.product.pret_lista).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {item.discount > 0 ? `${item.discount}%` : "—"}
                            </TableCell>
                            <TableCell className="text-right font-bold">
                              {subtotal.toFixed(2)} lei
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() =>
                                  removeFromOferta(item.result.product.id)
                                }
                              >
                                ×
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Totaluri */}
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

            <Separator />

            {/* Acțiuni finale */}
            <div className="flex gap-3 justify-end pb-8 flex-wrap">
              <Button variant="outline" onClick={handleExportExcel} className="gap-2">
                <Download className="h-4 w-4" />
                Exportă Excel
              </Button>
              <Button onClick={handleSalveazaOferta} className="gap-2">
                <Plus className="h-4 w-4" />
                Salvează oferta
              </Button>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

// ── Componentă scor vizual ────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 70
      ? "bg-green-100 text-green-800 border-green-300"
      : score >= 40
      ? "bg-yellow-100 text-yellow-800 border-yellow-300"
      : "bg-red-100 text-red-800 border-red-300";
  const label =
    score >= 70 ? "Potrivire bună" : score >= 40 ? "Potrivire parțială" : "Potrivire slabă";

  return (
    <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${color}`}>
      {score}% — {label}
    </span>
  );
}

export default SmartQuote;
