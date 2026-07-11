import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useNavigate, useParams, Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DashboardLayout } from "@/components/DashboardLayout";
import { MultiProductPicker, type PickedProduct } from "@/components/MultiProductPicker";
import { EquivalentsDialog } from "@/components/EquivalentsDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Trash2, Save, Send, Plus, Download, Calculator, ArrowLeftRight, BookOpen, Sparkles, Bot, Copy, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { TVA_PERCENT, TVA_RATE } from "@/lib/utils";
import { exportQuoteToExcel } from "@/lib/exportExcel";
import { fetchTechInfoWithAnthropic, findEquivalentWithAnthropic, parseClientRequestWithAI } from "@/utils/anthropic";

interface QuoteItem {
  tempId: string;
  product_id: string | null;
  cod_intern: string;
  denumire: string;
  quantity: number;
  unit: string;
  pret_lista?: number;
  pret_unitar: number;
  discount_percent: number;
  pret_final: number;
  subtotal: number;
  price_variant_id?: string | null;
  variant_name?: string;
  cerere_initiala?: string | null;
  nota_echivalenta?: string | null;
}

interface AiProductInfo {
  consum: string;
  ambalaj: string;
  alternative: string[];
  compatibilitati: string;
  utilizare: string;
  updated_at: string;
}

interface SuggestedProduct {
  id: string;
  cod_intern: string;
  denumire_completa: string;
  pret_lista: number;
  unit: string | null;
  category_id: string | null;
  score?: number;
  specifications?: any;
}

interface EquivalentResult {
  product_id: string;
  cod_intern: string;
  denumire_completa: string;
  pret_lista: number;
  unit: string;
  justificare: string;
  scor: number;
}

