import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchTechInfoWithAnthropic, findEquivalentWithAnthropic } from "@/utils/anthropic";
import { useAuth } from "@/hooks/useAuth";
import { DashboardLayout } from "@/components/DashboardLayout";
import { MultiProductPicker, type PickedProduct } from "@/components/MultiProductPicker";
import { EquivalentsDialog } from "@/components/EquivalentsDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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
  ExternalLink, PackageSearch, ChevronRight, Bot, Plus, ArrowLeftRight, BookOpen,
} from "lucide-react";
import { toast } from "sonner";
import { cn, TVA_RATE, TVA_PERCENT } from "@/lib/utils";
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
  is_cerere_speciala?: boolean;
  price_variant_id?: string | null;
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

const ROMANIAN_STOPWORDS = new Set([
  "cu", "la", "de", "din", "pe", "si", "pentru", "in", "o", "un", "sau",
  "al", "a", "ale", "cel", "cea", "cei", "cele"
]);

function tokenize(text: string): string[] {
  return text
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => (t.length >= 2 && !ROMANIAN_STOPWORDS.has(t)) || /^\d+$/.test(t));
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

function getProductSpecSummary(specifications: any) {
  const specs = specifications || {};
  const ftSpecs = specs.fisa_tehnica_specs || null;
  const aiInfo = specs.ai_info || null;
  
  const source = ftSpecs ? "verified" : (aiInfo ? "ai" : "none");
  
  let conductivitate = null;
  let clasa_foc = null;
  let consum = null;
  
  if (ftSpecs) {
    conductivitate = ftSpecs.conductivitate_termica || null;
    clasa_foc = ftSpecs.clasa_reactie_foc || null;
    consum = ftSpecs.consum || null;
  } else if (aiInfo) {
    conductivitate = aiInfo.conductivitate_termica || null;
    clasa_foc = aiInfo.clasa_reactie_foc || null;
    consum = aiInfo.consum || null;
  }
  
  return { source, conductivitate, clasa_foc, consum };
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
  const [searchType, setSearchType] = useState<"standard" | "semantic">("standard");

  const [pickerOpen, setPickerOpen] = useState(false);
  const [items, setItems] = useState<OfertaItem[]>([]);
  const [aiInfo, setAiInfo] = useState<Record<string, AiProductInfo>>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [altMatches, setAltMatches] = useState<Record<string, { cod_intern: string; denumire_completa: string } | null>>({});
  const fetchedIdsRef = useRef<Set<string>>(new Set());

  const [equivalentLoading, setEquivalentLoading] = useState(false);
  const [equivalentResults, setEquivalentResults] = useState<EquivalentSearchResponse | null>(null);

  const [equivalentsOpen, setEquivalentsOpen] = useState(false);
  const [itemForEquivalents, setItemForEquivalents] = useState<OfertaItem | null>(null);

  // Reset equivalent results when user changes the search text
  useEffect(() => {
    setEquivalentResults(null);
  }, [cerereText]);

  const productIdsInQuote = useMemo(
    () => Array.from(new Set(items.map((i) => i.product_id).filter(Boolean))) as string[],
    [items]
  );

  const quoteProductsJoined = productIdsInQuote.join("|");

  const lookupAlternatives = useCallback(async (alternatives: string[]) => {
    const unique = [...new Set(alternatives)].filter((a) => a.trim().length > 1);
    if (unique.length === 0) return;
    const results: Record<string, { cod_intern: string; denumire_completa: string } | null> = {};
    await Promise.all(
      unique.map(async (alt) => {
        const toks = tokenize(alt).slice(0, 4);
        if (toks.length === 0) { results[alt] = null; return; }
        let q = supabase.from("products").select("cod_intern, denumire_completa").limit(1);
        for (const t of toks) q = q.or(`denumire_completa.ilike.%${t}%,brand.ilike.%${t}%`);
        const { data } = await q;
        results[alt] = data?.[0] ?? null;
      })
    );
    setAltMatches((prev) => ({ ...prev, ...results }));
  }, []);

  // Incarca automat specificatiile tehnice salvate in DB pentru produsele din oferta, gratuit si instantaneu
  useEffect(() => {
    const ids = quoteProductsJoined.split("|").filter(Boolean);
    const missingIds = ids.filter((id) => !fetchedIdsRef.current.has(id));
    if (missingIds.length > 0) {
      // Mark as fetched immediately to prevent double-fetching while request is in progress
      missingIds.forEach((id) => fetchedIdsRef.current.add(id));
      
      const getCached = async () => {
        try {
          const res = await fetchTechInfoWithAnthropic(missingIds, "", true);
          if (res.success && res.data && Object.keys(res.data).length > 0) {
            setAiInfo((prev) => ({ ...prev, ...res.data }));
            const allAlts: string[] = Object.values(res.data as Record<string, AiProductInfo>)
              .flatMap((info) => (info && info.alternative) ?? []);
            void lookupAlternatives(allAlts);
          }
        } catch (e) {
          console.error("Eroare la preluarea automata a datelor tehnice din cache:", e);
        }
      };
      void getCached();
    }
  }, [quoteProductsJoined, lookupAlternatives]);

  const { data: listPrices = [] } = useQuery({
    queryKey: ["smart-quote-list-prices", productIdsInQuote.join("|")],
    enabled: productIdsInQuote.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, pret_lista, category_id, specifications")
        .in("id", productIdsInQuote);
      if (error) throw error;
      return data as { id: string; pret_lista: number; category_id: string | null; specifications: any }[];
    },
  });

  const productDetailsByProductId = useMemo(() => {
    const map = new Map<string, { category_id: string | null; specifications: any }>();
    listPrices.forEach((p) => map.set(p.id, { category_id: p.category_id, specifications: p.specifications }));
    return map;
  }, [listPrices]);

  const productForEquivalents = useMemo(() => {
    if (!itemForEquivalents || !itemForEquivalents.product_id) return null;
    const details = productDetailsByProductId.get(itemForEquivalents.product_id);
    return {
      id: itemForEquivalents.product_id,
      cod_intern: itemForEquivalents.cod_intern,
      denumire_completa: itemForEquivalents.denumire,
      category_id: details?.category_id || null,
    };
  }, [itemForEquivalents, productDetailsByProductId]);

  const handleReplaceItem = (newProduct: {
    id: string;
    cod_intern: string;
    denumire_completa: string;
    pret_lista: number;
    unit: string | null;
  }) => {
    if (!itemForEquivalents) return;
    
    setItems((prev) =>
      prev.map((item) => {
        if (item.tempId !== itemForEquivalents.tempId) return item;
        
        const updated = {
          ...item,
          product_id: newProduct.id,
          cod_intern: newProduct.cod_intern,
          denumire: newProduct.denumire_completa,
          unit: newProduct.unit || "buc",
          pret_unitar: newProduct.pret_lista,
          discount_percent: 0,
          price_variant_id: null,
        };
        const calced = calcLine(updated);
        return { ...updated, ...calced };
      })
    );
    setItemForEquivalents(null);
  };

  const { data: priceVariants = [] } = useQuery({
    queryKey: ["smart-quote-price-variants", productIdsInQuote.join("|")],
    enabled: productIdsInQuote.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_prices")
        .select("id, product_id, supplier_id, price_type, price, currency, suppliers(name)")
        .in("product_id", productIdsInQuote)
        .is("valid_to", null)
        .order("price", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // ── Live catalog search ──────────────────────────────────────────────────
  const tokens = useMemo(() => tokenize(debouncedCerere), [debouncedCerere]);

  // Phrase variants help with code-like searches: "AF E" → also search "af-e", "afe"
  const phraseVariants = useMemo(() => {
    const norm = debouncedCerere.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    return [...new Set([norm, norm.replace(/\s+/g, "-"), norm.replace(/[\s-]+/g, "")])]
      .filter((p) => p.length >= 2);
  }, [debouncedCerere]);

  const { data: rawSuggestions = [], isFetching: suggestLoading } = useQuery({
    queryKey: ["smart-catalog-suggest", tokens.join("|"), phraseVariants.join("|"), searchType, debouncedCerere],
    queryFn: async (): Promise<SuggestedProduct[]> => {
      if (!debouncedCerere.trim()) return [];

      if (searchType === "semantic") {
        const { data, error } = await supabase.functions.invoke("semantic-search", {
          body: { query: debouncedCerere, limit: 15, threshold: 0.35 }
        });
        if (error) throw error;
        
        return (data.results || []).map((r: any) => ({
          id: r.product_id,
          cod_intern: r.cod_intern,
          denumire_completa: r.denumire_completa,
          pret_lista: r.pret_lista || 0,
          unit: r.unit || "buc",
          specifications: r.specifications || null,
          score: Math.round((r.similarity || 0) * 100)
        }));
      } else {
        if (tokens.length === 0 && phraseVariants.length === 0) return [];
        // OR logic — broad match (tokens) + phrase variants for code-suffix searches like "AF E"→"af-e"
        const tokenParts = tokens.map((t) => `denumire_completa.ilike.%${t}%,cod_intern.ilike.%${t}%,brand.ilike.%${t}%,brand_slug.ilike.%${t}%`);
        const phraseParts = phraseVariants.map((p) => `denumire_completa.ilike.%${p}%,cod_intern.ilike.%${p}%,brand.ilike.%${p}%,brand_slug.ilike.%${p}%`);
        const orFilter = [...tokenParts, ...phraseParts].join(",");
        const { data, error } = await supabase
          .from("products")
          .select("id, cod_intern, denumire_completa, pret_lista, unit, category_id, specifications")
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
      }
    },
    enabled: debouncedCerere.trim().length > 0,
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
  const fetchAiInfo = useCallback(async (productIds: string[], clientRequest: string) => {
    if (productIds.length === 0) return;
    setAiLoading(true);
    try {
      const data = await fetchTechInfoWithAnthropic(productIds, clientRequest);
      
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
      const result = await findEquivalentWithAnthropic(cerere);
      
      if (!result?.success || !Array.isArray(result?.echivalente)) {
        toast.error("Eroare la căutarea echivalentului AI");
        return;
      }
      setEquivalentResults(result as any);
      if (result.echivalente.length === 0) {
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

  const addCerereSpeciala = useCallback(() => {
    const cerere = cerereText.trim();
    if (!cerere) return;
    if (items.some((i) => i.is_cerere_speciala && i.cerere_initiala === cerere)) {
      toast.info("Această cerere specială e deja în ofertă");
      return;
    }
    const base: OfertaItem = {
      tempId: crypto.randomUUID(),
      cerere_initiala: cerere,
      product_id: "",
      cod_intern: "—",
      denumire: cerere,
      quantity: 1,
      unit: "buc",
      pret_unitar: 0,
      discount_percent: 0,
      pret_final: 0,
      subtotal: 0,
      is_cerere_speciala: true,
    };
    setItems((prev) => [...prev, base]);
    setCerereText("");
    setEquivalentResults(null);
    toast.success("Cerere specială adăugată — va fi urmărită separat");
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
        product_id: i.product_id || null,
        cod_intern: i.is_cerere_speciala ? "CERERE" : i.cod_intern,
        denumire: i.denumire,
        quantity: i.quantity,
        unit: i.unit,
        pret_unitar: i.pret_unitar,
        discount_percent: i.discount_percent,
        pret_final: i.pret_final,
        subtotal: i.subtotal,
        cerere_initiala: i.cerere_initiala || null,
        nota_ai: i.is_cerere_speciala ? { cerere_speciala: true } : (aiInfo[i.product_id] ?? null),
      }));

      const { error: iErr } = await supabase.from("quote_items").insert(rows);
      if (iErr) throw iErr;

      // Cereri speciale → salvate și în cereri_clienti pentru urmărire
      const cereriSpeciale = items.filter((i) => i.is_cerere_speciala);
      if (cereriSpeciale.length > 0) {
        await (supabase as any).from("cereri_clienti").insert(
          cereriSpeciale.map((i) => ({
            user_id: user.id,
            descriere_client: i.cerere_initiala,
            cantitate: i.quantity,
            unitate: i.unit,
            quote_id: quote.id,
          }))
        );
      }

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
      <div className="space-y-4 w-full">
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
          <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base flex items-center gap-2">
              <PackageSearch className="h-4 w-4" />
              Ce a cerut clientul
            </CardTitle>
            <div className="flex border border-border rounded-md overflow-hidden bg-muted/40 shrink-0 h-7">
              <button
                type="button"
                onClick={() => { setSearchType("standard"); setSelectedSuggestions(new Set()); }}
                className={cn(
                  "px-3 text-xs font-medium transition-colors",
                  searchType === "standard"
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                )}
              >
                Căutare Catalog
              </button>
              <button
                type="button"
                onClick={() => { setSearchType("semantic"); setSelectedSuggestions(new Set()); }}
                className={cn(
                  "px-3 text-xs font-medium transition-colors flex items-center gap-1.5",
                  searchType === "semantic"
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                )}
              >
                <Sparkles className="h-3 w-3" />
                Căutare Tehnică / RAG
              </button>
            </div>
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
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className="text-[10px] font-mono shrink-0 border-primary/30 text-primary">
                                {p.cod_intern}
                              </Badge>
                              <span className="text-sm truncate font-medium">{p.denumire_completa}</span>
                              
                              {searchType === "semantic" && p.score !== undefined && (
                                <Badge variant="secondary" className="text-[9px] text-primary shrink-0 bg-primary/5 border-primary/20 h-4">
                                  {p.score}% potrivire
                                </Badge>
                              )}

                              {(() => {
                                const specs = p.specifications || {};
                                if (specs.fisa_tehnica_specs) {
                                  return (
                                    <Badge variant="outline" className="text-[9px] text-emerald-600 bg-emerald-50 border-emerald-200 shrink-0 h-4 px-1.5 flex items-center gap-0.5">
                                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                      Fișă Verificată
                                    </Badge>
                                  );
                                }
                                if (specs.ai_info) {
                                  return (
                                    <Badge variant="outline" className="text-[9px] text-amber-600 bg-amber-50 border-amber-200 shrink-0 h-4 px-1.5 flex items-center gap-0.5">
                                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                                      Date AI
                                    </Badge>
                                  );
                                }
                                return (
                                  <Badge variant="outline" className="text-[9px] text-gray-500 bg-gray-50 border-gray-200 shrink-0 h-4 px-1.5 flex items-center gap-0.5">
                                    <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
                                    Fără date
                                  </Badge>
                                );
                              })()}

                              {alreadyIn && (
                                <Badge variant="secondary" className="text-[10px] shrink-0 h-4">în ofertă</Badge>
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
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between px-3 py-2 bg-muted/20 border-t border-border/40 gap-2">
                  <span className="text-xs text-muted-foreground">
                    {suggestedProducts.length > 0
                      ? selectedSuggestions.size > 0
                        ? `${selectedSuggestions.size} produs${selectedSuggestions.size > 1 ? "e selectate" : " selectat"}`
                        : "Bifați produsele potrivite"
                      : "Produsul nu există în catalog?"}
                  </span>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    {debouncedCerere.length >= 3 && (
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
                    {suggestedProducts.length > 0 && (
                      <>
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
                      </>
                    )}
                  </div>
                </div>
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

                {(equivalentResults.echivalente?.length ?? 0) === 0 && (
                  <div className="px-3 py-3 space-y-2">
                    <p className="text-xs text-muted-foreground italic">
                      {equivalentResults.message || "Nu am găsit echivalente în catalogul MaxBau pentru această cerere."}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1.5 border-amber-400/60 text-amber-700 hover:bg-amber-50"
                      onClick={addCerereSpeciala}
                    >
                      <Plus className="h-3 w-3" />
                      Adaugă ca cerere specială
                    </Button>
                  </div>
                )}

                {(equivalentResults.echivalente?.length ?? 0) > 0 && (
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
                      <TableHead className="w-[160px]">Grile preț</TableHead>
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
                        <TableRow key={item.tempId} className={
                          item.is_cerere_speciala
                            ? "bg-amber-50/50 border-l-2 border-l-amber-400"
                            : gi % 2 === 0 ? "bg-muted/20" : ""
                        }>
                          <TableCell className="text-xs text-muted-foreground align-top pt-3">
                            {idx === 0 && cerere !== "—" ? (
                              <span className="italic line-clamp-3">{cerere}</span>
                            ) : idx === 0 ? (
                              <span className="text-muted-foreground/50">—</span>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {item.is_cerere_speciala ? (
                              <Badge className="text-[10px] bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100">
                                De procurat
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs font-mono border-primary/30 text-primary">
                                {item.cod_intern}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm max-w-[280px]">
                            <div className="flex flex-col gap-1">
                              <span className="font-medium leading-snug line-clamp-2">{item.denumire}</span>
                              {!item.is_cerere_speciala && item.product_id && (() => {
                                const details = productDetailsByProductId.get(item.product_id);
                                if (!details) return null;
                                const { source, conductivitate, clasa_foc, consum } = getProductSpecSummary(details.specifications);
                                return (
                                  <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
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
                                    {conductivitate && (
                                      <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded border" title="Conductivitate termică">
                                        λ: {conductivitate}
                                      </span>
                                    )}
                                    {clasa_foc && (
                                      <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded border" title="Clasă reacție la foc">
                                        Foc: {clasa_foc}
                                      </span>
                                    )}
                                    {consum && (
                                      <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded border" title="Consum specific">
                                        Consum: {consum}
                                      </span>
                                    )}
                                    {details.fisa_tehnica_url && (
                                      <a
                                        href={details.fisa_tehnica_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-[10px] text-emerald-600 hover:text-emerald-700 hover:underline font-semibold flex items-center gap-0.5 ml-2"
                                      >
                                        <BookOpen className="h-3 w-3" />
                                        FT
                                      </a>
                                    )}
                                    <Link 
                                      to={`/catalog/product/${item.product_id}`} 
                                      className="text-[10px] text-primary hover:underline font-semibold ml-auto"
                                      target="_blank"
                                    >
                                      Detalii →
                                    </Link>
                                  </div>
                                );
                              })()}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Input type="number" min={0.01} step="any"
                              value={item.quantity}
                              onChange={(e) => updateItem(item.tempId, "quantity", parseFloat(e.target.value) || 0)}
                              className="h-8 w-[65px] text-right text-sm" />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{item.unit}</TableCell>
                          <TableCell>
                            {item.is_cerere_speciala ? (
                              <span className="text-xs text-muted-foreground text-center block">—</span>
                            ) : (
                              (() => {
                                const variants = priceVariants.filter((v: any) => v.product_id === item.product_id);
                                if (variants.length === 0) {
                                  return <span className="text-xs text-muted-foreground text-center block">—</span>;
                                }
                                return (
                                  <Select 
                                    value={item.price_variant_id || ""} 
                                    onValueChange={(val) => {
                                      const variant = variants.find((v: any) => v.id === val);
                                      if (variant) {
                                        updateItem(item.tempId, "price_variant_id", val);
                                        updateItem(item.tempId, "pret_unitar", Number(variant.price));
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="h-8 text-[11px] w-[140px]">
                                      <SelectValue placeholder="Alege preț..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {variants.map((v: any) => (
                                        <SelectItem key={v.id} value={v.id} className="text-[11px]">
                                          {v.price_type}: {v.price} {v.currency} {v.min_quantity > 1 ? `(min. ${v.min_quantity})` : ""} {v.suppliers?.name ? `(${v.suppliers.name})` : ""}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                );
                              })()
                            )}
                          </TableCell>
                          <TableCell>
                            {item.is_cerere_speciala ? (
                              <span className="text-xs text-muted-foreground px-2">—</span>
                            ) : (
                              <Input type="number" min={0} step="any"
                                value={item.pret_unitar}
                                onChange={(e) => updateItem(item.tempId, "pret_unitar", parseFloat(e.target.value) || 0)}
                                className="h-8 w-[85px] text-right text-sm" />
                            )}
                          </TableCell>
                          <TableCell>
                            {item.is_cerere_speciala ? (
                              <span className="text-xs text-muted-foreground px-2">—</span>
                            ) : (
                              <Input type="number" min={0} max={100} step="0.5"
                                value={item.discount_percent}
                                onChange={(e) => updateItem(item.tempId, "discount_percent", parseFloat(e.target.value) || 0)}
                                className="h-8 w-[60px] text-right text-sm" />
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium">
                            {item.is_cerere_speciala ? "—" : item.pret_final.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right text-sm font-bold">
                            {item.is_cerere_speciala ? "—" : `${item.subtotal.toFixed(2)} lei`}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {!item.is_cerere_speciala && item.product_id && (() => {
                                const details = productDetailsByProductId.get(item.product_id);
                                const categoryId = details?.category_id || null;
                                if (!categoryId) return null;
                                return (
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-7 w-7 text-primary hover:text-primary-active hover:bg-primary/5"
                                    onClick={() => {
                                      setItemForEquivalents(item);
                                      setEquivalentsOpen(true);
                                    }}
                                    title="Schimbă cu un echivalent tehnic"
                                  >
                                    <ArrowLeftRight className="h-3.5 w-3.5" />
                                  </Button>
                                );
                              })()}
                              <Button variant="ghost" size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => removeItem(item.tempId)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
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
                            <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                              {item.is_cerere_speciala ? (
                                <Badge className="text-[10px] bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100">
                                  De procurat
                                </Badge>
                              ) : (
                                <>
                                  <Badge variant="outline" className="text-xs font-mono border-primary/30 text-primary">
                                    {item.cod_intern}
                                  </Badge>
                                  {item.product_id && (() => {
                                    const details = productDetailsByProductId.get(item.product_id);
                                    if (!details) return null;
                                    const { source } = getProductSpecSummary(details.specifications);
                                    return (
                                      <>
                                        {source === "verified" && (
                                          <Badge variant="outline" className="text-[9px] py-0 px-1 border-emerald-500/20 text-emerald-700 bg-emerald-50/50">
                                            🟢 Fișă
                                          </Badge>
                                        )}
                                        {source === "ai" && (
                                          <Badge variant="outline" className="text-[9px] py-0 px-1 border-amber-500/20 text-amber-700 bg-amber-50/50">
                                            🟡 AI
                                          </Badge>
                                        )}
                                        {source === "none" && (
                                          <Badge variant="outline" className="text-[9px] py-0 px-1 border-red-500/20 text-red-700 bg-red-50/50">
                                            🔴 Fără date
                                          </Badge>
                                        )}
                                      </>
                                    );
                                  })()}
                                </>
                              )}
                            </div>
                            <p className="text-sm font-medium leading-snug mb-1">{item.denumire}</p>
                            
                            {!item.is_cerere_speciala && item.product_id && (() => {
                              const details = productDetailsByProductId.get(item.product_id);
                              if (!details) return null;
                              const { conductivitate, clasa_foc, consum } = getProductSpecSummary(details.specifications);
                              if (!conductivitate && !clasa_foc && !consum) return null;
                              return (
                                <div className="flex flex-wrap gap-1 mb-2">
                                  {conductivitate && (
                                    <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded border">
                                      λ: {conductivitate}
                                    </span>
                                  )}
                                  {clasa_foc && (
                                    <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded border">
                                      Foc: {clasa_foc}
                                    </span>
                                  )}
                                  {consum && (
                                    <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded border">
                                      Consum: {consum}
                                    </span>
                                  )}
                                </div>
                              );
                            return null;
                          })()}
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
                        {Array.isArray(info.alternative) && info.alternative.length > 0 && (
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
          <div className="flex flex-col sm:flex-row gap-3 sm:justify-end pb-8">
            <Button variant="outline" onClick={handleExport} className="gap-2 w-full sm:w-auto">
              <Download className="h-4 w-4" /> Exportă Excel
            </Button>
            <Button variant="outline"
              onClick={() => saveMutation.mutate("draft")}
              disabled={saveMutation.isPending}
              className="w-full sm:w-auto">
              <Save className="h-4 w-4 mr-1" /> Salvează ciornă
            </Button>
            <Button onClick={() => saveMutation.mutate("sent")} disabled={saveMutation.isPending} className="w-full sm:w-auto">
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
      
      {/* Equivalents Dialog */}
      <EquivalentsDialog
        open={equivalentsOpen}
        onOpenChange={setEquivalentsOpen}
        product={productForEquivalents}
        onReplace={handleReplaceItem}
      />
    </DashboardLayout>
  );
};

export default SmartQuote;
