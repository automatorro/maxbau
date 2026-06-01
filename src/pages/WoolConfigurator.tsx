import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { enrichProductPackagingWithAI, type StructuredPackagingInfo } from "@/utils/anthropic";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Calculator, AlertTriangle, Plus, Sparkles, Loader2, Info, ArrowRight, Layers, Box, Check
} from "lucide-react";
import { toast } from "sonner";
import { TVA_PERCENT, TVA_RATE } from "@/lib/utils";

interface CompanionItem {
  id: string;
  name: string;
  consumptionPerM2: number;
  um: string;
  packSize: number;
  packUm: string;
  basePrice: number;
  discount: number;
  selected: boolean;
  dbProductId: string | null;
  dbCodIntern: string | null;
  dbDenumire: string | null;
  dbPretLista: number | null;
}

export default function WoolConfigurator() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [targetArea, setTargetArea] = useState<string>("120");
  
  // Selected product & parsed packaging info
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedProductName, setSelectedProductName] = useState<string>("");
  const [selectedProductCode, setSelectedProductCode] = useState<string>("");
  const [selectedProductPret, setSelectedProductPret] = useState<number>(0);
  const [selectedProductUnit, setSelectedProductUnit] = useState<string>("mp");

  const [aiLoading, setAiLoading] = useState(false);
  const [packagingInfo, setPackagingInfo] = useState<StructuredPackagingInfo | null>(null);

  // Edit packaging states
  const [isEditingPackaging, setIsEditingPackaging] = useState(false);
  const [editBrand, setEditBrand] = useState("");
  const [editGrosime, setEditGrosime] = useState(100);
  const [editLungime, setEditLungime] = useState(1200);
  const [editLatime, setEditLatime] = useState(600);
  const [editPlaciBax, setEditPlaciBax] = useState(4);
  const [editAcoperireBax, setEditAcoperireBax] = useState(2.88);
  const [editBaxuriPalet, setEditBaxuriPalet] = useState(32);
  const [editAcoperirePalet, setEditAcoperirePalet] = useState(92.16);
  const [editGreutateBax, setEditGreutateBax] = useState(24);
  const [editUtilizare, setEditUtilizare] = useState("exterior");

  // System states
  const [includeSystem, setIncludeSystem] = useState(true);
  const [systemType, setSystemType] = useState<"exterior" | "interior">("exterior");
  const [companionItems, setCompanionItems] = useState<CompanionItem[]>([]);

  // Client info
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");

  // 1. Fetch wool products from DB
  const { data: dbProducts = [], isFetching: dbLoading } = useQuery({
    queryKey: ["wool-products-search", searchQuery],
    queryFn: async () => {
      // Fetch a broad set of wool products to score locally
      const brandTerms = ["vata", "fibran", "rockwool", "knauf", "isover", "ursa", "paroc", "swisspor"];
      const orFilters = brandTerms.map(term => `denumire_completa.ilike.%${term}%,brand.ilike.%${term}%,brand_slug.ilike.%${term}%`).join(",");

      let q = supabase
        .from("products")
        .select("id, cod_intern, denumire_completa, pret_lista, unit, specifications, packaging, pack_quantity, brand, brand_slug")
        .or(orFilters)
        .order("denumire_completa")
        .limit(1000);

      const { data, error } = await q;
      if (error) {
        console.error("Error fetching wool products:", error);
        return [];
      }
      return data || [];
    }
  });

  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return dbProducts.slice(0, 8);
    
    // Clean string: remove areas and generic construction words
    const normSearch = searchQuery
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/(\d+(?:\.\d+)?)\s*(?:mp|m2|metri|mp\b)/g, "")
      .replace(/\b(fatada|fatade|exterior|interior|mansarda|acoperis|pereti|etics|izolatie|grosime)\b/g, " ");

    const tokens = normSearch.split(/[^a-z0-9]+/).filter(t => t.length > 1);

    if (tokens.length === 0) return dbProducts.slice(0, 10);

    const scored = dbProducts.map(p => {
      const name = (p.denumire_completa || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      const code = (p.cod_intern || "").toLowerCase();
      const brand = (p.brand || "").toLowerCase();
      
      const target = `${name} ${code} ${brand}`;
      const targetNoSpaces = target.replace(/\s+/g, "");
      
      let score = 0;
      for (const t of tokens) {
        if (target.includes(t)) {
          score += t.length * 2; // match direct
        } else if (targetNoSpaces.includes(t)) {
          score += t.length; // match fara spatii (ex: fibrangeo == fibran geo)
        }
      }
      return { product: p, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(s => s.product)
      .slice(0, 10);
  }, [dbProducts, searchQuery]);

  // Extract wool area automatically from text query (e.g. "vata bp-70 10cm 150 mp" -> 150)
  useEffect(() => {
    const areaMatch = searchQuery.match(/(\d+(?:\.\d+)?)\s*(?:mp|m2|metri|mp\b)/i);
    if (areaMatch && areaMatch[1]) {
      const num = parseFloat(areaMatch[1]);
      if (num > 0) {
        setTargetArea(String(num));
      }
    }
    
    // Auto-detect type
    if (/fatada|fatade|exterior|etics|izolatie ext/i.test(searchQuery)) {
      setSystemType("exterior");
    } else if (/mansarda|interior|tavan|pereti|compartimentare/i.test(searchQuery)) {
      setSystemType("interior");
    }
  }, [searchQuery]);

  // 2. Select product and fetch/enrich packaging via AI
  const handleSelectProduct = async (product: any) => {
    setSelectedProductId(product.id);
    setSelectedProductName(product.denumire_completa);
    setSelectedProductCode(product.cod_intern);
    setSelectedProductPret(Number(product.pret_lista) || 0);
    setSelectedProductUnit(product.unit || "mp");
    setPackagingInfo(null);
    setAiLoading(true);

    try {
      // Fetch dynamic packaging details using Claude
      const result = await enrichProductPackagingWithAI(product.id, product.denumire_completa);
      if (result) {
        setPackagingInfo(result);
        setSystemType(result.utilizare_recomandata.includes("fatada") || result.utilizare_recomandata.includes("exterior") ? "exterior" : "interior");
        toast.success("Ambalarea a fost calculată inteligent prin AI!");
      } else {
        // Fallback standard packaging if AI fails
        const standardFallback: StructuredPackagingInfo = {
          brand: product.denumire_completa.split(" ")[0] || "Standard",
          grosime_mm: 100,
          lungime_mm: 1200,
          latime_mm: 600,
          placi_bax: 4,
          acoperire_bax_mp: 2.88,
          baxuri_palet: 32,
          acoperire_palet_mp: 92.16,
          greutate_bax_kg: 24,
          utilizare_recomandata: product.denumire_completa.toLowerCase().includes("fatada") ? "fatada exterior" : "interior mansarda pereți"
        };
        setPackagingInfo(standardFallback);
        toast.info("Am aplicat date de ambalare standard.");
      }
    } catch (e) {
      console.error(e);
      toast.error("Eroare la procesarea AI a ambalajului.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleStartEdit = () => {
    if (!packagingInfo) return;
    setEditBrand(packagingInfo.brand);
    setEditGrosime(packagingInfo.grosime_mm);
    setEditLungime(packagingInfo.lungime_mm);
    setEditLatime(packagingInfo.latime_mm);
    setEditPlaciBax(packagingInfo.placi_bax);
    setEditAcoperireBax(packagingInfo.acoperire_bax_mp);
    setEditBaxuriPalet(packagingInfo.baxuri_palet);
    setEditAcoperirePalet(packagingInfo.acoperire_palet_mp);
    setEditGreutateBax(packagingInfo.greutate_bax_kg);
    setEditUtilizare(packagingInfo.utilizare_recomandata);
    setIsEditingPackaging(true);
  };

  const handleSavePackaging = async () => {
    if (!selectedProductId || !packagingInfo) return;
    
    const updated: StructuredPackagingInfo = {
      brand: editBrand,
      grosime_mm: Number(editGrosime) || 0,
      lungime_mm: Number(editLungime) || 0,
      latime_mm: Number(editLatime) || 0,
      placi_bax: Number(editPlaciBax) || 0,
      acoperire_bax_mp: Number(editAcoperireBax) || 0,
      baxuri_palet: Number(editBaxuriPalet) || 0,
      acoperire_palet_mp: Number(editAcoperireBax) * Number(editBaxuriPalet) || Number(editAcoperirePalet) || 0,
      greutate_bax_kg: Number(editGreutateBax) || 0,
      utilizare_recomandata: editUtilizare
    };

    try {
      const { data: currentProduct } = await supabase
        .from("products")
        .select("specifications")
        .eq("id", selectedProductId)
        .single();
      const existingSpecs = (currentProduct?.specifications as any) || {};

      const { error } = await supabase
        .from("products")
        .update({
          specifications: {
            ...existingSpecs,
            packaging_details: updated
          },
          packaging: `Bax ${updated.acoperire_bax_mp} mp (${updated.placi_bax} placi)`,
          pack_quantity: String(updated.acoperire_bax_mp)
        })
        .eq("id", selectedProductId);

      if (error) throw error;
      setPackagingInfo(updated);
      setIsEditingPackaging(false);
      toast.success("Datele de ambalare au fost corectate și salvate permanent în catalog!");
    } catch (e) {
      console.error(e);
      toast.error("Eroare la permanentizarea datelor de ambalare.");
    }
  };

  // 3. Packaging Math Calculations
  const calculatedWool = useMemo(() => {
    const area = parseFloat(targetArea) || 0;
    if (area <= 0 || !packagingInfo) return null;

    const packCoverage = packagingInfo.acoperire_bax_mp;
    const palletPacks = packagingInfo.baxuri_palet;
    const palletCoverage = packagingInfo.acoperire_palet_mp;

    // Packs Math
    const packsNeeded = Math.ceil(area / packCoverage);
    const actualArea = packsNeeded * packCoverage;
    const woolTotalCost = packsNeeded * packCoverage * selectedProductPret;

    // Pallets Math
    const palletsDecimal = packsNeeded / palletPacks;
    const fullPalletsNeeded = Math.ceil(palletsDecimal);
    
    // Pallet guarantee returnable deposit
    const palletGuarantee = fullPalletsNeeded * 85; 

    return {
      packsNeeded,
      actualArea,
      woolTotalCost,
      palletsDecimal,
      fullPalletsNeeded,
      palletGuarantee
    };
  }, [targetArea, packagingInfo, selectedProductPret]);

  // 4. Generate Companion Materials dynamically
  const generateCompanionItems = useCallback(async () => {
    if (!calculatedWool || !packagingInfo) return;
    const area = calculatedWool.actualArea;

    let items: Omit<CompanionItem, "dbProductId" | "dbCodIntern" | "dbDenumire" | "dbPretLista">[] = [];

    if (systemType === "exterior") {
      items = [
        {
          id: "adeziv",
          name: "Adeziv & Masă șpaclu vată (Baumit DuoContact sau ProContact)",
          consumptionPerM2: 9.0, // kg/mp
          um: "kg",
          packSize: 25, // sac 25kg
          packUm: "sac",
          basePrice: 38.5,
          discount: 0,
          selected: true
        },
        {
          id: "plasa",
          name: "Plasă din fibră de sticlă cal. I (Baumit StarTex 160g)",
          consumptionPerM2: 1.1, // mp/mp
          um: "mp",
          packSize: 50, // rola 50mp
          packUm: "rolă",
          basePrice: 195.0,
          discount: 0,
          selected: true
        },
        {
          id: "dibluri",
          name: "Dibluri de fațadă cu cui metalic (10x160mm)",
          consumptionPerM2: 6.0, // buc/mp
          um: "buc",
          packSize: 200, // cutie 200 buc
          packUm: "cutie",
          basePrice: 140.0,
          discount: 0,
          selected: true
        },
        {
          id: "amorsa",
          name: "Grund amorsă tencuială (Baumit UniPrimer)",
          consumptionPerM2: 0.2, // kg/mp
          um: "kg",
          packSize: 25, // galeata 25kg
          packUm: "găleată",
          basePrice: 245.0,
          discount: 0,
          selected: true
        },
        {
          id: "decorativa",
          name: "Tencuială decorativă siliconică (Baumit SilikonTop 2mm)",
          consumptionPerM2: 2.8, // kg/mp
          um: "kg",
          packSize: 25, // galeata 25kg
          packUm: "găleată",
          basePrice: 185.0,
          discount: 0,
          selected: true
        }
      ];
    } else {
      // Interior drywall / attic setup
      items = [
        {
          id: "placi",
          name: "Placă gips-carton Rigips RBI 12.5mm (rezistentă la umezeală)",
          consumptionPerM2: 1.05, // mp/mp
          um: "mp",
          packSize: 3.12, // 1200x2600mm board
          packUm: "placă",
          basePrice: 42.0, // price per board
          discount: 0,
          selected: true
        },
        {
          id: "profil_cd",
          name: "Profil metalic structură CD60, grosime 0.6mm, L=4m",
          consumptionPerM2: 3.0, // ml/mp
          um: "ml",
          packSize: 4.0, // 4 meters
          packUm: "buc",
          basePrice: 16.5,
          discount: 0,
          selected: true
        },
        {
          id: "profil_ud",
          name: "Profil metalic contur UD30, grosime 0.6mm, L=3m",
          consumptionPerM2: 0.7, // ml/mp
          um: "ml",
          packSize: 3.0, // 3 meters
          packUm: "buc",
          basePrice: 10.2,
          discount: 0,
          selected: true
        },
        {
          id: "suruburi",
          name: "Șuruburi autoperforante 3.5x25mm (pentru profile)",
          consumptionPerM2: 15.0, // buc/mp
          um: "buc",
          packSize: 1000, // cutie 1000 buc
          packUm: "cutie",
          basePrice: 55.0,
          discount: 0,
          selected: true
        },
        {
          id: "ipsos",
          name: "Ipsos de îmbinări rosturi (Rigips Super Fugenfüller)",
          consumptionPerM2: 0.3, // kg/mp
          um: "kg",
          packSize: 20, // sac 20kg
          packUm: "sac",
          basePrice: 65.0,
          discount: 0,
          selected: true
        },
        {
          id: "banda",
          name: "Bandă armare îmbinări din fibră de sticlă",
          consumptionPerM2: 1.5, // ml/mp
          um: "ml",
          packSize: 90, // rola 90m
          packUm: "rolă",
          basePrice: 18.0,
          discount: 0,
          selected: true
        }
      ];
    }

    // Try finding matching catalog products in MaxBau DB for each companion item to fetch real prices and codes!
    const itemsWithDb = await Promise.all(
      items.map(async (item) => {
        let keyword = "";
        if (item.id === "adeziv") keyword = "DuoContact";
        else if (item.id === "plasa") keyword = "StarTex";
        else if (item.id === "amorsa") keyword = "UniPrimer";
        else if (item.id === "decorativa") keyword = "SilikonTop";
        else if (item.id === "placi") keyword = "gips";
        else if (item.id === "profil_cd") keyword = "CD60";
        else if (item.id === "profil_ud") keyword = "UD30";
        else if (item.id === "suruburi") keyword = "autofiletante";

        if (keyword) {
          const { data } = await supabase
            .from("products")
            .select("id, cod_intern, denumire_completa, pret_lista, unit")
            .ilike("denumire_completa", `%${keyword}%`)
            .limit(1);
          
          if (data && data[0]) {
            const p = data[0];
            return {
              ...item,
              dbProductId: p.id,
              dbCodIntern: p.cod_intern,
              dbDenumire: p.denumire_completa,
              dbPretLista: Number(p.pret_lista),
              basePrice: Number(p.pret_lista) // overwrite default with catalog price!
            };
          }
        }

        return {
          ...item,
          dbProductId: null,
          dbCodIntern: null,
          dbDenumire: null,
          dbPretLista: null
        };
      })
    );

    setCompanionItems(itemsWithDb as CompanionItem[]);
  }, [calculatedWool, packagingInfo, systemType]);

  // Trigger companion calculation when wool actual area changes
  useEffect(() => {
    if (calculatedWool) {
      void generateCompanionItems();
    }
  }, [calculatedWool, systemType, generateCompanionItems]);

  const updateCompanionItem = (id: string, field: keyof CompanionItem, value: any) => {
    setCompanionItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      return { ...item, [field]: value };
    }));
  };

  // 5. Overall pricing totals
  const systemTotals = useMemo(() => {
    if (!calculatedWool) return { net: 0, tva: 0, gross: 0 };
    
    let net = calculatedWool.woolTotalCost;

    if (includeSystem) {
      companionItems.forEach(item => {
        if (!item.selected) return;
        const totalNeeded = item.consumptionPerM2 * calculatedWool.actualArea;
        const packs = Math.ceil(totalNeeded / item.packSize);
        const itemCost = packs * item.basePrice * (1 - item.discount / 100);
        net += itemCost;
      });
    }

    // Add pallet guarantee
    net += calculatedWool.palletGuarantee;

    const tva = net * TVA_RATE;
    return { net, tva, gross: net + tva };
  }, [calculatedWool, companionItems, includeSystem]);

  // 6. Save draft quote mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Nu sunteți autentificat.");
      if (!calculatedWool || !packagingInfo) throw new Error("Alegeți un produs și o suprafață.");

      // Insert Quote Header
      const { data: quote, error: qErr } = await supabase
        .from("quotes")
        .insert({
          user_id: user.id,
          client_name: clientName || "Client Vată Bazaltică",
          client_phone: clientPhone || null,
          client_email: clientEmail || null,
          project_description: `Calcul Ambalare Vată: ${selectedProductName} pentru ${targetArea} mp (Sistem ${systemType === "exterior" ? "ETICS Fațadă" : "Interior/Mansardă"})`,
          status: "draft",
          total_net: systemTotals.net,
          total_tva: systemTotals.tva,
          total_gross: systemTotals.gross,
        })
        .select("id")
        .single();

      if (qErr || !quote) throw qErr ?? new Error("Eroare la salvarea ofertei.");

      const rows = [];

      // Add Wool Item
      rows.push({
        quote_id: quote.id,
        product_id: selectedProductId,
        cod_intern: selectedProductCode,
        denumire: selectedProductName,
        quantity: calculatedWool.packsNeeded * packagingInfo.acoperire_bax_mp,
        unit: selectedProductUnit,
        pret_unitar: selectedProductPret,
        discount_percent: 0,
        pret_final: selectedProductPret,
        subtotal: calculatedWool.woolTotalCost,
        cerere_initiala: `${targetArea} mp de vată bazaltică`,
        nota_ai: {
          ambalare: `${calculatedWool.packsNeeded} pachete/baxuri x ${packagingInfo.acoperire_bax_mp} mp`,
          grosime: `${packagingInfo.grosime_mm} mm`,
          recomandare: packagingInfo.utilizare_recomandata
        }
      });

      // Add Companion Items
      if (includeSystem) {
        companionItems.forEach(item => {
          if (!item.selected) return;
          const totalNeeded = item.consumptionPerM2 * calculatedWool.actualArea;
          const packs = Math.ceil(totalNeeded / item.packSize);
          const totalQty = packs * item.packSize;
          const itemCost = packs * item.basePrice * (1 - item.discount / 100);

          rows.push({
            quote_id: quote.id,
            product_id: item.dbProductId,
            cod_intern: item.dbCodIntern || "TEMP",
            denumire: item.dbDenumire || item.name,
            quantity: packs, // sold by package/container unit
            unit: item.packUm,
            pret_unitar: item.basePrice,
            discount_percent: item.discount,
            pret_final: item.basePrice * (1 - item.discount / 100),
            subtotal: itemCost,
            cerere_initiala: `Auxiliar pentru ${targetArea} mp vată`,
            nota_ai: {
              consum_estimat: `${item.consumptionPerM2} ${item.um}/mp`,
              baxuri: `${packs} ${item.packUm}`
            }
          });
        });
      }

      // Add Pallet returnable item
      rows.push({
        quote_id: quote.id,
        product_id: null,
        cod_intern: "PALET",
        denumire: `Garanție Palet Euro (Returnabil - ${calculatedWool.fullPalletsNeeded} buc)`,
        quantity: calculatedWool.fullPalletsNeeded,
        unit: "buc",
        pret_unitar: 85,
        discount_percent: 0,
        pret_final: 85,
        subtotal: calculatedWool.palletGuarantee,
        cerere_initiala: "Garanție paleți",
        nota_ai: { returnabil: true }
      });

      const { error: iErr } = await supabase.from("quote_items").insert(rows);
      if (iErr) throw iErr;

      return quote.id;
    },
    onSuccess: (quoteId) => {
      queryClient.invalidateQueries({ queryKey: ["my-quotes"] });
      toast.success("Ofertă salvată cu succes ca ciornă!");
      navigate(`/quotes`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Eroare la salvare");
    }
  });

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-5xl">
        {/* Title */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-4">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-primary/10 text-primary ring-1 ring-primary/25 mb-1.5">
              <Sparkles className="h-3 w-3" />
              Auto-clarificare cu AI
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Configurator Vată & Sisteme
            </h1>
            <p className="text-sm text-muted-foreground">
              Rezolvați cererile ambigue cu AI, calculați baxurile întregi și propuneți sisteme complete.
            </p>
          </div>
        </div>

        {/* Pasul 1: Introducerea cererii */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            <Card className="border-primary/20 shadow-sm relative overflow-hidden bg-gradient-to-br from-card via-card to-primary/[0.01]">
              <div className="absolute top-0 right-0 p-3 opacity-15 pointer-events-none">
                <Calculator className="h-20 w-20 text-primary" />
              </div>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary animate-pulse" />
                  1. Detalii cerere client
                </CardTitle>
                <CardDescription>
                  Introduceți ce a cerut clientul (AI va extrage suprafața și va semnala ce lipsește)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="client-request" className="text-xs">Cerere brută / Text primit</Label>
                  <Input
                    id="client-request"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder='Ex: "Am primit o cerere de 120 mp de vată Fibran de 10 cm" sau "Vata bazaltica BP-70 120 mp"'
                    className="mt-1"
                  />
                  {/* Quick templates */}
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button
                      onClick={() => setSearchQuery("Vata bazaltica FIBRANgeo BP-70 YM, 10 cm grosime, 1200 x 600 mm, 120 mp")}
                      className="text-[11px] bg-muted/60 hover:bg-muted text-muted-foreground px-2 py-0.5 rounded border border-border/50"
                    >
                      Fibran 10cm - 120 mp
                    </button>
                    <button
                      onClick={() => setSearchQuery("Vata bazaltica fatada Rockwool Frontrock Max E 100mm, 150 mp")}
                      className="text-[11px] bg-muted/60 hover:bg-muted text-muted-foreground px-2 py-0.5 rounded border border-border/50"
                    >
                      Rockwool Fațadă - 150 mp
                    </button>
                    <button
                      onClick={() => setSearchQuery("Vata minerala mansarda Knauf NatuRoll Plus 5cm, 250 mp")}
                      className="text-[11px] bg-muted/60 hover:bg-muted text-muted-foreground px-2 py-0.5 rounded border border-border/50"
                    >
                      Knauf Interior - 250 mp
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">Suprafață utilă solicitată (mp)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={targetArea}
                      onChange={(e) => setTargetArea(e.target.value)}
                      className="mt-1 font-bold text-lg text-primary"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Aplicație proiect</Label>
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      <Button
                        type="button"
                        variant={systemType === "exterior" ? "default" : "outline"}
                        className="h-9 text-xs"
                        onClick={() => setSystemType("exterior")}
                      >
                        Exterior (Fațadă)
                      </Button>
                      <Button
                        type="button"
                        variant={systemType === "interior" ? "default" : "outline"}
                        className="h-9 text-xs"
                        onClick={() => setSystemType("interior")}
                      >
                        Interior (Mansardă)
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Catalog search and selection */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>2. Selectați produsul potrivit din catalog ({filteredProducts.length})</span>
                  {dbLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </CardTitle>
                <CardDescription>
                  Identificați produsul vată corespunzător pentru a rula logica de ambalare AI
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0 max-h-[300px] overflow-y-auto divide-y divide-border/40">
                {filteredProducts.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground italic">
                    Niciun produs găsit. Încercați alt termen de căutare.
                  </div>
                ) : (
                  filteredProducts.map(p => {
                    const isSelected = selectedProductId === p.id;
                    return (
                      <div
                        key={p.id}
                        onClick={() => void handleSelectProduct(p)}
                        className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-colors ${
                          isSelected ? "bg-primary/5 border-l-4 border-primary" : "hover:bg-accent/10"
                        }`}
                      >
                        <div className="min-w-0 pr-3">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px] font-mono shrink-0 text-primary border-primary/20">
                              {p.cod_intern}
                            </Badge>
                            <span className="text-sm font-medium truncate block">{p.denumire_completa}</span>
                          </div>
                          {p.packaging && (
                            <span className="text-xs text-muted-foreground block mt-0.5">
                              Ambalare: {p.packaging}
                            </span>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-semibold text-foreground">
                            {Number(p.pret_lista).toFixed(2)} lei
                          </span>
                          <span className="text-xs text-muted-foreground">/{p.unit || "mp"}</span>
                          {isSelected && (
                            <Check className="h-4 w-4 text-primary ml-auto mt-1" />
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            {/* Calculations Card */}
            {selectedProductId && (
              <Card className="border-primary/30 relative overflow-hidden">
                {aiLoading && (
                  <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center z-10 p-6 text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
                    <h3 className="font-bold text-foreground">Se rulează auto-clarificarea ambalajului cu AI...</h3>
                    <p className="text-xs text-muted-foreground max-w-sm mt-1">
                      Claude analizează fișele tehnice Fibran / Rockwool / Knauf pentru a extrage automat dimensiunile baxului și capacitatea pe palet a produsului.
                    </p>
                  </div>
                )}

                <CardHeader className="bg-muted/40 pb-3 flex flex-row items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Box className="h-4 w-4 text-primary" />
                    3. Ambalare și Specificații Logistice
                  </CardTitle>
                  {!isEditingPackaging && packagingInfo && (
                    <Button 
                      type="button" 
                      variant="ghost" 
                      size="sm" 
                      onClick={handleStartEdit} 
                      className="text-xs text-primary hover:text-primary-hover gap-1 h-7"
                    >
                      <span>✏️ Editează</span>
                    </Button>
                  )}
                </CardHeader>

                <CardContent className="pt-4 space-y-4">
                  {packagingInfo && (
                    <>
                      {isEditingPackaging ? (
                        <div className="space-y-3 p-3 bg-primary/[0.01] rounded-lg border border-primary/20">
                          <h4 className="text-xs font-semibold text-primary flex items-center gap-1">
                            <Sparkles className="h-3 w-3" /> Corectează datele logistice de ambalare
                          </h4>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label className="text-[10px]">Brand / Producător</Label>
                              <Input 
                                value={editBrand} 
                                onChange={(e) => setEditBrand(e.target.value)} 
                                className="h-8 text-xs mt-0.5" 
                              />
                            </div>
                            <div>
                              <Label className="text-[10px]">Grosime (mm)</Label>
                              <Input 
                                type="number" 
                                value={editGrosime} 
                                onChange={(e) => setEditGrosime(parseInt(e.target.value) || 0)} 
                                className="h-8 text-xs mt-0.5" 
                              />
                            </div>
                            <div>
                              <Label className="text-[10px]">Lungime placă (mm)</Label>
                              <Input 
                                type="number" 
                                value={editLungime} 
                                onChange={(e) => setEditLungime(parseInt(e.target.value) || 0)} 
                                className="h-8 text-xs mt-0.5" 
                              />
                            </div>
                            <div>
                              <Label className="text-[10px]">Lățime placă (mm)</Label>
                              <Input 
                                type="number" 
                                value={editLatime} 
                                onChange={(e) => setEditLatime(parseInt(e.target.value) || 0)} 
                                className="h-8 text-xs mt-0.5" 
                              />
                            </div>
                            <div>
                              <Label className="text-[10px]">Plăci / Bax (buc)</Label>
                              <Input 
                                type="number" 
                                value={editPlaciBax} 
                                onChange={(e) => setEditPlaciBax(parseInt(e.target.value) || 0)} 
                                className="h-8 text-xs mt-0.5 font-semibold text-primary" 
                              />
                            </div>
                            <div>
                              <Label className="text-[10px]">Suprafață / Bax (mp)</Label>
                              <Input 
                                type="number" 
                                step="any"
                                value={editAcoperireBax} 
                                onChange={(e) => setEditAcoperireBax(parseFloat(e.target.value) || 0)} 
                                className="h-8 text-xs mt-0.5 font-bold text-primary" 
                              />
                            </div>
                            <div>
                              <Label className="text-[10px]">Baxuri / Palet (buc)</Label>
                              <Input 
                                type="number" 
                                value={editBaxuriPalet} 
                                onChange={(e) => setEditBaxuriPalet(parseInt(e.target.value) || 0)} 
                                className="h-8 text-xs mt-0.5 font-semibold text-primary" 
                              />
                            </div>
                            <div>
                              <Label className="text-[10px]">Greutate Bax (kg)</Label>
                              <Input 
                                type="number" 
                                value={editGreutateBax} 
                                onChange={(e) => setEditGreutateBax(parseInt(e.target.value) || 0)} 
                                className="h-8 text-xs mt-0.5" 
                              />
                            </div>
                          </div>
                          <div className="flex gap-2 justify-end pt-2">
                            <Button 
                              type="button" 
                              variant="outline" 
                              size="sm" 
                              onClick={() => setIsEditingPackaging(false)} 
                              className="h-7 text-xs"
                            >
                              Anulează
                            </Button>
                            <Button 
                              type="button" 
                              size="sm" 
                              onClick={handleSavePackaging} 
                              className="h-7 text-xs gap-1"
                            >
                              <Check className="h-3 w-3" /> Salvează & Blochează
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-3 bg-muted/30 rounded-lg border border-border/40">
                          <div className="text-center">
                            <span className="text-[10px] uppercase font-bold text-muted-foreground block">Producător</span>
                            <span className="text-sm font-semibold text-foreground">{packagingInfo.brand}</span>
                          </div>
                          <div className="text-center">
                            <span className="text-[10px] uppercase font-bold text-muted-foreground block">Dimensiuni Placă</span>
                            <span className="text-sm font-semibold text-foreground">
                              {packagingInfo.lungime_mm} x {packagingInfo.latime_mm} mm
                            </span>
                          </div>
                          <div className="text-center">
                            <span className="text-[10px] uppercase font-bold text-muted-foreground block">Plăci / Bax</span>
                            <span className="text-sm font-semibold text-foreground">{packagingInfo.placi_bax} buc</span>
                          </div>
                          <div className="text-center">
                            <span className="text-[10px] uppercase font-bold text-muted-foreground block">Grosime Strat</span>
                            <span className="text-sm font-semibold text-foreground">{packagingInfo.grosime_mm} mm (10 cm)</span>
                          </div>
                        </div>
                      )}

                      {calculatedWool && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <Card className="bg-primary/[0.02] border-primary/20">
                            <CardContent className="p-4 text-center">
                              <span className="text-xs text-muted-foreground block">Necesar Baxuri Întregi</span>
                              <span className="text-2xl font-bold text-primary block my-1">
                                {calculatedWool.packsNeeded} baxuri
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                x {packagingInfo.acoperire_bax_mp} mp/bax
                              </span>
                            </CardContent>
                          </Card>

                          <Card className="bg-primary/[0.02] border-primary/20">
                            <CardContent className="p-4 text-center">
                              <span className="text-xs text-muted-foreground block">Suprafață Real Livrată</span>
                              <span className="text-2xl font-bold text-foreground block my-1">
                                {calculatedWool.actualArea.toFixed(2)} mp
                              </span>
                              <span className="text-[11px] text-emerald-600 font-semibold">
                                +{(calculatedWool.actualArea - parseFloat(targetArea)).toFixed(2)} mp suplimentar
                              </span>
                            </CardContent>
                          </Card>

                          <Card className="bg-primary/[0.02] border-primary/20">
                            <CardContent className="p-4 text-center">
                              <span className="text-xs text-muted-foreground block">Cantitate Paleți</span>
                              <span className="text-2xl font-bold text-foreground block my-1">
                                {calculatedWool.fullPalletsNeeded} paleți
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                ({calculatedWool.palletsDecimal.toFixed(2)} paleți exact)
                              </span>
                            </CardContent>
                          </Card>
                        </div>
                      )}

                      <div className="text-xs text-muted-foreground border-t pt-3 flex flex-col gap-1">
                        <div className="flex justify-between">
                          <span>Preț listă catalog unitate:</span>
                          <span className="font-semibold">{selectedProductPret.toFixed(2)} lei / {selectedProductUnit}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Cost vată bazaltică (rotunjită):</span>
                          <span className="font-semibold text-foreground">{calculatedWool?.woolTotalCost.toFixed(2)} lei</span>
                        </div>
                        <div className="flex justify-between text-amber-700">
                          <span>Garanție returnabilă paleți europeni ({calculatedWool?.fullPalletsNeeded} buc x 85 lei):</span>
                          <span className="font-semibold">+{calculatedWool?.palletGuarantee.toFixed(2)} lei</span>
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right column: Client details and summary */}
          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Date Client & Proiect</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-xs">Nume client</Label>
                  <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="SC Construct SRL" />
                </div>
                <div>
                  <Label className="text-xs">Telefon</Label>
                  <Input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="07xx xxx xxx" />
                </div>
                <div>
                  <Label className="text-xs">Email</Label>
                  <Input value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="email@client.ro" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-primary/40 shadow-md">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Sumar Deving / Deviz Ofertă</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 text-sm">
                  {selectedProductId ? (
                    <div className="flex justify-between py-1 border-b">
                      <span>Vată bazaltică:</span>
                      <span className="font-medium">{calculatedWool?.woolTotalCost.toFixed(2)} lei</span>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground italic text-center py-2">
                      Niciun produs selectat
                    </div>
                  )}

                  {includeSystem && calculatedWool && (
                    <div className="flex justify-between py-1 border-b">
                      <span>Materiale sistem / auxiliare:</span>
                      <span className="font-medium">
                        {(systemTotals.net - calculatedWool.woolTotalCost - calculatedWool.palletGuarantee).toFixed(2)} lei
                      </span>
                    </div>
                  )}

                  {calculatedWool && (
                    <div className="flex justify-between py-1 border-b text-amber-700">
                      <span>Garanție paleți:</span>
                      <span className="font-medium">+{calculatedWool.palletGuarantee.toFixed(2)} lei</span>
                    </div>
                  )}

                  <div className="flex justify-between pt-2 text-base font-bold text-foreground">
                    <span>Total fără TVA:</span>
                    <span>{systemTotals.net.toFixed(2)} lei</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>TVA ({TVA_PERCENT}%):</span>
                    <span>{systemTotals.tva.toFixed(2)} lei</span>
                  </div>
                  <div className="flex justify-between pt-1 border-t-2 text-lg font-black text-primary">
                    <span>Total cu TVA:</span>
                    <span>{systemTotals.gross.toFixed(2)} lei</span>
                  </div>
                </div>

                <Button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending || !selectedProductId}
                  className="w-full h-11 gap-2 text-sm font-semibold"
                >
                  {saveMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Se salvează...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      Salvează ca Ofertă Draft
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Pasul 5: Companion System Estimator Table */}
        {selectedProductId && calculatedWool && (
          <Card className="mt-6 border-primary/20">
            <CardHeader className="pb-3 flex flex-row items-center justify-between flex-wrap gap-2 bg-primary/[0.01]">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" />
                  Calcul Sistem Complementar de Materiale Auxiliare
                </CardTitle>
                <CardDescription>
                  Ofertați un sistem complet pentru a securiza compatibilitatea pe șantier și a maximiza valoarea
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="include-system"
                  checked={includeSystem}
                  onCheckedChange={(checked) => setIncludeSystem(!!checked)}
                />
                <Label htmlFor="include-system" className="text-xs font-semibold cursor-pointer">
                  Include materiale auxiliare în ofertă
                </Label>
              </div>
            </CardHeader>

            {includeSystem && (
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[50px]"></TableHead>
                        <TableHead>Material estimat necesar</TableHead>
                        <TableHead className="w-[100px] text-right">Consum / mp</TableHead>
                        <TableHead className="w-[110px] text-right">Cant. Necesară</TableHead>
                        <TableHead className="w-[130px] text-center">Rotunjire ambalaj</TableHead>
                        <TableHead className="w-[120px] text-right">Preț listă</TableHead>
                        <TableHead className="w-[90px] text-right">Disc%</TableHead>
                        <TableHead className="w-[120px] text-right">Total item</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {companionItems.map((item) => {
                        const totalQtyNeeded = item.consumptionPerM2 * calculatedWool.actualArea;
                        const packsNeeded = Math.ceil(totalQtyNeeded / item.packSize);
                        const roundedQty = packsNeeded * item.packSize;
                        const cost = packsNeeded * item.basePrice * (1 - item.discount / 100);

                        return (
                          <TableRow key={item.id} className={!item.selected ? "opacity-40" : ""}>
                            <TableCell className="text-center">
                              <Checkbox
                                checked={item.selected}
                                onCheckedChange={(checked) => updateCompanionItem(item.id, "selected", !!checked)}
                              />
                            </TableCell>
                            <TableCell>
                              <div className="text-sm font-semibold">
                                {item.dbDenumire || item.name}
                              </div>
                              <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                                {item.dbProductId ? (
                                  <>
                                    <Badge variant="outline" className="text-[9px] text-emerald-600 border-emerald-400 bg-emerald-50 h-4">
                                      Asociat din catalog
                                    </Badge>
                                    <span className="font-mono text-[10px]">{item.dbCodIntern}</span>
                                  </>
                                ) : (
                                  <Badge variant="secondary" className="text-[9px] h-4">Material generic</Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right text-xs">
                              {item.consumptionPerM2} {item.um}
                            </TableCell>
                            <TableCell className="text-right text-xs font-medium">
                              {totalQtyNeeded.toFixed(2)} {item.um}
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant="secondary" className="text-xs font-bold font-mono">
                                {packsNeeded} {item.packUm}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground block mt-0.5">
                                ({roundedQty.toFixed(1)} {item.um} real)
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                step="any"
                                value={item.basePrice}
                                onChange={(e) => updateCompanionItem(item.id, "basePrice", parseFloat(e.target.value) || 0)}
                                className="h-8 text-right text-xs font-semibold max-w-[90px] ml-auto"
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                value={item.discount}
                                onChange={(e) => updateCompanionItem(item.id, "discount", parseFloat(e.target.value) || 0)}
                                className="h-8 text-right text-xs max-w-[65px] ml-auto"
                              />
                            </TableCell>
                            <TableCell className="text-right font-bold text-foreground">
                              {cost.toFixed(2)} lei
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            )}
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