interface EquivalentSearchResponse {
  success: boolean;
  from_cache?: boolean;
  category: { id: string; path: string; confidence: number; reasoning: string } | null;
  echivalente: EquivalentResult[];
  message?: string;
  error?: string;
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

const Loader2 = ({ className }: { className?: string }) => (
  <div className={className}>
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
  </div>
);

function calcLine(item: Partial<QuoteItem>): Pick<QuoteItem, "pret_final" | "subtotal"> {
  const pret = item.pret_unitar ?? 0;
  const disc = item.discount_percent ?? 0;
  const qty = item.quantity ?? 1;
  const pret_final = pret * (1 - disc / 100);
  return { pret_final, subtotal: pret_final * qty };
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

type ProductForQuote = {
  id: string;
  cod_intern: string;
  denumire_completa: string;
  pret_lista: number;
  unit: string | null;
  category_id: string | null;
};

const NewQuote = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { id: editId } = useParams<{ id: string }>();
  const isEdit = Boolean(editId);
  const addCode = searchParams.get("add");

  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [projectDesc, setProjectDesc] = useState("");
  const [maxDiscountPercent, setMaxDiscountPercent] = useState("");
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [loaded, setLoaded] = useState(!isEdit);
  
  const [equivalentsOpen, setEquivalentsOpen] = useState(false);
  const [itemForEquivalents, setItemForEquivalents] = useState<QuoteItem | null>(null);

  // States for Multi-Variant
  const [activeVariant, setActiveVariant] = useState("Varianta Standard");
  const [variantList, setVariantList] = useState<string[]>(["Varianta Standard"]);

  // States for Smart Quote / AI
  const [cerereText, setCerereText] = useState("");
  const debouncedCerere = useDebounce(cerereText, 380);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [searchType, setSearchType] = useState<"standard" | "semantic">("standard");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [aiInfo, setAiInfo] = useState<Record<string, AiProductInfo>>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [altMatches, setAltMatches] = useState<Record<string, { cod_intern: string; denumire_completa: string } | null>>({});
  const fetchedIdsRef = useRef<Set<string>>(new Set());
  const [equivalentLoading, setEquivalentLoading] = useState(false);
  const [equivalentResults, setEquivalentResults] = useState<EquivalentSearchResponse | null>(null);

  useEffect(() => {
    setEquivalentResults(null);
  }, [cerereText]);

  // States for Quick Catalog Inline Search
  const [inlineSearch, setInlineSearch] = useState("");
  const debouncedInlineSearch = useDebounce(inlineSearch, 300);
  const [inlineSearchType, setInlineSearchType] = useState<"standard" | "semantic">("standard");

  // States for AI WhatsApp Parser
  const [parsedItems, setParsedItems] = useState<{ material: string; quantity: string }[] | null>(null);
  const [parseLoading, setParseLoading] = useState(false);
  const [selectedParsedIndex, setSelectedParsedIndex] = useState<number | null>(null);

  // States for Proposal 1: Save as Recipe
  const [saveAsRecipeOpen, setSaveAsRecipeOpen] = useState(false);
  const [recipeName, setRecipeName] = useState("");
  const [recipeCategory, setRecipeCategory] = useState("Tencuieli & Gleturi");
  const [customCategory, setCustomCategory] = useState("");
  const [referenceQuantity, setReferenceQuantity] = useState("100");
  const [referenceUnit, setReferenceUnit] = useState("m²");
  const [savingRecipe, setSavingRecipe] = useState(false);

  const handleSaveAsRecipe = async () => {
    if (!user) {
      toast.error("Nu sunteți autentificat");
      return;
    }
    const name = recipeName.trim();
    if (!name) {
      toast.error("Vă rugăm să introduceți un nume pentru rețetă");
      return;
    }
    const refQty = parseFloat(referenceQuantity);
    if (!refQty || refQty <= 0) {
      toast.error("Cantitatea de referință trebuie să fie mai mare decât 0");
      return;
    }

    const finalCategory = recipeCategory === "custom" ? customCategory.trim() : recipeCategory;
    if (!finalCategory) {
      toast.error("Vă rugăm să specificați o categorie");
      return;
    }

    setSavingRecipe(true);
    try {
      const materials = activeItems.map((item, idx) => {
        const nameTokens = item.denumire
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .split(/[^a-z0-9ăâîșț]+/g)
          .filter((t) => t.length >= 2);

        return {
          position: idx + 1,
          description: item.denumire,
          um: item.unit,
          consumption_per_m2: Number((item.quantity / refQty).toFixed(5)),
          keywords: Array.from(new Set(nameTokens)),
          cod_intern: item.cod_intern,
        };
      });

      const { error } = await supabase.from("retete_constructii").insert({
        id: crypto.randomUUID(),
        recipe_name: name,
        category: finalCategory,
        unit: referenceUnit,
        status: "active",
        materials: materials as any,
      });

      if (error) throw error;

      toast.success(`Rețeta „${name}” a fost creată cu succes și este disponibilă în modulul de rețete!`);
      setSaveAsRecipeOpen(false);
      setRecipeName("");
      setCustomCategory("");
      setRecipeCategory("Tencuieli & Gleturi");
      setReferenceQuantity("100");
    } catch (e: any) {
      toast.error(e instanceof Error ? e.message : "Eroare la crearea rețetei");
    } finally {
      setSavingRecipe(false);
    }
  };

  // Load existing quote for editing
  const { data: existingQuote } = useQuery({
    queryKey: ["quote-edit", editId],
    enabled: isEdit,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select("*")
        .eq("id", editId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: existingItems } = useQuery({
    queryKey: ["quote-items-edit", editId],
    enabled: isEdit,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_items")
        .select("*")
        .eq("quote_id", editId!);
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (isEdit && existingQuote && existingItems && !loaded) {
      setClientName(existingQuote.client_name || "");
      setClientPhone(existingQuote.client_phone || "");
      setClientEmail(existingQuote.client_email || "");
      setProjectDesc(existingQuote.project_description || "");
      setMaxDiscountPercent(
        existingQuote.max_discount_percent === null || existingQuote.max_discount_percent === undefined
          ? ""
          : String(existingQuote.max_discount_percent)
      );
      
      const loadedItems = existingItems.map((it) => ({
        tempId: crypto.randomUUID(),
        product_id: it.product_id,
        cod_intern: it.cod_intern,
        denumire: it.denumire,
        quantity: Number(it.quantity),
        unit: it.unit || "buc",
        pret_unitar: Number(it.pret_unitar),
        discount_percent: Number(it.discount_percent) || 0,
        pret_final: Number(it.pret_final),
        subtotal: Number(it.subtotal),
        variant_name: (it as any).variant_name || "Varianta Standard",
        cerere_initiala: (it as any).cerere_initiala || null,
        nota_echivalenta: (it as any).nota_echivalenta || null,
      }));
      setItems(loadedItems);

      const uniqueVariants = Array.from(
        new Set(loadedItems.map((it) => it.variant_name || "Varianta Standard"))
      );
      setVariantList(uniqueVariants.length > 0 ? uniqueVariants : ["Varianta Standard"]);
      setActiveVariant(uniqueVariants[0] || "Varianta Standard");

      setLoaded(true);
    }
  }, [isEdit, existingQuote, existingItems, loaded]);

  // Standard tokens & phrase variants for inline search
  const inlineTokens = useMemo(() => tokenize(debouncedInlineSearch), [debouncedInlineSearch]);
  const inlinePhraseVariants = useMemo(() => {
    const norm = debouncedInlineSearch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    return [...new Set([norm, norm.replace(/\s+/g, "-"), norm.replace(/[\s-]+/g, "")])]
      .filter((p) => p.length >= 2);
  }, [debouncedInlineSearch]);

  const { data: inlineResults = [], isFetching: inlineLoading } = useQuery({
    queryKey: ["inline-catalog-search", inlineTokens.join("|"), inlinePhraseVariants.join("|"), inlineSearchType, debouncedInlineSearch],
    queryFn: async (): Promise<SuggestedProduct[]> => {
      if (!debouncedInlineSearch.trim()) return [];

      if (inlineSearchType === "semantic") {
        const { data, error } = await supabase.functions.invoke("semantic-search", {
          body: { query: debouncedInlineSearch, limit: 10, threshold: 0.35 }
        });
        if (error) throw error;
        return (data.results || []).map((r: any) => ({
          id: r.product_id,
          cod_intern: r.cod_intern,
          denumire_completa: r.denumire_completa,
          pret_lista: r.pret_lista || 0,
          unit: r.unit || "buc",
          specifications: r.specifications || null,
          score: Math.round((r.similarity || 0) * 100),
          category_id: r.category_id || null,
        }));
      } else {
        if (inlineTokens.length === 0 && inlinePhraseVariants.length === 0) return [];
        const tokenParts = inlineTokens.map((t) => `denumire_completa.ilike.%${t}%,cod_intern.ilike.%${t}%,brand.ilike.%${t}%,brand_slug.ilike.%${t}%`);
        const phraseParts = inlinePhraseVariants.map((p) => `denumire_completa.ilike.%${p}%,cod_intern.ilike.%${p}%,brand.ilike.%${p}%,brand_slug.ilike.%${p}%`);
        const orFilter = [...tokenParts, ...phraseParts].join(",");
        const { data, error } = await supabase
          .from("products")
          .select("id, cod_intern, denumire_completa, pret_lista, unit, category_id, specifications")
          .or(orFilter)
          .limit(40);
        if (error) return [];

        return (data ?? [])
          .map((p) => {
            const target = `${p.denumire_completa} ${p.cod_intern ?? ""}`
              .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
            const tokenScore = inlineTokens.reduce((s, t) => s + scoreToken(target, t), 0);
            const phraseBonus = inlinePhraseVariants.reduce(
              (best, phrase) => (target.includes(phrase) ? Math.max(best, phrase.length * 3) : best),
              0
            );
            return { ...p, score: tokenScore + phraseBonus } as SuggestedProduct;
          })
          .filter((p) => p.score > 0)
          .sort((a, b) => b.score - a.score);
      }
    },
    enabled: debouncedInlineSearch.trim().length >= 2,
  });

  const productIdsInQuote = useMemo(
    () => Array.from(new Set(items.map((i) => i.product_id).filter(Boolean))) as string[],
    [items]
  );

  const { data: listPrices = [] } = useQuery({
    queryKey: ["quote-list-prices", productIdsInQuote.join("|")],
    enabled: productIdsInQuote.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, pret_lista, category_id, specifications, fisa_tehnica_url")
        .in("id", productIdsInQuote);
      if (error) throw error;
      return data as { id: string; pret_lista: number; category_id: string | null; specifications: any }[];
    },
  });

  const { data: priceVariants = [] } = useQuery({
    queryKey: ["quote-price-variants", productIdsInQuote.join("|")],
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

  const listPriceByProductId = useMemo(() => {
    const map = new Map<string, number>();
    listPrices.forEach((p) => map.set(p.id, Number(p.pret_lista)));
    return map;
  }, [listPrices]);

  const productDetailsByProductId = useMemo(() => {
    const map = new Map<string, { category_id: string | null; specifications: any; fisa_tehnica_url: string | null }>();
    listPrices.forEach((p) => map.set(p.id, { category_id: p.category_id, specifications: p.specifications, fisa_tehnica_url: (p as any).fisa_tehnica_url }));
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
        
        const categoryId = productForEquivalents?.category_id || null;
        const autoDisc = findBestDiscount(newProduct.id, categoryId, item.quantity);
        
        const updated = {
          ...item,
          product_id: newProduct.id,
          cod_intern: newProduct.cod_intern,
          denumire: newProduct.denumire_completa,
          unit: newProduct.unit || "buc",
          pret_lista: newProduct.pret_lista,
          pret_unitar: newProduct.pret_lista,
          discount_percent: autoDisc,
          price_variant_id: null,
        };
        const calced = calcLine(updated);
        return { ...updated, ...calced };
      })
    );
    setItemForEquivalents(null);
  };



  const { data: discountRules = [] } = useQuery({
    queryKey: ["discount-rules-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("discount_rules")
        .select("*")
        .eq("active", true);
      if (error) throw error;
      return data;
    },
  });

  const findBestDiscount = useCallback(
    (productId: string | null, categoryId: string | null, quantity: number) => {
      let bestDiscount = 0;
      discountRules.forEach((rule) => {
        let matches = false;
        if (rule.rule_type === "quantity") {
          const minQty = Number(rule.min_quantity) || 0;
          if (quantity >= minQty) {
            if (rule.product_id && rule.product_id === productId) matches = true;
            else if (rule.category_id && rule.category_id === categoryId) matches = true;
            else if (!rule.product_id && !rule.category_id) matches = true;
          }
        } else if (rule.rule_type === "promo") {
          if (rule.product_id && rule.product_id === productId) matches = true;
          else if (rule.category_id && rule.category_id === categoryId) matches = true;
          else if (!rule.product_id && !rule.category_id) matches = true;
        }
        if (matches) bestDiscount = Math.max(bestDiscount, Number(rule.discount_percent));
      });
      return bestDiscount;
    },
    [discountRules]
  );



  const updateItem = useCallback(
    (tempId: string, field: keyof QuoteItem, value: number | string | null) => {
      setItems((prev) =>
        prev.map((item) => {
          if (item.tempId !== tempId) return item;
          const updated = { ...item, [field]: value };
          if (field === "quantity") {
            const autoDisc = findBestDiscount(item.product_id, null, Number(value));
            if (autoDisc > updated.discount_percent) updated.discount_percent = autoDisc;
          }
          const calced = calcLine(updated);
          return { ...updated, ...calced };
        })
      );
    },
    [findBestDiscount]
  );

  const addProducts = useCallback(
    (products: PickedProduct[]) => {
      setItems((prev) => {
        const updated = [...prev];
        products.forEach((product) => {
          const existing = updated.find(
            (i) => i.product_id === product.id && (i.variant_name || "Varianta Standard") === activeVariant
          );
          if (existing) {
            existing.quantity += 1;
            const autoDisc = findBestDiscount(existing.product_id, null, existing.quantity);
            if (autoDisc > existing.discount_percent) existing.discount_percent = autoDisc;
            const calced = calcLine(existing);
            Object.assign(existing, calced);
          } else {
            const autoDiscount = findBestDiscount(product.id, product.category_id, 1);
            const base: QuoteItem = {
              tempId: crypto.randomUUID(),
              product_id: product.id,
              cod_intern: product.cod_intern,
              denumire: product.denumire_completa,
              quantity: 1,
              unit: product.unit || "buc",
              pret_lista: Number(product.pret_lista),
              pret_unitar: Number(product.pret_lista),
              discount_percent: autoDiscount,
              pret_final: 0,
              subtotal: 0,
              variant_name: activeVariant,
            };
            const calced = calcLine(base);
            updated.push({ ...base, ...calced });
          }
        });
        return updated;
      });
    },
    [activeVariant, findBestDiscount]
  );

  // Load initial product from query param ?add=CODE
  useEffect(() => {
    if (addCode && loaded) {
      const fetchAndAdd = async () => {
        const { data, error } = await supabase
          .from("products")
          .select("id, cod_intern, denumire_completa, pret_lista, unit, category_id")
          .eq("cod_intern", addCode)
          .single();
        if (data && !error) {
          addProducts([{
            id: data.id,
            cod_intern: data.cod_intern,
            denumire_completa: data.denumire_completa,
            pret_lista: Number(data.pret_lista),
            unit: data.unit,
            category_id: data.category_id,
          }]);
          toast.success(`Produsul ${data.denumire_completa} a fost adăugat în ofertă.`);
          // clear the search param
          navigate(window.location.pathname, { replace: true });
        }
      };
      fetchAndAdd();
    }
  }, [addCode, loaded, addProducts, navigate]);

  const removeItem = (tempId: string) => {
    setItems((prev) => prev.filter((i) => i.tempId !== tempId));
  };

  const activeItems = useMemo(() => {
    return items.filter((it) => (it.variant_name || "Varianta Standard") === activeVariant);
  }, [items, activeVariant]);

  const totals = useMemo(() => {
    const totalNet = activeItems.reduce((s, i) => s + i.subtotal, 0);
    const totalTva = totalNet * TVA_RATE;
    const totalGross = totalNet + totalTva;
    const totalList = activeItems.reduce((s, i) => {
      if (!i.product_id) return s;
      const list = i.pret_lista ?? listPriceByProductId.get(i.product_id) ?? 0;
      return s + list * i.quantity;
    }, 0);
    const overallDiscountPercent = totalList > 0 ? (1 - totalNet / totalList) * 100 : 0;
    return { totalNet, totalTva, totalGross, totalList, overallDiscountPercent };
  }, [activeItems, listPriceByProductId]);

  const handleAddVariant = () => {
    const name = prompt("Introduceți numele noii variante:");
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (variantList.includes(trimmed)) {
      toast.error("Această variantă există deja");
      return;
    }
    setVariantList((prev) => [...prev, trimmed]);
    setActiveVariant(trimmed);
  };

  const handleDeleteVariant = (variantToDelete: string) => {
    if (variantList.length <= 1) {
      toast.error("Trebuie să păstrați cel puțin o variantă");
      return;
    }
    if (confirm(`Sigur doriți să ștergeți varianta "${variantToDelete}" și toate produsele din ea?`)) {
      setItems((prev) => prev.filter((it) => (it.variant_name || "Varianta Standard") !== variantToDelete));
      const nextVariants = variantList.filter((v) => v !== variantToDelete);
      setVariantList(nextVariants);
      if (activeVariant === variantToDelete) {
        setActiveVariant(nextVariants[0]);
      }
      toast.success("Varianta a fost ștearsă");
    }
  };

  const handleDuplicateVariant = () => {
    const name = prompt("Introduceți numele pentru varianta duplicată:", `${activeVariant} (Copie)`);
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (variantList.includes(trimmed)) {
      toast.error("Această variantă există deja");
      return;
    }
    
    // Copy active items to new variant
    const activeItemsToCopy = items.filter((it) => (it.variant_name || "Varianta Standard") === activeVariant);
    const copiedItems = activeItemsToCopy.map((it) => ({
      ...it,
      tempId: crypto.randomUUID(),
      variant_name: trimmed,
    }));

    setItems((prev) => [...prev, ...copiedItems]);
    setVariantList((prev) => [...prev, trimmed]);
    setActiveVariant(trimmed);
    toast.success(`Varianta "${activeVariant}" a fost duplicată ca "${trimmed}"`);
  };

  // ── AI helpers & queries ──────────────────────────────────────────────────
  const tokens = useMemo(() => tokenize(debouncedCerere), [debouncedCerere]);

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
          score: Math.round((r.similarity || 0) * 100),
          category_id: r.category_id || null,
        }));
      } else {
        if (tokens.length === 0 && phraseVariants.length === 0) return [];
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
    
    setItems((prev) => {
      const updated = [...prev];
      toAdd.forEach((product) => {
        const existing = updated.find(
          (i) => i.product_id === product.id && (i.variant_name || "Varianta Standard") === activeVariant
        );
        if (existing) {
          existing.quantity += 1;
          const autoDisc = findBestDiscount(existing.product_id, null, existing.quantity);
          if (autoDisc > existing.discount_percent) existing.discount_percent = autoDisc;
          const calced = calcLine(existing);
          Object.assign(existing, calced);
        } else {
          const autoDiscount = findBestDiscount(product.id, product.category_id, 1);
          const base: QuoteItem = {
            tempId: crypto.randomUUID(),
            product_id: product.id,
            cod_intern: product.cod_intern,
            denumire: product.denumire_completa,
            quantity: 1,
            unit: product.unit || "buc",
            pret_lista: Number(product.pret_lista),
            pret_unitar: Number(product.pret_lista),
            discount_percent: autoDiscount,
            pret_final: 0,
            subtotal: 0,
            variant_name: activeVariant,
            cerere_initiala: cerereText.trim(),
          };
          const calced = calcLine(base);
          updated.push({ ...base, ...calced });
        }
      });
      return updated;
    });

    setSelectedSuggestions(new Set());
    toast.success(`${toAdd.length} produse adăugate în ${activeVariant}`);
  };

  const handleParseWhatsAppRequest = async () => {
    if (!cerereText.trim()) return;
    setParseLoading(true);
    setParsedItems(null);
    setSelectedParsedIndex(null);
    try {
      const results = await parseClientRequestWithAI(cerereText);
      setParsedItems(results);
      if (results.length > 0) {
        setSelectedParsedIndex(0);
        setInlineSearch(results[0].material);
      } else {
        toast.info("Nu s-au putut extrage materiale din acest text.");
      }
    } catch (e: any) {
      toast.error(e.message || "Eroare la procesarea textului cu AI");
    } finally {
      setParseLoading(false);
    }
  };

  const handleSelectParsedItem = (idx: number, material: string) => {
    setSelectedParsedIndex(idx);
    setInlineSearch(material);
  };

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
    setItems((prev) => {
      if (prev.some((i) => i.product_id === equiv.product_id && (i.variant_name || "Varianta Standard") === activeVariant)) {
        toast.info("Produsul este deja în această variantă");
        return prev;
      }
      const base: QuoteItem = {
        tempId: crypto.randomUUID(),
        cerere_initiala: cerereText.trim() || equiv.denumire_completa,
        product_id: equiv.product_id,
        cod_intern: equiv.cod_intern,
        denumire: equiv.denumire_completa,
        quantity: 1,
        unit: equiv.unit || "buc",
        pret_lista: Number(equiv.pret_lista),
        pret_unitar: Number(equiv.pret_lista),
        discount_percent: 0,
        pret_final: 0,
        subtotal: 0,
        variant_name: activeVariant,
        nota_echivalenta: equiv.justificare,
      };
      const calced = calcLine(base);
      return [...prev, { ...base, ...calced }];
    });
    toast.success(`Produsul echivalent a fost adăugat în ${activeVariant}`);
  }, [activeVariant, cerereText]);

  const saveMutation = useMutation({
    mutationFn: async (status: "draft" | "sent") => {
      if (!user) throw new Error("Nu sunteți autentificat");
      if (items.length === 0) throw new Error("Adăugați cel puțin un produs");

      const maxDiscNum = maxDiscountPercent.trim() === "" ? null : Number(maxDiscountPercent);
      if (maxDiscNum !== null && (!Number.isFinite(maxDiscNum) || maxDiscNum < 0 || maxDiscNum > 100)) {
        throw new Error("Discount maxim total invalid");
      }
      if (maxDiscNum !== null && totals.overallDiscountPercent > maxDiscNum + 1e-9) {
        throw new Error(
          `Discount total (${totals.overallDiscountPercent.toFixed(2)}%) depășește maximul (${maxDiscNum.toFixed(2)}%)`
        );
      }

      const quotePayload = {
        user_id: user.id,
        client_name: clientName || null,
        client_phone: clientPhone || null,
        client_email: clientEmail || null,
        project_description: projectDesc || null,
        status,
        total_net: totals.totalNet,
        total_tva: totals.totalTva,
        total_gross: totals.totalGross,
        max_discount_percent: maxDiscNum,
      };

      let quoteId: string;

      if (isEdit && editId) {
        const { error } = await supabase
          .from("quotes")
          .update(quotePayload)
          .eq("id", editId);
        if (error) throw error;
        quoteId = editId;

        // Delete old items, insert new
        const { error: delErr } = await supabase
          .from("quote_items")
          .delete()
          .eq("quote_id", editId);
        if (delErr) throw delErr;
      } else {
        const { data: quote, error: qError } = await supabase
          .from("quotes")
          .insert(quotePayload)
          .select("id")
          .single();
        if (qError) throw qError;
        quoteId = quote.id;
      }

      const quoteItems = items.map((item) => ({
        quote_id: quoteId,
        product_id: item.product_id,
        cod_intern: item.cod_intern,
        denumire: item.denumire,
        quantity: item.quantity,
        unit: item.unit,
        pret_unitar: item.pret_unitar,
        discount_percent: item.discount_percent,
        pret_final: item.pret_final,
        subtotal: item.subtotal,
        variant_name: item.variant_name || "Varianta Standard",
        cerere_initiala: item.cerere_initiala || null,
        nota_echivalenta: item.nota_echivalenta || null,
      }));

      const { error: iError } = await supabase.from("quote_items").insert(quoteItems);
      if (iError) throw iError;
      return quoteId;
    },
    onSuccess: (_, status) => {
      queryClient.invalidateQueries({ queryKey: ["my-quotes"] });
      toast.success(
        status === "draft" ? "Oferta a fost salvată ca ciornă" : "Oferta a fost trimisă"
      );
      navigate("/quotes");
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Eroare la salvare");
    },
  });

  return (
    <DashboardLayout>
      <div className="space-y-4 w-full">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {isEdit ? "Editare ofertă" : "Ofertă nouă"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Adaugă produse, configurează cantități și discounturi
          </p>
        </div>

        {/* Client info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Date client</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Nume client</Label>
                <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Nume / Firmă" />
              </div>
              <div>
                <Label className="text-xs">Telefon</Label>
                <Input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="07xx xxx xxx" />
              </div>
              <div>
                <Label className="text-xs">Email</Label>
                <Input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="email@client.ro" />
              </div>
            </div>
            <div className="mt-3">
              <Label className="text-xs">Descriere proiect</Label>
              <Textarea value={projectDesc} onChange={(e) => setProjectDesc(e.target.value)} placeholder="Ex: Construcție casă P+1, faza zidărie..." rows={2} />
            </div>
          </CardContent>
        </Card>

        {/* Cerere Client (AI) Input Panel - Acum mutat în layout-ul cu coloane paralele */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* COLOANA STÂNGA: INSTRUMENTE CĂUTARE & AI (col-span-5) */}
          <div className="lg:col-span-5 space-y-4">
            
            {/* Card A: Căutare Rapidă Catalog */}
            <Card className="border-primary/20 shadow-sm">
              <CardHeader className="pb-2 bg-primary/5/10">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5 text-primary">
                  🔍 Căutare Rapidă Catalog (Adăugare individuală)
                </CardTitle>
                <p className="text-[11px] text-muted-foreground">
                  Găsește produse în catalog și adaugă-le instant în oferta curentă.
                </p>
              </CardHeader>
              <CardContent className="space-y-3 pt-3">
                {/* Search Bar Input */}
                <div className="space-y-2">
                  <div className="relative">
                    <Input
                      value={inlineSearch}
                      onChange={(e) => setInlineSearch(e.target.value)}
                      placeholder="Introdu cod sau denumire (ex: vata, 10500...)"
                      className="pr-8 h-9 text-sm"
                    />
                    {inlineSearch && (
                      <button
                        onClick={() => setInlineSearch("")}
                        className="absolute right-2.5 top-2.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        ×
                      </button>
                    )}
                  </div>

                  {/* Mode Toggles */}
                  <div className="flex border border-border rounded-md overflow-hidden w-fit">
                    <button
                      type="button"
                      onClick={() => setInlineSearchType("standard")}
                      className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${inlineSearchType === "standard" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}
                    >
                      Căutare simplă (Cuvinte)
                    </button>
                    <button
                      type="button"
                      onClick={() => setInlineSearchType("semantic")}
                      className={`px-2.5 py-1 text-[10px] font-medium transition-colors flex items-center gap-0.5 ${inlineSearchType === "semantic" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}
                    >
                      <Sparkles className="h-2.5 w-2.5" /> Inteligentă (Concept AI)
                    </button>
                  </div>
                </div>

                {/* Inline Results List */}
                {inlineSearch.trim().length >= 2 && (
                  <div className="border border-border/60 rounded-lg overflow-hidden divide-y divide-border/30 bg-background max-h-[280px] overflow-y-auto">
                    {inlineLoading ? (
                      <div className="p-4 text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        <span>Căutăm în catalog...</span>
                      </div>
                    ) : inlineResults.length === 0 ? (
                      <div className="p-4 text-center text-xs text-muted-foreground">
                        Niciun produs găsit. Reîncercați cu alte cuvinte.
                      </div>
                    ) : (
                      inlineResults.map((p) => {
                        const inOfferCount = activeItems.filter((i) => i.product_id === p.id).reduce((sum, i) => sum + i.quantity, 0);
                        return (
                          <div
                            key={p.id}
                            className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-accent/5 transition-colors"
                          >
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <Badge variant="outline" className="text-[9px] font-mono shrink-0 border-primary/20 text-primary py-0">
                                  {p.cod_intern}
                                </Badge>
                                {p.score !== undefined && inlineSearchType === "semantic" && (
                                  <Badge variant="secondary" className="text-[8px] text-primary shrink-0 bg-primary/5 border-primary/20 h-4 py-0">
                                    {p.score}% potrivire
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs truncate font-medium text-foreground" title={p.denumire_completa}>
                                {p.denumire_completa}
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                Preț listă: <span className="font-semibold text-primary">{Number(p.pret_lista).toFixed(2)} lei</span>/{p.unit || "buc"}
                              </p>
                            </div>
                            <div className="shrink-0 flex items-center gap-1.5">
                              {inOfferCount > 0 && (
                                <Badge variant="secondary" className="text-[9px] bg-primary/10 text-primary font-bold">
                                  {inOfferCount} {p.unit || "buc"}
                                </Badge>
                              )}
                              <Button
                                size="icon"
                                className="h-7 w-7 rounded-full"
                                onClick={() => {
                                  addProducts([{
                                    id: p.id,
                                    cod_intern: p.cod_intern,
                                    denumire_completa: p.denumire_completa,
                                    pret_lista: Number(p.pret_lista),
                                    unit: p.unit,
                                    category_id: p.category_id,
                                  }]);
                                  toast.success(`Adăugat: ${p.denumire_completa}`);
                                }}
                                type="button"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Card B: Căutare Multiprodus (AI WhatsApp Parser) */}
            <Card className="border-primary/20 bg-primary/5/5 shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <CardTitle className="text-sm font-semibold text-foreground">
                    📝 Căutare Multiprodus (AI WhatsApp / Cerere brută)
                  </CardTitle>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Lipește mesajul brut de la client (WhatsApp/e-mail) pentru a sparge automat cererea în produse individuale.
                </p>
              </CardHeader>
              <CardContent className="space-y-3 pt-2">
                <Textarea 
                  value={cerereText} 
                  onChange={(e) => setCerereText(e.target.value)} 
                  placeholder="Ex: buna ziua, am nevoie de:&#10;400 mp vata minerala de 10&#10;dibluri speciale&#10;15 saci adeziv vata" 
                  rows={4} 
                  className="text-xs"
                />
                
                <div className="flex justify-between items-center gap-2">
                  <div className="text-[10px] text-muted-foreground italic">
                    AI va extrage fiecare linie de material în parte.
                  </div>
                  <Button
                    size="sm"
                    onClick={handleParseWhatsAppRequest}
                    disabled={parseLoading || !cerereText.trim()}
                    className="h-8 text-xs font-semibold"
                    type="button"
                  >
                    {parseLoading ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        Se extrage...
                      </>
                    ) : (
                      <>
                        <Bot className="h-3.5 w-3.5 mr-1" />
                        Extrage materiale cu AI
                      </>
                    )}
                  </Button>
                </div>

                {/* Parsed Items Interactive List */}
                {parsedItems && parsedItems.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-border/40 animate-in slide-in-from-top-1 duration-200">
                    <p className="text-xs font-bold text-foreground flex items-center gap-1">
                      <span>📌 Materiale extrase din text (Dă click pe un rând pentru a-l căuta):</span>
                    </p>
                    <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto pr-1">
                      {parsedItems.map((item, idx) => {
                        const isSelected = selectedParsedIndex === idx;
                        return (
                          <button
                            key={idx}
                            onClick={() => handleSelectParsedItem(idx, item.material)}
                            type="button"
                            className={`flex items-center justify-between text-left p-2 rounded-md border text-xs transition-colors w-full ${isSelected ? "border-primary bg-primary/5 font-semibold text-primary" : "border-border/60 hover:bg-muted/30"}`}
                          >
                            <div className="min-w-0 flex-1 truncate">
                              {idx + 1}. {item.material}
                            </div>
                            <Badge variant="outline" className={`text-[9px] shrink-0 font-medium ${isSelected ? "border-primary/30 bg-primary/10 text-primary" : "bg-muted"}`}>
                              Cantitate: {item.quantity}
                            </Badge>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

          </div>

          {/* COLOANA DREAPTĂ: Ofertă Activă - Tabel Produse (col-span-7) */}
          <div className="lg:col-span-7 space-y-4">
            
            {/* Card C: Produse în Ofertă */}
            <Card className="shadow-sm">
              <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-1.5">
                    📋 Produse în Ofertă
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Lista curentă a materialelor din varianta selectată.
                  </p>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {/* Variant Manager Tab-uri */}
                <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-4 bg-muted/10 shrink-0">
                  {variantList.map((variant) => (
                    <div key={variant} className="flex items-center gap-1 bg-background border rounded-lg px-2 py-1 shadow-sm">
                      <button
                        onClick={() => setActiveVariant(variant)}
                        className={`text-xs font-semibold transition-colors ${activeVariant === variant ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                        type="button"
                      >
                        {variant}
                      </button>
                      {variantList.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-destructive hover:bg-destructive/10 hover:text-destructive rounded ml-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteVariant(variant);
                          }}
                          type="button"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <div className="flex gap-1.5 ml-auto">
                    <Button variant="outline" size="sm" onClick={handleAddVariant} type="button" className="h-8 text-xs gap-1">
                      <Plus className="h-3.5 w-3.5" /> Variantă nouă
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleDuplicateVariant} type="button" className="h-8 text-xs gap-1">
                      <Copy className="h-3.5 w-3.5" /> Duplică curentă
                    </Button>
                  </div>
                </div>

                {activeItems.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground text-sm flex flex-col items-center gap-2">
                    <Plus className="h-8 w-8 text-muted-foreground/30 animate-pulse" />
                    <span>Niciun produs în „{activeVariant}”.</span>
                    <p className="text-xs text-muted-foreground max-w-xs">
                      Căutați produse în catalog sau extrageți-le cu AI folosind casetele din stânga.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Desktop table */}
                    <div className="hidden md:block overflow-x-auto">
                    <Table className="min-w-[700px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[80px]">Cod</TableHead>
                          <TableHead>Denumire</TableHead>
                          <TableHead className="w-[70px] text-right">Cant.</TableHead>
                          <TableHead className="w-[50px]">UM</TableHead>
                          <TableHead className="w-[120px]">Grile preț</TableHead>
                          <TableHead className="w-[80px] text-right">Preț/UM</TableHead>
                          <TableHead className="w-[70px] text-right">Disc.%</TableHead>
                          <TableHead className="w-[90px] text-right">Preț final</TableHead>
                          <TableHead className="w-[90px] text-right">Subtotal</TableHead>
                          <TableHead className="w-[40px]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {activeItems.map((item) => (
                          <TableRow key={item.tempId}>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary">
                                {item.cod_intern}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs max-w-[200px]">
                              <div className="flex flex-col gap-0.5">
                                <span className="font-medium leading-snug line-clamp-2">{item.denumire}</span>
                                {item.product_id && (() => {
                                  const details = productDetailsByProductId.get(item.product_id);
                                  if (!details) return null;
                                  const { source, conductivitate, clasa_foc, consum } = getProductSpecSummary(details.specifications);
                                  return (
                                    <div className="flex flex-wrap items-center gap-1 mt-0.5">
                                      {source === "verified" && (
                                        <Badge variant="outline" className="text-[8px] py-0 px-1 border-emerald-500/20 text-emerald-700 bg-emerald-50/50">
                                          🟢 Fișă
                                        </Badge>
                                      )}
                                      {source === "ai" && (
                                        <Badge variant="outline" className="text-[8px] py-0 px-1 border-amber-500/20 text-amber-700 bg-amber-50/50">
                                          🟡 AI
                                        </Badge>
                                      )}
                                      {conductivitate && (
                                        <span className="text-[9px] text-muted-foreground bg-muted px-0.5 rounded border">
                                          λ: {conductivitate}
                                        </span>
                                      )}
                                      {details.fisa_tehnica_url && (
                                        <a
                                          href={details.fisa_tehnica_url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-[9px] text-emerald-600 hover:text-emerald-700 hover:underline font-semibold flex items-center gap-0.5 ml-1"
                                        >
                                          FT
                                        </a>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Input type="number" min={0.01} step="any" value={item.quantity}
                                onChange={(e) => updateItem(item.tempId, "quantity", parseFloat(e.target.value) || 0)}
                                className="h-8 w-[60px] text-right text-xs" />
                            </TableCell>
                            <TableCell className="text-[11px] text-muted-foreground">{item.unit}</TableCell>
                            <TableCell>
                              {(() => {
                                const variants = priceVariants.filter((v: any) => v.product_id === item.product_id);
                                if (variants.length === 0) {
                                  return <span className="text-[11px] text-muted-foreground block text-center">—</span>;
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
                                    <SelectTrigger className="h-8 text-[10px] w-[110px]">
                                      <SelectValue placeholder="Preț..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {variants.map((v: any) => (
                                        <SelectItem key={v.id} value={v.id} className="text-[10px]">
                                          {v.price_type}: {v.price} {v.currency} {v.min_quantity > 1 ? `(min. ${v.min_quantity})` : ""} {v.suppliers?.name ? `(${v.suppliers.name})` : ""}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                );
                              })()}
                            </TableCell>
                            <TableCell>
                              <Input type="number" min={0} step="any" value={item.pret_unitar}
                                onChange={(e) => updateItem(item.tempId, "pret_unitar", parseFloat(e.target.value) || 0)}
                                className="h-8 w-[75px] text-right text-xs" />
                            </TableCell>
                            <TableCell>
                              <Input type="number" min={0} max={100} step="0.5" value={item.discount_percent}
                                onChange={(e) => updateItem(item.tempId, "discount_percent", parseFloat(e.target.value) || 0)}
                                className="h-8 w-[55px] text-right text-xs" />
                            </TableCell>
                            <TableCell className="text-right text-xs font-medium">{item.pret_final.toFixed(2)}</TableCell>
                            <TableCell className="text-right text-xs font-bold">{item.subtotal.toFixed(2)}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                {item.product_id && (() => {
                                  const details = productDetailsByProductId.get(item.product_id);
                                  const categoryId = details?.category_id || null;
                                  if (!categoryId) return null;
                                  return (
                                    <Button 
                                      variant="ghost" 
                                      size="icon" 
                                      className="h-6 w-6 text-primary hover:bg-primary/5"
                                      onClick={() => {
                                        setItemForEquivalents(item);
                                        setEquivalentsOpen(true);
                                      }}
                                      title="Schimbă cu un echivalent tehnic"
                                    >
                                      <ArrowLeftRight className="h-3 w-3" />
                                    </Button>
                                  );
                                })()}
                                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive"
                                  onClick={() => removeItem(item.tempId)}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    </div>

                    {/* Mobile cards */}
                    <div className="md:hidden divide-y divide-border/40">
                      {activeItems.map((item) => (
                        <div key={item.tempId} className="p-3 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1 mb-1">
                                <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary">
                                  {item.cod_intern}
                                </Badge>
                              </div>
                              <p className="text-xs font-medium leading-snug mb-1">{item.denumire}</p>
                              
                              {(() => {
                                const variants = priceVariants.filter((v: any) => v.product_id === item.product_id);
                                if (variants.length > 0) {
                                  return (
                                    <div className="mt-2">
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
                                        <SelectTrigger className="h-7 text-xs w-full bg-muted/50">
                                          <SelectValue placeholder="Preț..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {variants.map((v: any) => (
                                            <SelectItem key={v.id} value={v.id} className="text-xs">
                                              {v.price_type}: {v.price} {v.currency}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {item.product_id && (() => {
                                const details = productDetailsByProductId.get(item.product_id);
                                const categoryId = details?.category_id || null;
                                  if (!categoryId) return null;
                                  return (
                                    <Button 
                                      variant="ghost" 
                                      size="icon" 
                                      className="h-7 w-7 text-primary hover:bg-primary/5"
                                      onClick={() => {
                                        setItemForEquivalents(item);
                                        setEquivalentsOpen(true);
                                      }}
                                      title="Echivalent tehnic"
                                    >
                                      <ArrowLeftRight className="h-3.5 w-3.5" />
                                    </Button>
                                  );
                              })()}
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                                onClick={() => removeItem(item.tempId)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <p className="text-[10px] text-muted-foreground mb-1">Cant. ({item.unit})</p>
                              <Input type="number" min={0.01} step="any" value={item.quantity}
                                onChange={(e) => updateItem(item.tempId, "quantity", parseFloat(e.target.value) || 0)}
                                className="h-8 text-right text-xs" />
                            </div>
                            <div>
                              <p className="text-[10px] text-muted-foreground mb-1">Preț/UM</p>
                              <Input type="number" min={0} step="any" value={item.pret_unitar}
                                onChange={(e) => updateItem(item.tempId, "pret_unitar", parseFloat(e.target.value) || 0)}
                                className="h-8 text-right text-xs" />
                            </div>
                            <div>
                              <p className="text-[10px] text-muted-foreground mb-1">Disc.%</p>
                              <Input type="number" min={0} max={100} step="0.5" value={item.discount_percent}
                                onChange={(e) => updateItem(item.tempId, "discount_percent", parseFloat(e.target.value) || 0)}
                                className="h-8 text-right text-xs" />
                            </div>
                          </div>
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-muted-foreground">
                              Preț final: <span className="font-medium text-foreground">{item.pret_final.toFixed(2)} lei</span>
                            </span>
                            <span className="font-bold text-primary">{item.subtotal.toFixed(2)} lei</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Totals & Actions */}
            {activeItems.length > 0 && (
              <>
                {/* Totals */}
                <Card>
                  <CardContent className="pt-4">
                    <div className="mb-4 max-w-xs">
                      <Label className="text-xs">Discount maxim total (%)</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="0.5"
                        value={maxDiscountPercent}
                        onChange={(e) => setMaxDiscountPercent(e.target.value)}
                        className="h-8 text-xs mt-1"
                      />
                    </div>
                    <div className="flex flex-col items-end gap-1 text-xs">
                      <div className="flex justify-between w-full max-w-xs">
                        <span className="text-muted-foreground">Total listă:</span>
                        <span className="font-medium">{totals.totalList.toFixed(2)} lei</span>
                      </div>
                      <div className="flex justify-between w-full max-w-xs">
                        <span className="text-muted-foreground">Discount mediu:</span>
                        <span className="font-medium">{totals.overallDiscountPercent.toFixed(2)}%</span>
                      </div>
                      <div className="flex justify-between w-full max-w-xs">
                        <span className="text-muted-foreground">Total fără TVA:</span>
                        <span className="font-medium">{totals.totalNet.toFixed(2)} lei</span>
                      </div>
                      <div className="flex justify-between w-full max-w-xs">
                        <span className="text-muted-foreground">TVA ({TVA_PERCENT}%):</span>
                        <span className="font-medium">{totals.totalTva.toFixed(2)} lei</span>
                      </div>
                      <div className="flex justify-between w-full max-w-xs border-t pt-1 mt-1">
                        <span className="font-bold text-sm">Total cu TVA:</span>
                        <span className="font-bold text-primary text-base">{totals.totalGross.toFixed(2)} lei</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Actions */}
                <div className="flex flex-col sm:flex-row gap-3 sm:justify-end pb-8">
                  <Button
                    variant="outline"
                    className="w-full sm:w-auto gap-1 border-primary/30 text-primary hover:bg-primary/5 sm:mr-auto h-9 text-xs"
                    onClick={() => {
                      setRecipeName(clientName ? `Rețetă ${clientName}` : "");
                      setSaveAsRecipeOpen(true);
                    }}
                  >
                    <Calculator className="h-4 w-4" /> Salvează ca rețetă
                  </Button>
                  <Button
                    className="w-full sm:w-auto h-9 text-xs"
                    onClick={() => {
                      exportQuoteToExcel(
                        {
                          nr_oferta: editId ? editId.slice(0, 8).toUpperCase() : "CIORNĂ",
                          data: new Date().toLocaleDateString("ro-RO"),
                          client_name: clientName,
                          client_phone: clientPhone,
                          client_email: clientEmail,
                          project_description: projectDesc,
                          total_net: totals.totalNet,
                          total_tva: totals.totalTva,
                          total_gross: totals.totalGross,
                        },
                        items.map((item) => ({
                          cod_intern: item.cod_intern,
                          denumire: item.denumire,
                          quantity: item.quantity,
                          unit: item.unit,
                          pret_unitar: item.pret_unitar,
                          discount_percent: item.discount_percent,
                          pret_final: item.pret_final,
                          subtotal: item.subtotal,
                        }))
                      );
                      toast.success("Fișier Excel descărcat");
                    }}
                  >
                    <Download className="h-4 w-4 mr-1" /> Exportă Excel
                  </Button>
                  <Button variant="outline" onClick={() => saveMutation.mutate("draft")}
                    disabled={saveMutation.isPending}
                    className="w-full sm:w-auto h-9 text-xs">
                    <Save className="h-4 w-4 mr-1" /> Salvează ciornă
                  </Button>
                  <Button onClick={() => saveMutation.mutate("sent")}
                    disabled={saveMutation.isPending}
                    className="w-full sm:w-auto h-9 text-xs">
                    <Send className="h-4 w-4 mr-1" /> Trimite oferta
                  </Button>
                </div>
              </>
            )}

          </div>
        </div>

        {/* Dialog pentru Salvare ca Rețetă */}
        <Dialog open={saveAsRecipeOpen} onOpenChange={setSaveAsRecipeOpen}>
          <DialogContent className="max-w-md sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Salvează ca rețetă / șablon</DialogTitle>
              <DialogDescription>
                Convertește produsele din această ofertă într-o rețetă reutilizabilă pe bază de suprafață.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-3">
              <div>
                <Label htmlFor="recipe-name" className="text-xs font-semibold">Nume Rețetă / Șablon</Label>
                <Input
                  id="recipe-name"
                  value={recipeName}
                  onChange={(e) => setRecipeName(e.target.value)}
                  placeholder="Ex: Tencuială mecanizată MPI 25 + BetonPrimer"
                  className="mt-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="recipe-category" className="text-xs font-semibold">Categorie</Label>
                  <Select value={recipeCategory} onValueChange={setRecipeCategory}>
                    <SelectTrigger id="recipe-category" className="mt-1">
                      <SelectValue placeholder="Alege categorie" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Tencuieli & Gleturi">Tencuieli & Gleturi</SelectItem>
                      <SelectItem value="Termoizolații">Termoizolații</SelectItem>
                      <SelectItem value="Adezivi & Șape">Adezivi & Șape</SelectItem>
                      <SelectItem value="Gips-Carton">Gips-Carton</SelectItem>
                      <SelectItem value="Pardoseli">Pardoseli</SelectItem>
                      <SelectItem value="Altele">Altele</SelectItem>
                      <SelectItem value="custom" className="text-primary font-medium">✨ Categorie personalizată...</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="reference-unit" className="text-xs font-semibold">U.M. de Referință</Label>
                  <Select value={referenceUnit} onValueChange={setReferenceUnit}>
                    <SelectTrigger id="reference-unit" className="mt-1">
                      <SelectValue placeholder="Alege U.M." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="m²">m² (mp)</SelectItem>
                      <SelectItem value="ml">ml (metri liniari)</SelectItem>
                      <SelectItem value="buc">buc (bucăți)</SelectItem>
                      <SelectItem value="mc">mc (metri cubi)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {recipeCategory === "custom" && (
                <div className="animate-in slide-in-from-top-1 duration-200">
                  <Label htmlFor="custom-category" className="text-xs font-semibold text-primary">Nume Categorie Personalizată</Label>
                  <Input
                    id="custom-category"
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    placeholder="Introduceți o categorie nouă (ex: Zidărie, Acoperișuri)"
                    className="mt-1 border-primary/40 focus-visible:ring-primary"
                  />
                </div>
              )}

              <div>
                <Label htmlFor="reference-qty" className="text-xs font-semibold">
                  Cantitate / Suprafață de Referință a Ofertei
                </Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    id="reference-qty"
                    type="number"
                    min={0.01}
                    value={referenceQuantity}
                    onChange={(e) => setReferenceQuantity(e.target.value)}
                    className="flex-1"
                  />
                  <span className="text-sm font-medium text-muted-foreground bg-muted px-3 py-2 rounded-md border">
                    {referenceUnit}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Sistemul va împărți cantitățile din ofertă la această suprafață pentru a determina consumul specific per {referenceUnit}.
                </p>
              </div>

              {/* Preview Table */}
              <div className="border rounded-md overflow-hidden bg-muted/20">
                <div className="bg-muted/50 px-3 py-1.5 border-b flex justify-between text-xs font-semibold text-muted-foreground">
                  <span>Material preview</span>
                  <span>Consum calculat</span>
                </div>
                <div className="max-h-[140px] overflow-y-auto px-3 divide-y divide-border/40">
                  {activeItems.map((item) => {
                    const qty = item.quantity;
                    const ref = parseFloat(referenceQuantity) || 100;
                    const consumption = ref > 0 ? (qty / ref).toFixed(4) : "0.0000";
                    return (
                      <div key={item.tempId} className="py-2 flex items-center justify-between text-xs gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{item.denumire}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">
                            {qty} {item.unit} în ofertă
                          </p>
                        </div>
                        <div className="shrink-0 font-bold text-primary text-right whitespace-nowrap">
                          {consumption} {item.unit} / {referenceUnit}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSaveAsRecipeOpen(false)} disabled={savingRecipe}>
                Anulează
              </Button>
              <Button onClick={handleSaveAsRecipe} disabled={savingRecipe || !recipeName.trim() || (recipeCategory === "custom" && !customCategory.trim())}>
                {savingRecipe ? "Se salvează..." : "Creează Rețetă"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {/* Equivalents Dialog */}
        <EquivalentsDialog
          open={equivalentsOpen}
          onOpenChange={setEquivalentsOpen}
          product={productForEquivalents}
          onReplace={handleReplaceItem}
        />
      </div>
    </DashboardLayout>
  );
};

export default NewQuote;
