import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  FileText,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Upload,
  Bot,
  ShoppingCart,
  Layers,
  ThermometerSun,
  Flame,
  Clock,
  Package,
  Ruler,
  Scale,
  Droplets,
  Award,
  BookOpen,
  Zap,
  Info,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FisaTehnicaSpecs {
  densitate?: string | null;
  conductivitate_termica?: string | null;
  rezistenta_compresiune?: string | null;
  rezistenta_tractiune?: string | null;
  clasa_reactie_foc?: string | null;
  temperatura_aplicare_min?: string | null;
  temperatura_aplicare_max?: string | null;
  timp_uscare?: string | null;
  timp_maturare?: string | null;
  consum?: string | null;
  ambalaj?: string | null;
  grosime_strat?: string | null;
  rezistenta_la_apa?: string | null;
  utilizare?: string[];
  compatibil_cu?: string[];
  incompatibil_cu?: string[];
  norma_standard?: string[];
  clasa_utilizare?: string | null;
  continut_co2?: string | null;
  producator?: string | null;
  serie_produs?: string | null;
  garantie?: string | null;
  rezumat_tehnic?: string | null;
  _extracted_at?: string;
  _source?: string;
}

interface AiInfo {
  consum?: string;
  ambalaj?: string;
  alternative?: string[];
  compatibilitati?: string;
  utilizare?: string;
  updated_at?: string;
  source?: string;
}

