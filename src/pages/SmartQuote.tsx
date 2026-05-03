import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DashboardLayout } from "@/components/DashboardLayout";
import { MultiProductPicker, type PickedProduct } from "@/components/MultiProductPicker";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Trash2, Download, Save, Send, Sparkles, Loader2,
  ExternalLink, PackageSearch, ChevronRight, Bot, Plus,
} from "lucide-react";
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

type SuggestedProduct = PickedProduct & { score: number };

type EquivalentResult = {
  product_id: string;
  cod_intern: string;
  denumire_completa: string;
  pret_lista: number;
  unit: string;
  justificare: string;
  scor: number;
};

type EquivalentSearchResponse = {
  success: boolean;
  from_cache?: boolean;
  category: { id: string; path: string; confidence: number; reasoning: string } | null;
  echivalente: EquivalentResult[];
  message?: string;
  error?: string;
};

function calcLine(item: Partial<OfertaItem>) {
  const pret = item.pret_unitar ?? 0;
  const disc = item.discount_percent ?? 0;
  const qty = item.quantity ?? 1;
  const pret_final = pret * (1 - disc / 100);
  return { pret_final, subtotal: pret_final * qty };
}

function tokenize(text: string): string[] {
  return text
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 || /^\d+$/.test(t));
}

function scoreToken(target: string, token: string): number {
  if (/^\d+$/.test(token)) {
    // Numerele trebuie să fie izolate — "5" nu trebuie să potrivească "15" sau "50"
    return new RegExp(`(?<![0-9])${token}(?![0-9])`).test(target)
      ? token.length * 4
      : 0;
  }
  return target.includes(token) ? token.length : 0;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
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
  const debouncedCerere = useDebounce(cerereText, 380);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());

  const [pickerOpen, setPickerOpen] = useState(false);
  const [items, setItems] = useState<OfertaItem[]>([]);
  const [aiInfo, setAiInfo] = useState<Record<string, AiProductInfo>>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [altMatches, setAltMatches] = useState<Record<string, { cod_intern: string; denumire_completa: string } | null>>({});

  const [equivalentLoading, setEquivalentLoading] = useState(false);
  const [equivalentResults, setEquivalentResults] = useState<EquivalentSearchResponse | null>(null);

  // Reset equivalent results when user changes the search text
  useEffect(() => {
    setEquivalentResults(null);
  }, [cerereText]);

  // ── Live catalog search ──────────────────────────────────────────────────
  const tokens = useMemo(() => tokenize(debouncedCerere), [debouncedCerere]);

  // Phrase variants help with code-like searches: "AF E" → also search "af-e", "afe"
  const phraseVariants = useMemo(() => {
    const norm = debouncedCerere.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    return [...new Set([norm, norm.replace(/\s+/g, "-"), norm.replace(/[\s-]+/g, "")])]
      .filter((p) => p.length >= 2);
  }, [debouncedCerere]);

  const { data: rawSuggestions = [], isFetching: suggestLoading } = useQuery({
    queryKey: ["smart-catalog-suggest", tokens.join("|"), phraseVariants.join("|")],
    queryFn: async (): Promise<SuggestedProduct[]> => {
      if (tokens.length === 0 && phraseVariants.length === 0) return [];
      // OR logic — broad match (tokens) + phrase variants for code-suffix searches like "AF E"→"af-e"
      const tokenParts = tokens.map((t) => `denumire_completa.ilike.%${t}%,cod_intern.ilike.%${t}%`);
      const phraseParts = phraseVariants.map((p) => `denumire_completa.ilike.%${p}%,cod_intern.ilike.%${p}%`);
      const orFilter = [...tokenParts, ...phraseParts].join(",");
      const { data, error } = await supabase
        .from("products")
        .select("id, cod_intern, denumire_completa, pret_lista, unit, category_id")
        .or(orFilter)
        .limit(80);
      if (error) return [];

      return (data ?? [])
        .map((p) => {
          const target = `${p.denumire_completa} ${p.cod_intern ?? ""}`
            .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
          const tokenScore = tokens.reduce((s, t) => s + scoreToken(target, t), 0);
          // Phrase match bonus: "af-e" match scores much higher than just "af"
          const phraseBonus = phraseVariants.reduce(
            (best, phrase) => (target.includes(phrase) ? Math.max(best, phrase.length * 3) : best),
            0
          );
          return { ...p, score: tokenScore + phraseBonus } as SuggestedProduct;
        })
        .filter((p) => p.score > 0)
        .sort((a, b) => b.score - a.score);
    },
    enabled: tokens.length > 0 || phraseVariants.length > 0,
  });

  // Top 8 shown inline; total count for "caută mai mult" hint
  const suggestedProducts = rawSuggestions.slice(0, 8);
  const totalFound = rawSuggestions.length;

  const toggleSuggestion = (id: string) =>
    setSelectedSuggestions((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const addSuggestedToOffer = () => {
    if (!cerereText.trim()) {
      toast.warning("Completați ce a cerut clientul");
      return;
    }
    const toAdd = suggestedProducts.filter((p) => selectedSuggestions.has(p.id));
    if (toAdd.length === 0) return;
    handlePickerConfirm(toAdd);
    setSelectedSuggestions(new Set());
  };

  // ── AI helpers ───────────────────────────────────────────────────────────
  const lookupAlternatives = useCallback(async (alternatives: string[]) => {
    const unique = [...new Set(alternatives)].filter((a) => a.trim().length > 1);
    if (unique.length === 0) return;
    const results: Record<string, { cod_intern: string; denumire_completa: string } | null> = {};
    await Promise.all(
      unique.map(async (alt) => {
        const toks = tokenize(alt).slice(0, 4);
        if (toks.length === 0) { results[alt] = null; return; }
        let q = supabase.from("products").select("cod_intern, denumire_completa").limit(1);
        for (const t of toks) q = q.ilike("denumire_completa", `%${t}%`);
        const { data } = await q;
        results[alt] = data?.[0] ?? null;
      })
    );
    setAltMatches((prev) => ({ ...prev, ...results }));
  }, []);

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
        const cachedCount = (data.cached_ids as string[] || []).length;
        const freshCount = (data.fresh_ids as string[] || []).length;
        if (freshCount > 0 && cachedCount > 0) {
          toast.success(`Date AI: ${freshCount} noi, ${cachedCount} din cache`);
        } else if (cachedCount > 0) {
          toast.info(`Date tehnice încărcate din cache (${cachedCount} produse)`);
        } else {
          toast.success("Date tehnice AI primite");
        }
        const allAlts: string[] = Object.values(data.data as Record<string, AiProductInfo>)
          .flatMap((info) => info.alternative ?? []);
        void lookupAlternatives(allAlts);
      }
    } catch (e) {
      console.error("AI info error:", e);
      toast.error("Eroare la obținerea datelor tehnice AI");
    } finally {
      setAiLoading(false);
    }
  }, [lookupAlternatives]);

  const fetchEquivalents = useCallback(async () => {
    const cerere = cerereText.trim();
    if (!cerere || cerere.length < 3) return;
    setEquivalentLoading(true);
    setEquivalentResults(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-product-info", {
        body: { action: "find-equivalent", cerere_client: cerere },
      });
      if (error) throw error;
      setEquivalentResults(data as EquivalentSearchResponse);
      if (data?.echivalente?.length === 0) {
        toast.info("Nu am găsit echivalente în catalogul MaxBau pentru acest produs");
      }
    } catch (e) {
      console.error("Equivalent search error:", e);
      toast.error("Eroare la căutarea echivalentului AI");
    } finally {
      setEquivalentLoading(false);
    }
  }, [cerereText]);

  const addEquivalentToOffer = useCallback((equiv: EquivalentResult) => {
    if (items.some((i) => i.product_id === equiv.product_id)) {
      toast.info("Produsul este deja în ofertă");
      return;
    }
    const base: OfertaItem = {
      tempId: crypto.randomUUID(),
      cerere_initiala: cerereText.trim() || equiv.denumire_completa,
      product_id: equiv.product_id,
      cod_intern: equiv.cod_intern,
      denumire: equiv.denumire_completa,
      quantity: 1,
      unit: equiv.unit || "buc",
      pret_unitar: Number(equiv.pret_lista),
      discount_percent: 0,
      pret_final: 0,
      subtotal: 0,
    };
    setItems((prev) => [...prev, { ...base, ...calcLine(base) }]);
    toast.success("Produs echivalent adăugat în ofertă");
  }, [cerereText, items]);

  // ── Offer management ─────────────────────────────────────────────────────
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

      if (nou.length === 0) { toast.info("Produsele selectate sunt deja în ofertă"); return; }
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

  const groups = useMemo(() => {
    const map = new Map<string, OfertaItem[]>();
    for (const item of items) {
      const key = item.cerere_initiala || "—";
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
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
    if (items.length === 0) { toast.error("Adăugați produse înainte de export"); return; }
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-5xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Ofertă din cerere client</h1>
          <p className="text-sm text-muted-foreground">
            Notați ce a cerut clientul — catalogul MaxBau se caută automat în timp real
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

        {/* Căutare live în catalog */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <PackageSearch className="h-4 w-4" />
              Ce a cerut clientul
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">
                Brand, denumire generică, caracteristici — exact cum a spus
              </Label>
              <Input
                value={cerereText}
                onChange={(e) => { setCerereText(e.target.value); setSelectedSuggestions(new Set()); }}
                placeholder='Ex: "Mapei Keraflex S2 25kg" sau "adeziv flexibil C2T pentru exterior"'
                className="mt-1"
              />
            </div>

            {/* Rezultate live */}
            {tokens.length > 0 && (
              <div className="rounded-lg border border-border/60 overflow-hidden">
                {/* Header rezultate */}
                <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border/40">
                  <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    {suggestLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <span className={`h-2 w-2 rounded-full ${totalFound === 0 ? "bg-amber-400" : "bg-green-500"}`} />
                    )}
                    {suggestLoading
                      ? "Caut în catalog MaxBau…"
                      : totalFound === 0
                      ? "Niciun produs găsit direct în catalog"
                      : totalFound > 8
                      ? `${totalFound} produse găsite — top 8 afișate`
                      : `${totalFound} produs${totalFound > 1 ? "e" : ""} găsit${totalFound > 1 ? "e" : ""} în catalog`}
                  </span>
                  <div className="flex items-center gap-2">
                    {!suggestLoading && totalFound === 0 && debouncedCerere.length >= 3 && (
                      <button
                        onClick={fetchEquivalents}
                        disabled={equivalentLoading}
                        className="text-xs text-primary hover:underline flex items-center gap-1 font-medium disabled:opacity-50"
                      >
                        {equivalentLoading ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Bot className="h-3 w-3" />
                        )}
                        {equivalentLoading ? "Caut echivalent…" : "Caută echivalent AI"}
                      </button>
                    )}
                    {totalFound > 8 && (
                      <button
                        onClick={() => setPickerOpen(true)}
                        className="text-xs text-primary hover:underline flex items-center gap-0.5"
                      >
                        Vezi toate <ChevronRight className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Lista produse */}
                {suggestedProducts.length > 0 && (
                  <div className="divide-y divide-border/30">
                    {suggestedProducts.map((p) => {
                      const alreadyIn = items.some((i) => i.product_id === p.id);
                      const checked = selectedSuggestions.has(p.id);
                      return (
                        <label
                          key={p.id}
                          className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors
                            ${alreadyIn ? "opacity-40 cursor-not-allowed bg-muted/20" : "hover:bg-accent/10"}
                            ${checked ? "bg-primary/5" : ""}`}
                        >
                          <Checkbox
                            checked={checked}
                            disabled={alreadyIn}
                            onCheckedChange={() => !alreadyIn && toggleSuggestion(p.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[10px] font-mono shrink-0 border-primary/30 text-primary">
                                {p.cod_intern}
                              </Badge>
                              <span className="text-sm truncate">{p.denumire_completa}</span>
                              {alreadyIn && (
                                <Badge variant="secondary" className="text-[10px] shrink-0">în ofertă</Badge>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-sm font-semibold text-primary">
                              {Number(p.pret_lista).toFixed(2)} lei
                            </span>
                            <span className="text-xs text-muted-foreground">/{p.unit || "buc"}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}

                {/* Footer acțiuni */}
                {suggestedProducts.length > 0 && (
                  <div className="flex items-center justify-between px-3 py-2 bg-muted/20 border-t border-border/40">
                    <span className="text-xs text-muted-foreground">
                      {selectedSuggestions.size > 0
                        ? `${selectedSuggestions.size} produs${selectedSuggestions.size > 1 ? "e selectate" : " selectat"}`
                        : "Bifați produsele potrivite"}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setPickerOpen(true)}
                        className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                      >
                        Browse catalog complet
                      </button>
                      <Button
                        size="sm"
                        disabled={selectedSuggestions.size === 0}
                        onClick={addSuggestedToOffer}
                        className="h-7 text-xs"
                      >
                        Adaugă la ofertă
                        {selectedSuggestions.size > 0 && ` (${selectedSuggestions.size})`}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Rezultate echivalente AI */}
            {equivalentResults && (
              <div className="rounded-lg border border-primary/30 overflow-hidden bg-primary/[0.02]">
                <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border-b border-primary/20">
                  <Bot className="h-3.5 w-3.5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-semibold text-primary">Echivalente AI</span>
                    {equivalentResults.category && (
                      <span className="text-xs text-muted-foreground ml-2">
                        Categorie identificată: <span className="font-medium text-foreground">{equivalentResults.category.path}</span>
                      </span>
                    )}
                    {equivalentResults.from_cache && (
                      <Badge variant="outline" className="ml-2 text-[10px] border-primary/30 text-primary h-4">din cache</Badge>
                    )}
                  </div>
                </div>

                {equivalentResults.echivalente.length === 0 && (
                  <div className="px-3 py-3 text-xs text-muted-foreground italic">
                    {equivalentResults.message || "Nu am găsit echivalente în catalog pentru această cerere."}
                  </div>
                )}

                {equivalentResults.echivalente.length > 0 && (
                  <div className="divide-y divide-border/30">
                    {equivalentResults.echivalente.map((equiv) => {
                      const alreadyIn = items.some((i) => i.product_id === equiv.product_id);
                      return (
                        <div key={equiv.product_id} className={`px-3 py-2.5 ${alreadyIn ? "opacity-50" : ""}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className="text-[10px] font-mono shrink-0 border-primary/30 text-primary">
                                  {equiv.cod_intern}
                                </Badge>
                                <span className="text-sm font-medium truncate">{equiv.denumire_completa}</span>
                                <span className="text-xs font-semibold text-primary shrink-0">
                                  {Number(equiv.pret_lista).toFixed(2)} lei/{equiv.unit || "buc"}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{equiv.justificare}</p>
                            </div>
                            <Button
                              size="sm"
                              variant={alreadyIn ? "secondary" : "outline"}
                              className="h-7 text-xs shrink-0 gap-1"
                              disabled={alreadyIn}
                              onClick={() => addEquivalentToOffer(equiv)}
                            >
                              {alreadyIn ? "În ofertă" : <><Plus className="h-3 w-3" /> Adaugă</>}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {tokens.length === 0 && (
              <p className="text-xs text-muted-foreground italic">
                Începeți să tastați — produsele din catalogul MaxBau apar automat
              </p>
            )}
          </CardContent>
        </Card>

        {/* Tabel ofertă */}
        {items.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Produse în ofertă ({items.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
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
                        <TableRow key={item.tempId} className={gi % 2 === 0 ? "bg-muted/20" : ""}>
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

              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-border/40">
                {Array.from(groups.entries()).map(([cerere, groupItems], gi) =>
                  groupItems.map((item, idx) => (
                    <div key={item.tempId} className={`p-3 space-y-2 ${gi % 2 === 0 ? "bg-muted/10" : ""}`}>
                      {idx === 0 && cerere !== "—" && (
                        <p className="text-xs text-muted-foreground italic line-clamp-2">
                          Cerere: {cerere}
                        </p>
                      )}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <Badge variant="outline" className="text-xs font-mono border-primary/30 text-primary mb-1">
                            {item.cod_intern}
                          </Badge>
                          <p className="text-sm line-clamp-2">{item.denumire}</p>
                        </div>
                        <Button variant="ghost" size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
                          onClick={() => removeItem(item.tempId)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Cant. ({item.unit})</p>
                          <Input type="number" min={0.01} step="any"
                            value={item.quantity}
                            onChange={(e) => updateItem(item.tempId, "quantity", parseFloat(e.target.value) || 0)}
                            className="h-8 text-right text-sm" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Preț/UM</p>
                          <Input type="number" min={0} step="any"
                            value={item.pret_unitar}
                            onChange={(e) => updateItem(item.tempId, "pret_unitar", parseFloat(e.target.value) || 0)}
                            className="h-8 text-right text-sm" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Disc.%</p>
                          <Input type="number" min={0} max={100} step="0.5"
                            value={item.discount_percent}
                            onChange={(e) => updateItem(item.tempId, "discount_percent", parseFloat(e.target.value) || 0)}
                            className="h-8 text-right text-sm" />
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-muted-foreground">
                          Preț final: <span className="font-medium text-foreground">{item.pret_final.toFixed(2)} lei</span>
                        </span>
                        <span className="text-sm font-bold text-primary">{item.subtotal.toFixed(2)} lei</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Date tehnice AI */}
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
                    const uniqueIds = [...new Set(items.map((i) => i.product_id))].slice(0, 5);
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
                  Apasă butonul pentru consum, ambalaj și alte detalii tehnice generate de AI
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
                            <span className="text-muted-foreground block mb-1.5">
                              Produse similare pe piață:
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {info.alternative.map((alt, i) => {
                                const match = altMatches[alt];
                                if (match) {
                                  return (
                                    <Link
                                      key={i}
                                      to={`/catalog?q=${encodeURIComponent(match.cod_intern)}`}
                                      title={match.denumire_completa}
                                      className="inline-flex items-center gap-1 rounded-full border border-green-400/50 bg-green-50 px-2.5 py-0.5 text-[11px] font-medium text-green-800 hover:bg-green-100 transition-colors"
                                    >
                                      <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                                      {alt}
                                      <span className="text-green-600/70 font-mono">{match.cod_intern}</span>
                                    </Link>
                                  );
                                }
                                return (
                                  <a
                                    key={i}
                                    href={`https://www.google.com/search?q=${encodeURIComponent(alt + " adeziv echivalent")}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
                                  >
                                    {alt}
                                    <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                                  </a>
                                );
                              })}
                            </div>
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

        {/* Totaluri */}
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
                  <span className="font-bold text-primary text-lg">{totals.gross.toFixed(2)} lei</span>
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
            <Button onClick={() => saveMutation.mutate("sent")} disabled={saveMutation.isPending}>
              <Send className="h-4 w-4 mr-1" /> Trimite oferta
            </Button>
          </div>
        )}
      </div>

      <MultiProductPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onConfirm={handlePickerConfirm}
        title={cerereText ? `Produse pentru: "${cerereText}"` : "Selectează produse"}
        initialSearch={cerereText}
      />
    </DashboardLayout>
  );
};

export default SmartQuote;