interface ProductFull {
  id: string;
  cod_intern: string;
  denumire_completa: string;
  unit: string | null;
  pret_lista: number;
  brand: string | null;
  manufacturer: string | null;
  packaging: string | null;
  pack_quantity: string | null;
  specifications: Record<string, unknown> | null;
  fisa_tehnica_url?: string | null;
  fisa_tehnica_storage_path?: string | null;
  fisa_tehnica_processed?: boolean;
  categories?: { name: string } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type DataSource = "verified" | "ai_generated" | "none";

function getDataSource(product: ProductFull): DataSource {
  const specs = product.specifications || {};
  if (specs.fisa_tehnica_specs) return "verified";
  if (specs.ai_info) return "ai_generated";
  return "none";
}

function getFisaTehnicaSpecs(product: ProductFull): FisaTehnicaSpecs | null {
  const specs = product.specifications || {};
  return (specs.fisa_tehnica_specs as FisaTehnicaSpecs) || null;
}

function getAiInfo(product: ProductFull): AiInfo | null {
  const specs = product.specifications || {};
  if (specs.ai_info) return specs.ai_info as AiInfo;
  // Fall back: build ai_info shape from fisa_tehnica_specs
  const ft = specs.fisa_tehnica_specs as FisaTehnicaSpecs | undefined;
  if (ft) {
    return {
      consum: ft.consum || undefined,
      ambalaj: ft.ambalaj || undefined,
      compatibilitati: Array.isArray(ft.compatibil_cu)
        ? ft.compatibil_cu.join(", ")
        : (ft.compatibil_cu as string) || undefined,
      utilizare: Array.isArray(ft.utilizare)
        ? ft.utilizare.join(", ")
        : (ft.utilizare as string) || undefined,
      alternative: [],
    };
  }
  return null;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const DataSourceBadge = ({ source }: { source: DataSource }) => {
  if (source === "verified") {
    return (
      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium">
        <CheckCircle2 className="h-4 w-4" />
        Verificat din fișă tehnică oficială
      </div>
    );
  }
  if (source === "ai_generated") {
    return (
      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-sm font-medium">
        <AlertTriangle className="h-4 w-4" />
        Date generate de AI — orientative, pot conține erori
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
      <XCircle className="h-4 w-4" />
      Fără date tehnice procesate
    </div>
  );
};

const SpecRow = ({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value?: string | null;
}) => {
  if (!value || value === "N/A") return null;
  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-b-0">
      <div className="p-1.5 rounded-md bg-muted shrink-0">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
          {label}
        </p>
        <p className="text-sm font-semibold text-foreground mt-0.5 break-words">{value}</p>
      </div>
    </div>
  );
};

const ChipList = ({ label, items, color = "blue" }: { label: string; items?: string[]; color?: string }) => {
  if (!items || items.length === 0) return null;
  const colorMap: Record<string, string> = {
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    red: "bg-red-50 text-red-700 border-red-200",
    gray: "bg-gray-50 text-gray-700 border-gray-200",
  };
  return (
    <div className="py-3 border-b last:border-b-0">
      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <span
            key={i}
            className={cn(
              "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border",
              colorMap[color] || colorMap.blue
            )}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
};

// ─── Tab: Date Tehnice ────────────────────────────────────────────────────────

const TechnicalDataTab = ({ product }: { product: ProductFull }) => {
  const source = getDataSource(product);
  const ft = getFisaTehnicaSpecs(product);
  const ai = getAiInfo(product);

  if (source === "none") {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
        <div className="p-4 rounded-full bg-red-50">
          <XCircle className="h-10 w-10 text-red-400" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Nicio fișă tehnică disponibilă</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            Produsul nu are o fișă tehnică procesată. Poți adăuga una în tab-ul "Fișă Tehnică"
            sau poți cere Consultantului AI date orientative.
          </p>
        </div>
        <div className="flex gap-2 mt-2">
          <Button variant="outline" size="sm" asChild>
            <Link to={`/consultant?product=${product.cod_intern}`}>
              <Bot className="h-4 w-4 mr-2" />
              Întreabă Consultantul AI
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  // Rezumat tehnic hero
  const rezumat = ft?.rezumat_tehnic;

  return (
    <div className="space-y-6">
      {/* Source banner for AI data */}
      {source === "ai_generated" && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Date generate de AI — nu din fișă tehnică oficială</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Aceste date sunt orientative și pot conține inexactități. Pentru specificații exacte, adaugă fișa tehnică
              oficială a producătorului.
            </p>
          </div>
        </div>
      )}

      {/* Rezumat tehnic */}
      {rezumat && (
        <Card className={cn(
          "border-2",
          source === "verified" ? "border-emerald-200 bg-emerald-50/30" : "border-amber-200 bg-amber-50/30"
        )}>
          <CardHeader className="pb-2 pt-4 px-5">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <Info className="h-4 w-4" />
              Rezumat tehnic
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <p className="text-sm leading-relaxed">{rezumat}</p>
          </CardContent>
        </Card>
      )}

      {/* Specs grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Coloana stânga: Date fizice */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-5">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Caracteristici fizice
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-2">
            <SpecRow icon={Scale} label="Densitate" value={ft?.densitate} />
            <SpecRow icon={ThermometerSun} label="Conductivitate termică (λ)" value={ft?.conductivitate_termica} />
            <SpecRow icon={Zap} label="Rezistență la compresiune" value={ft?.rezistenta_compresiune} />
            <SpecRow icon={Zap} label="Rezistență la tracțiune" value={ft?.rezistenta_tractiune} />
            <SpecRow icon={Droplets} label="Rezistență la apă" value={ft?.rezistenta_la_apa} />
            <SpecRow icon={Flame} label="Clasă reacție la foc" value={ft?.clasa_reactie_foc} />
            <SpecRow icon={Award} label="Clasă utilizare" value={ft?.clasa_utilizare} />
          </CardContent>
        </Card>

        {/* Coloana dreapta: Date aplicare */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-5">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Date de aplicare
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-2">
            <SpecRow icon={Package} label="Consum" value={ft?.consum || ai?.consum} />
            <SpecRow icon={Package} label="Ambalaj" value={ft?.ambalaj || ai?.ambalaj} />
            <SpecRow icon={Ruler} label="Grosime strat" value={ft?.grosime_strat} />
            <SpecRow icon={ThermometerSun} label="Temperatură aplicare min" value={ft?.temperatura_aplicare_min} />
            <SpecRow icon={ThermometerSun} label="Temperatură aplicare max" value={ft?.temperatura_aplicare_max} />
            <SpecRow icon={Clock} label="Timp uscare / întărire" value={ft?.timp_uscare} />
            <SpecRow icon={Clock} label="Timp maturare" value={ft?.timp_maturare} />
            <SpecRow icon={Award} label="Garanție" value={ft?.garantie} />
          </CardContent>
        </Card>
      </div>

      {/* Chip lists */}
      <Card>
        <CardContent className="px-5 py-2">
          <ChipList
            label="Domenii de utilizare"
            items={
              ft?.utilizare ??
              (ai?.utilizare ? [ai.utilizare] : undefined)
            }
            color="blue"
          />
          <ChipList label="Compatibil cu" items={ft?.compatibil_cu} color="green" />
          <ChipList label="Incompatibil cu / restricții" items={ft?.incompatibil_cu} color="red" />
          <ChipList label="Standarde / norme" items={ft?.norma_standard} color="gray" />
        </CardContent>
      </Card>

      {/* Info extra */}
      {(ft?.producator || ft?.serie_produs || ft?.continut_co2) && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-5">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Informații suplimentare
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-2">
            <SpecRow icon={BookOpen} label="Producător (din fișă)" value={ft?.producator} />
            <SpecRow icon={BookOpen} label="Serie produs" value={ft?.serie_produs} />
            <SpecRow icon={BookOpen} label="Conținut CO₂" value={ft?.continut_co2} />
          </CardContent>
        </Card>
      )}

      {/* Extracted at */}
      {ft?._extracted_at && (
        <p className="text-xs text-muted-foreground text-right">
          Extras la: {new Date(ft._extracted_at).toLocaleString("ro-RO")}
        </p>
      )}
    </div>
  );
};

// ─── Tab: Fișă Tehnică (upload) ───────────────────────────────────────────────

const DatasheetTab = ({
  product,
  onSpecsExtracted,
}: {
  product: ProductFull;
  onSpecsExtracted: () => void;
}) => {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [urlInput, setUrlInput] = useState(product.fisa_tehnica_url || "");

  const handleFileUpload = async (file: File) => {
    if (!file || file.type !== "application/pdf") {
      toast({ title: "Eroare", description: "Te rog selectează un fișier PDF valid.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const fileExt = "pdf";
      const fileName = `${product.cod_intern}/${product.cod_intern}_fisa_tehnica.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from("fise-tehnice")
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("fise-tehnice")
        .getPublicUrl(fileName);

      await supabase
        .from("products")
        .update({
          fisa_tehnica_url: publicUrl,
          fisa_tehnica_storage_path: fileName,
        })
        .eq("id", product.id);

      toast({ title: "PDF încărcat", description: "Fișa tehnică a fost încărcată. Acum poți extrage datele." });
      await triggerExtraction(product.id);
    } catch (err: any) {
      toast({ title: "Eroare upload", description: err?.message || "Eroare necunoscută", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleUrlSave = async () => {
    if (!urlInput.trim()) return;
    setUploading(true);
    try {
      await supabase
        .from("products")
        .update({ fisa_tehnica_url: urlInput.trim() })
        .eq("id", product.id);
      toast({ title: "URL salvat", description: "Se extrag datele tehnice..." });
      await triggerExtraction(product.id);
    } catch (err: any) {
      toast({ title: "Eroare", description: err?.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const triggerExtraction = async (productId: string) => {
    setExtracting(true);
    try {
      const { data, error } = await supabase.functions.invoke("extract-pdf-specs", {
        body: { productId },
      });
      if (error || !data?.success) {
        throw new Error(error?.message || data?.error || "Extragerea a eșuat");
      }
      toast({ title: "✅ Date extrase cu succes!", description: "Specificațiile tehnice sunt acum disponibile." });
      onSpecsExtracted();
    } catch (err: any) {
      toast({
        title: "Extragere eșuată",
        description: err?.message || "Verifică că fișierul este o fișă tehnică PDF valabilă.",
        variant: "destructive",
      });
    } finally {
      setExtracting(false);
    }
  };

  const hasPdf = !!(product.fisa_tehnica_url || product.fisa_tehnica_storage_path);
  const hasSpecs = !!product.specifications?.fisa_tehnica_specs;

  return (
    <div className="space-y-6">
      {/* Status actual */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Status fișă tehnică
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <div className={cn("h-3 w-3 rounded-full", hasPdf ? "bg-emerald-500" : "bg-gray-300")} />
            <span className="text-sm">{hasPdf ? "PDF configurat" : "Niciun PDF"}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className={cn("h-3 w-3 rounded-full", hasSpecs ? "bg-emerald-500" : "bg-gray-300")} />
            <span className="text-sm">{hasSpecs ? "Date tehnice extrase" : "Date tehnice lipsesc"}</span>
          </div>
          {product.fisa_tehnica_url && (
            <a
              href={product.fisa_tehnica_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline mt-1"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Deschide PDF-ul curent
            </a>
          )}
        </CardContent>
      </Card>

      {/* Upload nou */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {hasPdf ? "Actualizează fișa tehnică" : "Adaugă fișă tehnică"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Drag & drop PDF */}
          <div>
            <Label className="mb-2 block">Încarcă PDF local</Label>
            <label
              className={cn(
                "flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-8 cursor-pointer transition-colors",
                uploading || extracting
                  ? "border-muted bg-muted/30 cursor-not-allowed"
                  : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/20"
              )}
            >
              <Upload className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm font-medium">Click sau trage PDF-ul aici</p>
              <p className="text-xs text-muted-foreground mt-1">Fișe tehnice PDF (max. 20MB)</p>
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                disabled={uploading || extracting}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
              />
            </label>
          </div>

          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">sau</span>
            <Separator className="flex-1" />
          </div>

          {/* URL extern */}
          <div>
            <Label htmlFor="ft-url" className="mb-2 block">URL extern (link fișă tehnică producător)</Label>
            <div className="flex gap-2">
              <Input
                id="ft-url"
                placeholder="https://..."
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                disabled={uploading || extracting}
              />
              <Button
                onClick={handleUrlSave}
                disabled={!urlInput.trim() || uploading || extracting}
                size="sm"
                className="shrink-0"
              >
                {uploading || extracting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Salvează & extrage"
                )}
              </Button>
            </div>
          </div>

          {/* Loading state */}
          {extracting && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-blue-50 border border-blue-200">
              <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
              <div>
                <p className="text-sm font-semibold text-blue-800">Gemini analizează fișa tehnică...</p>
                <p className="text-xs text-blue-600">Poate dura 10–20 secunde. Te rugăm să aștepți.</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

// ─── Tab: Ofertare rapidă ─────────────────────────────────────────────────────

const QuickQuoteTab = ({ product }: { product: ProductFull }) => {
  const navigate = useNavigate();
  const [quantity, setQuantity] = useState("1");

  const ft = getFisaTehnicaSpecs(product);
  const ai = getAiInfo(product);
  const consum = ft?.consum || ai?.consum;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Calcul cantitate
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="qty">Suprafață / cantitate (m² sau {product.unit || "buc"})</Label>
              <Input
                id="qty"
                type="number"
                min="0"
                step="0.1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="mt-1.5"
              />
            </div>
            {consum && (
              <div className="p-3 rounded-lg bg-muted/50 text-sm">
                <p className="text-muted-foreground">Consum per unitate:</p>
                <p className="font-semibold">{consum}</p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              * Cantitățile exacte se calculează în modulele de ofertare cu ajutorul rețetelor tehnice.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Preț estimativ
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-3xl font-bold text-primary">
              {(product.pret_lista * Math.max(parseFloat(quantity) || 1, 0)).toFixed(2)}{" "}
              <span className="text-base font-normal text-muted-foreground">lei</span>
            </div>
            <p className="text-xs text-muted-foreground">Fără TVA · {Number(quantity) || 1} {product.unit || "buc"} × {product.pret_lista.toFixed(2)} lei/{product.unit || "buc"}</p>
            <Separator className="my-2" />
            <p className="text-xs text-muted-foreground">
              Preț negociat + discounturi se aplică în modulele de ofertare dedicate.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button
          onClick={() => navigate(`/quote/new?add=${product.cod_intern}`)}
          className="gap-2"
        >
          <ShoppingCart className="h-4 w-4" />
          Adaugă în Ofertă
        </Button>
        <Button variant="outline" asChild className="gap-2">
          <Link to="/recipe-quote">
            <Layers className="h-4 w-4" />
            Configurator Rețete & Sisteme
          </Link>
        </Button>
        <Button variant="outline" asChild className="gap-2">
          <Link to={`/consultant?product=${product.cod_intern}&denumire=${encodeURIComponent(product.denumire_completa)}`}>
            <MessageSquare className="h-4 w-4" />
            Discută cu Consultantul AI
          </Link>
        </Button>
      </div>
    </div>
  );
};

// ─── Tab: Echivalente ─────────────────────────────────────────────────────────

const EquivalentsTab = ({ product }: { product: ProductFull }) => {
  const ai = getAiInfo(product);
  const ft = getFisaTehnicaSpecs(product);
  const source = getDataSource(product);

  // Fetch echivalente din DB (produse din aceeași categorie cu specs)
  const { data: equivalents = [], isLoading } = useQuery({
    queryKey: ["product-equivalents", product.id],
    queryFn: async () => {
      // Mai întâi obținem category_id al produsului curent
      const { data: productData } = await supabase
        .from("products")
        .select("category_id")
        .eq("id", product.id)
        .single();

      if (!productData?.category_id) return [];

      // Produse din aceeași categorie cu fișă tehnică procesată, exclus produsul curent
      const { data } = await supabase
        .from("products")
        .select("id, cod_intern, denumire_completa, pret_lista, unit, brand, fisa_tehnica_processed, specifications")
        .eq("category_id", productData.category_id)
        .eq("is_active", true)
        .eq("fisa_tehnica_processed", true)
        .neq("id", product.id)
        .limit(6);

      return data || [];
    },
  });

  return (
    <div className="space-y-5">
      {/* Alternative AI (dacă există) */}
      {(ai?.alternative && ai.alternative.length > 0) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <Bot className="h-4 w-4" />
              Alternative sugerate de AI
              {source === "ai_generated" && (
                <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs ml-1">
                  Orientativ
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {ai.alternative.map((alt, i) => (
                <Badge key={i} variant="secondary" className="text-sm py-1 px-3">
                  {alt}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              ⚠️ Acestea sunt sugestii AI bazate pe denumire. Produsele de mai jos sunt echivalente reale din catalog.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Produse reale din aceeași categorie */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Produse similare din catalog (cu fișă tehnică)
        </h3>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : equivalents.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            Niciun produs similar cu fișă tehnică procesată în această categorie.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {equivalents.map((eq: any) => {
              const eqSource = getDataSource(eq);
              return (
                <Link key={eq.id} to={`/catalog/product/${eq.id}`}>
                  <Card className="hover:shadow-md transition-all border hover:border-primary/30 cursor-pointer group">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-mono text-muted-foreground">{eq.cod_intern}</p>
                          <p className="text-sm font-medium line-clamp-2 mt-0.5 group-hover:text-primary transition-colors">
                            {eq.denumire_completa}
                          </p>
                        </div>
                        <div className="shrink-0">
                          {eqSource === "verified" ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-amber-500" />
                          )}
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <p className="text-base font-bold text-primary">
                          {Number(eq.pret_lista).toFixed(2)} lei/{eq.unit || "buc"}
                        </p>
                        {eq.brand && (
                          <Badge variant="outline" className="text-xs">{eq.brand}</Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

const ProductDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: product, isLoading, refetch } = useQuery({
    queryKey: ["product-detail", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*, categories(name)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as ProductFull;
    },
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (!product) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
          <p className="text-muted-foreground">Produsul nu a fost găsit.</p>
          <Button variant="outline" onClick={() => navigate("/catalog")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Înapoi la catalog
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const source = getDataSource(product);

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-5xl">
        {/* Back */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(-1)}
          className="gap-2 -ml-1 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Înapoi
        </Button>

        {/* Header */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono text-sm border-primary/40 text-primary">
              {product.cod_intern}
            </Badge>
            {product.brand && <Badge variant="secondary">{product.brand}</Badge>}
            {product.categories && (
              <Badge variant="secondary" className="text-xs">
                {(product.categories as any).name}
              </Badge>
            )}
          </div>
          <h1 className="text-2xl font-bold leading-tight">{product.denumire_completa}</h1>
          <div className="flex flex-wrap items-center gap-4">
            <DataSourceBadge source={source} />
            <div className="text-2xl font-bold text-primary">
              {Number(product.pret_lista).toFixed(2)}{" "}
              <span className="text-base font-normal text-muted-foreground">
                lei / {product.unit || "buc"} fără TVA
              </span>
            </div>
          </div>
        </div>

        <Separator />

        {/* Tabs */}
        <Tabs defaultValue="tehnic">
          <TabsList className="grid grid-cols-4 w-full max-w-xl">
            <TabsTrigger value="tehnic" className="gap-1.5 text-xs sm:text-sm">
              <FileText className="h-3.5 w-3.5" />
              Date tehnice
            </TabsTrigger>
            <TabsTrigger value="ofertare" className="gap-1.5 text-xs sm:text-sm">
              <ShoppingCart className="h-3.5 w-3.5" />
              Ofertare
            </TabsTrigger>
            <TabsTrigger value="echivalente" className="gap-1.5 text-xs sm:text-sm">
              <Layers className="h-3.5 w-3.5" />
              Echivalente
            </TabsTrigger>
            <TabsTrigger value="fisa" className="gap-1.5 text-xs sm:text-sm">
              <Upload className="h-3.5 w-3.5" />
              Fișă PDF
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tehnic" className="mt-6">
            <TechnicalDataTab product={product} />
          </TabsContent>

          <TabsContent value="ofertare" className="mt-6">
            <QuickQuoteTab product={product} />
          </TabsContent>

          <TabsContent value="echivalente" className="mt-6">
            <EquivalentsTab product={product} />
          </TabsContent>

          <TabsContent value="fisa" className="mt-6">
            <DatasheetTab product={product} onSpecsExtracted={() => refetch()} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default ProductDetail;
