import { useEffect, useMemo, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callAiProxy } from "@/utils/aiProxy";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { ScanText, Trash2, Search, Check, AlertTriangle, ChevronDown, ChevronRight, Filter, FileUp, Building2, Plus, HelpCircle, ArrowRight, Lightbulb, AlertCircle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { extractTableFromImageWithAnthropic } from "@/utils/anthropic";

// ── Types ──────────────────────────────────────────────────────────────────────

type GridRow = {
  id: string;
  cells: string[];
};

type ProductForMatch = {
  id: string;
  cod_intern: string | null;
  denumire_completa: string;
  unit: string | null;
  pret_lista?: number;
  supplier_id?: string | null;
};

// ── Helpers kept for product matching & price parsing ─────────────────────────

function normalizeMatchText(input: string): string {
  return input.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function getBrandFromName(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.includes("swisspor")) return "swisspor";
  if (lower.includes("baumit")) return "baumit";
  if (lower.includes("austrotherm")) return "austrotherm";
  if (lower.includes("hirsch")) return "hirsch";
  if (lower.includes("ceresit")) return "ceresit";
  if (lower.includes("brikston")) return "brikston";
  if (lower.includes("ytong")) return "ytong";
  if (lower.includes("porotherm")) return "porotherm";
  if (lower.includes("sika")) return "sika";
  if (lower.includes("isover")) return "isover";
  if (lower.includes("ursa")) return "ursa";
  if (lower.includes("knauf")) return "knauf";
  if (lower.includes("hasit")) return "hasit";
  if (lower.includes("weber")) return "weber";
  if (lower.includes("caparol")) return "caparol";
  if (lower.includes("maco")) return "maco";
  return null;
}

function matchKeywordsFromText(input: string): string[] {
  const norm = normalizeMatchText(input);
  // Treat 'x' flanked by digits as a dimensional separator (e.g. "1200x2500x3.5" → ["1200","2500","3","5"])
  // Also split on common separators: spaces, punctuation, 'x/X' between digits
  const withSplitX = norm.replace(/(\d)x(\d)/g, "$1 $2");
  const tokens = withSplitX.split(/[^a-z0-9]+/g).filter(Boolean);
  return Array.from(new Set(tokens.filter((t) => t.length >= 2)));
}

// Synonyms map for common abbreviations used in construction material names
const SYNONYMS: Record<string, string[]> = {
  "zn":    ["zincat", "zincare", "galvanizat"],
  "zincat":["zn"],
  "mp":    ["m2"],
  "ml":    ["m1", "ml"],
  "buc":   ["bucata", "bucati"],
  "grd":   ["gard"],
};

function expandSynonyms(tokens: string[]): string[] {
  const expanded = new Set(tokens);
  for (const t of tokens) {
    const syns = SYNONYMS[t];
    if (syns) syns.forEach((s) => expanded.add(s));
  }
  return Array.from(expanded);
}

function suggestProductsForName(name: string, products: ProductForMatch[], limit: number): { product: ProductForMatch; score: number }[] {
  const keywords = expandSynonyms(matchKeywordsFromText(name));
  if (keywords.length === 0) return [];
  const scored: { product: ProductForMatch; score: number; matchedLength: number }[] = [];
  for (const p of products) {
    const targetRaw = normalizeMatchText(`${p.denumire_completa} ${p.cod_intern || ""}`);
    // Also tokenize target with the same X-split so numbers like "1200" match regardless of separator style
    const targetTokens = expandSynonyms(matchKeywordsFromText(`${p.denumire_completa} ${p.cod_intern || ""}`));
    const targetStr = targetTokens.join(" ");

    // Forward score: how many import keywords match the DB product
    let fwdMatched = 0;
    let matchedLength = 0;
    for (const kw of keywords) {
      if (targetStr.includes(kw) || targetRaw.includes(kw)) {
        fwdMatched += 1;
        matchedLength += kw.length;
      }
    }
    const fwdScore = fwdMatched / keywords.length;

    // Reverse score: how many DB product tokens are covered by import keywords (handles long DB names)
    const dbKeywords = expandSynonyms(matchKeywordsFromText(`${p.denumire_completa}`));
    const importStr = keywords.join(" ");
    let revMatched = 0;
    for (const dk of dbKeywords) {
      if (importStr.includes(dk)) revMatched += 1;
    }
    const revScore = dbKeywords.length > 0 ? revMatched / dbKeywords.length : 0;

    // Combined score: weighted average favouring forward (import→DB) but boosted by reverse
    const score = fwdScore * 0.65 + revScore * 0.35;

    if (score < 0.45) continue;
    scored.push({ product: p, score, matchedLength });
  }
  scored.sort((a, b) => b.score - a.score || b.matchedLength - a.matchedLength);
  return scored.slice(0, Math.max(1, limit)).map((s) => ({ product: s.product, score: s.score }));
}

function parsePriceCell(text: string): number | null {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(/,(?=\d{3}(\D|$))/g, "");
  const normalized = cleaned.includes(",") && !cleaned.includes(".") ? cleaned.replace(",", ".") : cleaned;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function guessNameColumnIndex(headerCells: string[]): number {
  const nameKeywords = ["denumire", "produs", "material", "articol", "descriere", "name", "description", "item"];
  for (let i = 0; i < headerCells.length; i++) {
    const h = normalizeMatchText(headerCells[i]);
    if (nameKeywords.some((kw) => h.includes(kw))) return i;
  }
  let bestIdx = 0;
  let bestLen = 0;
  for (let i = 0; i < headerCells.length; i++) {
    const len = headerCells[i].length;
    if (len > bestLen) { bestLen = len; bestIdx = i; }
  }
  return bestIdx;
}

function guessPriceColumnIndex(headerCells: string[]): number {
  const priceKeywords = ["pret", "price", "tarif", "lei", "eur", "ron", "pv", "pvp", "cost", "valoare"];
  for (let i = 0; i < headerCells.length; i++) {
    const h = normalizeMatchText(headerCells[i]);
    if (priceKeywords.some((kw) => h.includes(kw))) return i;
  }
  return Math.max(0, headerCells.length - 1);
}

// Try to read a minimum quantity from a price-column header like "1-2PAL", "3-4 paleti", "5+", "peste 5"
function parseMinQuantityFromHeader(header: string): number {
  const h = (header || "").toLowerCase();
  const peste = h.match(/(?:peste|>=?|\+)\s*(\d+)/) || h.match(/(\d+)\s*\+/);
  if (peste) return Math.max(1, Number(peste[1]) || 1);
  const range = h.match(/(\d+)\s*[-–]\s*\d+/);
  if (range) return Math.max(1, Number(range[1]) || 1);
  const single = h.match(/\d+/);
  if (single) return Math.max(1, Number(single[0]) || 1);
  return 1;
}

// Detect every column that looks like a price column (mostly numeric body cells),
// so multi-tier price lists (1-2PAL / 3-4PAL / 5+PAL) are mapped automatically.
function detectPriceColumns(headerCells: string[], bodyRows: string[][]): number[] {
  const sample = bodyRows.slice(0, 20);
  const result: number[] = [];
  for (let i = 0; i < headerCells.length; i++) {
    let numeric = 0;
    let nonEmpty = 0;
    for (const row of sample) {
      const cell = (row[i] ?? "").toString().trim();
      if (!cell) continue;
      nonEmpty++;
      if (parsePriceCell(cell) !== null) numeric++;
    }
    // A price column has enough non-empty numeric values (≥60%)
    if (nonEmpty >= 2 && numeric / nonEmpty >= 0.6) result.push(i);
  }
  return result;
}

// ── Inline Product Search ─────────────────────────────────────────────────────

function InlineProductSearch({
  rowId,
  selectedProductId,
  suggestions,
  productsById,
  onSelect,
  onClear,
  importedName,
}: {
  rowId: string;
  selectedProductId: string | null;
  suggestions: string[];
  productsById: Map<string, ProductForMatch>;
  onSelect: (productId: string) => void;
  onClear: () => void;
  importedName: string;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");

  const { data: searchResults = [] } = useQuery({
    queryKey: ["product-search-inline", searchText],
    queryFn: async () => {
      if (searchText.length < 2) return [];
      let query = supabase
        .from("products")
        .select("id, cod_intern, denumire_completa, unit, pret_lista")
        .order("denumire_completa")
        .limit(10);
      
      const tokens = searchText.split(/\s+/).filter(Boolean);
      for (const raw of tokens) {
        const token = raw.replace(/,/g, "\\,");
        query = query.or(`denumire_completa.ilike.%${token}%,cod_intern.ilike.%${token}%,brand.ilike.%${token}%,brand_slug.ilike.%${token}%`);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data as ProductForMatch[];
    },
    enabled: searchOpen && searchText.length >= 2,
  });

  const selectedProduct = selectedProductId ? productsById.get(selectedProductId) : null;

  if (selectedProduct) {
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        <Badge variant="outline" className="shrink-0 text-xs border-green-500/30 text-green-700 bg-green-50">
          <Check className="h-3 w-3 mr-0.5" />
          {selectedProduct.cod_intern || "?"}
        </Badge>
        <span className="text-xs truncate text-muted-foreground">{selectedProduct.denumire_completa}</span>
        <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={onClear}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  if (!searchOpen) {
    return (
      <div className="flex items-center gap-1.5">
        {suggestions.filter((pid) => pid && productsById.has(pid)).length > 0 ? (
          <Select onValueChange={(v) => onSelect(v)}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder={`${suggestions.filter((pid) => pid && productsById.has(pid)).length} sugestii...`} />
            </SelectTrigger>
            <SelectContent>
              {suggestions.filter((pid) => pid && productsById.has(pid)).map((pid) => {
                const p = productsById.get(pid)!;
                return (
                  <SelectItem key={pid} value={pid} className="text-xs">
                    <span className="font-mono text-primary">{p.cod_intern}</span> — {p.denumire_completa}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground italic">Nepotrivit</span>
        )}
        <Button variant="outline" size="icon" className="h-7 w-7 shrink-0" onClick={() => { setSearchOpen(true); setSearchText(importedName.slice(0, 30)); }}>
          <Search className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        <Input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Caută produs..."
          className="h-7 text-xs"
          autoFocus
        />
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setSearchOpen(false)}>✕</Button>
      </div>
      {searchResults.length > 0 && (
        <div className="border rounded-md max-h-40 overflow-auto">
          {searchResults.map((p) => (
            <button
              key={p.id}
              onClick={() => { onSelect(p.id); setSearchOpen(false); }}
              className="w-full text-left px-2 py-1.5 text-xs hover:bg-accent/10 border-b last:border-b-0"
            >
              <span className="font-mono text-primary">{p.cod_intern}</span> — {p.denumire_completa}
              <span className="text-muted-foreground ml-1">({Number(p.pret_lista || 0).toFixed(2)} lei/{p.unit || "buc"})</span>
            </button>
          ))}
        </div>
      )}
      {searchText.length >= 2 && searchResults.length === 0 && (
        <p className="text-xs text-muted-foreground">Niciun rezultat</p>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

// API keys are handled server-side via the secure `ai-proxy` edge function.


function convertToGeminiSchema(schema: any): any {
  if (!schema) return schema;
  if (Array.isArray(schema)) {
    return schema.map(item => convertToGeminiSchema(item));
  }
  if (typeof schema === "object") {
    const newSchema = { ...schema };
    if (typeof newSchema.type === "string") {
      newSchema.type = newSchema.type.toUpperCase();
    }
    delete newSchema.additionalProperties;
    
    if (newSchema.properties) {
      const newProps: any = {};
      for (const key of Object.keys(newSchema.properties)) {
        newProps[key] = convertToGeminiSchema(newSchema.properties[key]);
      }
      newSchema.properties = newProps;
    }
    if (newSchema.items) {
      newSchema.items = convertToGeminiSchema(newSchema.items);
    }
    return newSchema;
  }
  return schema;
}

async function analyzeExcelWithAnthropic(
  rows: string[][],
  filename: string,
  supplierColumnMap: Record<string, string> | null
): Promise<{ success: boolean; headers?: string[]; header_row_index?: number; column_map?: any; note?: string; error?: string }> {
  const truncated = rows.slice(0, 50);
  
  let supplierHint = "";
  if (supplierColumnMap && Object.keys(supplierColumnMap).length > 0) {
    supplierHint = `\n\nProfil furnizor cunoscut (mapping coloane din importuri anterioare): ${JSON.stringify(supplierColumnMap)}. Folosește acest profil ca referință pentru a identifica coloanele, dar verifică dacă se potrivește cu datele actuale.`;
  }

  const systemPrompt = `Ești expert în structurarea datelor din fișiere Excel de liste de prețuri pentru materiale de construcții din România.
Primești o matrice 2D de strings extrasă din primele rânduri ale unui fișier Excel.
Sarcina ta: identifică indexul rândului de antet (0-based) și returnează acest index, împreună cu denumirile coloanelor din antet și maparea acestor coloane (column_map).
IMPORTANT: Identifică și returnează un column_map care specifică ce coloană corespunde fiecărui tip de informație (denumire, pret, um, cod_furnizor, cantitate_palet, consum, etc.).
Nu mai este nevoie să returnezi datele (rândurile). Vrem doar structura.`;

  const userPrompt = `Fișier: ${filename}\nDate brute (primele ${truncated.length} rânduri):\n${JSON.stringify(truncated)}\n\nIdentifică structura, antetul și returnează header_row_index, headers și column_map.${supplierHint}`;

  const toolSchema = {
    name: "extract_price_table",
    description: "Structured extraction of a price list table from Excel data with column mapping",
    input_schema: {
      type: "object",
      properties: {
        header_row_index: { type: "number", description: "0-based index of the header row in the provided raw rows" },
        headers: { type: "array", items: { type: "string" }, description: "Column names from the header row" },
        column_map: {
          type: "object",
          properties: {
            denumire: { type: "number", description: "Index (0-based) of the product name column" },
            pret: { type: "number", description: "Index of the price column" },
            um: { type: "number", description: "Index of the unit of measure column, or -1 if not present" },
            cod_furnizor: { type: "number", description: "Index of the supplier product code column, or -1 if not present" },
            cantitate_palet: { type: "number", description: "Index of pallet quantity column, or -1 if not present" },
            consum: { type: "number", description: "Index of consumption column, or -1 if not present" }
          },
          description: "Mapping of semantic columns to their 0-based index in headers. Use -1 if column not found."
        },
        note: { type: "string", description: "Optional: observation about data quality" }
      },
      required: ["header_row_index", "headers", "column_map"]
    }
  };

  // 1. Încercăm cu Anthropic prin proxy-ul securizat
  try {
    const { ok, status, data } = await callAiProxy("anthropic", {
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      tools: [toolSchema],
      tool_choice: { type: "tool", name: "extract_price_table" }
    });

    if (ok) {
      const toolCall = data.content?.find((c: any) => c.type === "tool_use" && c.name === "extract_price_table");
      if (toolCall?.input) {
        const input = toolCall.input;
        return {
          success: true,
          headers: input.headers,
          header_row_index: input.header_row_index,
          column_map: input.column_map,
          note: input.note
        };
      }
    } else {
      console.warn("Anthropic API returned error in Excel analysis, falling back to Gemini:", status, data);
    }
  } catch (err) {
    console.warn("Anthropic Excel analysis failed, trying Gemini fallback...", err);
  }

  // 2. Fallback la Google Gemini prin proxy
  try {
    const { ok, status, data } = await callAiProxy("gemini", {
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }]
        }
      ],
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      generationConfig: {
        responseMimeType: "application/json"
      }
    });

    if (!ok) {
      throw new Error(`Eroare API Gemini (${status}): ${data?.error || ""}`);
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error("Modelul Gemini nu a returnat date structurate valabile.");
    }

    const input = JSON.parse(text.trim());
    return {
      success: true,
      headers: input.headers,
      header_row_index: input.header_row_index,
      column_map: input.column_map,
      note: input.note
    };
  } catch (geminiErr: any) {
    console.error("Gemini Excel analysis fallback failed:", geminiErr);
    return { success: false, error: `Eroare analiză Excel. Gemini: ${geminiErr.message}` };
  }
}

const ImportOcr = () => {
  const queryClient = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string>("");
  const [lang, setLang] = useState<"eng" | "ron">("ron");
  const [ocrRunning, setOcrRunning] = useState(false);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excelRunning, setExcelRunning] = useState(false);

  // Supplier state
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [newSupplierName, setNewSupplierName] = useState("");
  const [creatingSupplier, setCreatingSupplier] = useState(false);

  // Multi-sheet state
  const [excelSheetNames, setExcelSheetNames] = useState<string[]>([]);
  const [selectedSheetName, setSelectedSheetName] = useState<string>("");
  const [excelWorkbook, setExcelWorkbook] = useState<any>(null);

  // AI column_map state
  const [aiColumnMap, setAiColumnMap] = useState<Record<string, number> | null>(null);
  const [categoryRows, setCategoryRows] = useState<{ row_index: number; category_name: string }[]>([]);

  const [gridRows, setGridRows] = useState<GridRow[]>([]);
  const [headerRowIndex, setHeaderRowIndex] = useState(0);

  const [matchNameColIdx, setMatchNameColIdx] = useState<number>(0);
  const [suggestionsByRowId, setSuggestionsByRowId] = useState<Record<string, string[]>>({});
  const [matchedProductIdByRowId, setMatchedProductIdByRowId] = useState<Record<string, string | null>>({});
  const [createProductRowId, setCreateProductRowId] = useState<string | null>(null);
  const [createProductName, setCreateProductName] = useState("");
  const [createProductCodIntern, setCreateProductCodIntern] = useState("");
  const [createProductUnit, setCreateProductUnit] = useState("");
  const [createProductRunning, setCreateProductRunning] = useState(false);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [showOnlyUnmatched, setShowOnlyUnmatched] = useState(false);

  const [priceMappings, setPriceMappings] = useState<{ id: string; colIdx: number; priceType: string; minQuantity: number }[]>([
    { id: "default", colIdx: 0, priceType: "Preț listă", minQuantity: 1 }
  ]);
  const [priceOverridesByRowId, setPriceOverridesByRowId] = useState<Record<string, string>>({});
  const [savePricesOpen, setSavePricesOpen] = useState(false);
  const [savePricesRunning, setSavePricesRunning] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: productsForMatch = [] } = useQuery({
    queryKey: ["products-for-ocr-match"],
    queryFn: async () => {
      // Supabase returns max 1000 rows per request — paginate to load the full catalog
      const pageSize = 1000;
      const all: ProductForMatch[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("products")
          .select("id, cod_intern, denumire_completa, unit, pret_lista, supplier_id")
          .order("id")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...(data as ProductForMatch[]));
        if (data.length < pageSize) break;
      }
      return all;
    },
  });

  const { data: suppliers = [], refetch: refetchSuppliers } = useQuery({
    queryKey: ["suppliers-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("id, name, ai_column_map, notes, updated_at").order("name");
      if (error) throw error;
      return data as { id: string; name: string; ai_column_map: Record<string, string> | null; notes: string | null; updated_at: string }[];
    },
  });

  const selectedSupplier = useMemo(() => suppliers.find((s) => s.id === selectedSupplierId), [suppliers, selectedSupplierId]);


  // ── Derived state ──────────────────────────────────────────────────────────

  const headerCells = useMemo(() => {
    const row = gridRows[headerRowIndex];
    return row ? row.cells : [];
  }, [gridRows, headerRowIndex]);

  const bodyRows = useMemo(() => gridRows.filter((_, idx) => idx !== headerRowIndex), [gridRows, headerRowIndex]);

  const matchedCount = useMemo(() => bodyRows.filter((r) => matchedProductIdByRowId[r.id]).length, [bodyRows, matchedProductIdByRowId]);

  const filteredRows = useMemo(() => {
    if (!showOnlyUnmatched) return bodyRows;
    return bodyRows.filter((r) => !matchedProductIdByRowId[r.id]);
  }, [bodyRows, showOnlyUnmatched, matchedProductIdByRowId]);

  const matchedProductIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of Object.values(matchedProductIdByRowId)) { if (id) ids.add(id); }
    return Array.from(ids);
  }, [matchedProductIdByRowId]);


  const productsById = useMemo(() => {
    const map = new Map<string, ProductForMatch>();
    for (const p of productsForMatch) map.set(p.id, p);
    return map;
  }, [productsForMatch]);

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const max = Math.max(0, headerCells.length - 1);
    setMatchNameColIdx((v) => Math.max(0, Math.min(max, v)));
    setPriceMappings(prev => prev.map(m => ({ ...m, colIdx: Math.max(0, Math.min(max, m.colIdx)) })));
  }, [headerCells.length]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const fileToBase64 = async (f: File): Promise<string> => {
    const buf = await f.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  };

  const resetTableState = () => {
    setGridRows([]); setHeaderRowIndex(0);
    setSuggestionsByRowId({}); setMatchedProductIdByRowId({});
    setPriceMappings([{ id: "default", colIdx: 0, priceType: "Preț listă", minQuantity: 1 }]);
    setSavePricesOpen(false);
    setAiColumnMap(null); setCategoryRows([]);
  };

  const createSupplier = async () => {
    const name = newSupplierName.trim();
    if (!name) return;
    setCreatingSupplier(true);
    try {
      const { data, error } = await supabase.from("suppliers").insert({ name }).select("id").single();
      if (error) throw error;
      if (data?.id) { setSelectedSupplierId(data.id); setNewSupplierName(""); await refetchSuppliers(); toast.success(`Furnizor "${name}" creat`); }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Eroare la creare furnizor"); }
    finally { setCreatingSupplier(false); }
  };

  const loadAiResult = (headers: string[], rows: string[][], note?: string | null, columnMap?: Record<string, number> | null, catRows?: { row_index: number; category_name: string }[]) => {
    if (headers.length === 0) { toast.error("Nu s-a identificat niciun tabel"); return; }
    const headerRow: GridRow = { id: crypto.randomUUID(), cells: headers };
    const bodyGridRows: GridRow[] = rows.map((cells) => ({ id: crypto.randomUUID(), cells }));
    setGridRows([headerRow, ...bodyGridRows]);
    setHeaderRowIndex(0);

    // Use AI column_map if available, otherwise guess
    const nameIdx = columnMap?.denumire != null && columnMap.denumire >= 0 ? columnMap.denumire : guessNameColumnIndex(headers);
    const priceIdx = columnMap?.pret != null && columnMap.pret >= 0 ? columnMap.pret : guessPriceColumnIndex(headers);
    setMatchNameColIdx(nameIdx);

    // Auto-detect ALL price columns (multi-tier price lists: 1-2PAL / 3-4PAL / 5+PAL).
    // Exclude the name column from candidates.
    const detected = detectPriceColumns(headers, rows).filter((i) => i !== nameIdx);
    const priceCols = detected.length > 0 ? detected : [priceIdx];
    const newMappings = priceCols.map((colIdx, i) => ({
      id: crypto.randomUUID(),
      colIdx,
      // The first (smallest-quantity) tier becomes the base "Preț listă"
      priceType: i === 0 ? "Preț listă" : (headers[colIdx]?.trim() || `Preț ${i + 1}`),
      minQuantity: parseMinQuantityFromHeader(headers[colIdx] || ""),
    }));
    setPriceMappings(newMappings);
    if (priceCols.length > 1) {
      toast.info(`${priceCols.length} coloane de preț detectate — toate vor fi salvate ca tipuri de preț distincte.`);
    }

    if (columnMap) setAiColumnMap(columnMap);
    if (catRows && catRows.length > 0) {
      setCategoryRows(catRows);
      toast.info(`${catRows.length} categorii detectate în tabel`);
    }

    if (note) toast.info(note);
    setTimeout(() => {
      if (productsForMatch.length > 0 && bodyGridRows.length > 0)
        runAutoMatch(bodyGridRows, nameIdx, productsForMatch, columnMap || null);
    }, 100);
  };

  const saveSupplierColumnMap = async (columnMap: Record<string, number>) => {
    if (!selectedSupplierId) return;
    try {
      await supabase.from("suppliers").update({ ai_column_map: columnMap }).eq("id", selectedSupplierId);
      await refetchSuppliers();
    } catch { /* silent */ }
  };

  const runImageOcr = async () => {
    if (!file || ocrRunning) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Imaginea depășește 5 MB — comprimă-o înainte"); return; }
    setOcrRunning(true);
    resetTableState();
    try {
      const base64 = await fileToBase64(file);
      
      // 1. Încercăm prin funcția edge Supabase
      try {
        const { data, error } = await supabase.functions.invoke("ai-product-info", {
          body: { action: "ocr-image", image_base64: base64, mime_type: file.type || "image/jpeg" }
        });
        if (error) throw new Error(error.message);
        if (!data?.success) throw new Error(data?.error || "Extragere eșuată");
        loadAiResult(data.headers, data.rows, data.note);
        toast.success(`${data.rows.length} rânduri extrase din imagine`);
      } catch (edgeErr) {
        console.warn("Funcția edge OCR a eșuat, încercăm fallback direct din browser...", edgeErr);
        
        // 2. Fallback direct din browser (care are fallback-ul Gemini integrat)
        const data = await extractTableFromImageWithAnthropic(base64, file.type || "image/jpeg", "price_list");
        loadAiResult(data.headers, data.rows, null);
        toast.success(`${data.rows.length} rânduri extrase direct din browser (Gemini)`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Eroare scanare imagine");
    } finally {
      setOcrRunning(false);
    }
  };

  const handleExcelFileSelect = async (f: File) => {
    setExcelFile(f);
    setExcelSheetNames([]);
    setSelectedSheetName("");
    setExcelWorkbook(null);
    try {
      const XLSX = await import("xlsx");
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      setExcelWorkbook(wb);
      setExcelSheetNames(wb.SheetNames);
      setSelectedSheetName(wb.SheetNames[0] || "");
      if (wb.SheetNames.length > 1) toast.info(`${wb.SheetNames.length} foi detectate — selectează foaia dorită`);
    } catch { /* will be caught on import */ }
  };

  const runExcelImport = async (sheetOverride?: string) => {
    if (!excelFile || excelRunning) return;
    setExcelRunning(true);
    resetTableState();
    try {
      const XLSX = await import("xlsx");
      const wb = excelWorkbook || (() => { throw new Error("Workbook not loaded"); })();
      const sheetName = sheetOverride || selectedSheetName || wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      if (!sheet) { toast.error(`Foaia "${sheetName}" nu există`); setExcelRunning(false); return; }
      const rawRows: string[][] = (XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" }) as unknown[][])
        .map((r) => (r as unknown[]).map((c) => String(c ?? "")));
      if (rawRows.length === 0) { toast.error("Foaia nu conține date"); setExcelRunning(false); return; }

      const supplierColumnMap = selectedSupplier?.ai_column_map || null;
      const data = await analyzeExcelWithAnthropic(rawRows, excelFile.name, supplierColumnMap);
      
      if (!data?.success) throw new Error(data?.error || "Procesare eșuată");

      const headerRowIndex = data.header_row_index || 0;
      const dataRows = rawRows.slice(headerRowIndex + 1);
      
      const headersLength = data.headers.length;
      const normalizedRows = dataRows.map(row => {
        const padded = [...row];
        while (padded.length < headersLength) padded.push("");
        return padded.slice(0, headersLength);
      });

      const validRows = normalizedRows.filter(row => row.some(cell => cell.trim() !== ""));

      loadAiResult(data.headers, validRows, data.note, data.column_map, []);

      // Auto-save column_map to supplier if first import
      if (data.column_map && selectedSupplierId && (!supplierColumnMap || Object.keys(supplierColumnMap).length === 0)) {
        await saveSupplierColumnMap(data.column_map);
        toast.info("Profilul furnizorului a fost salvat automat");
      }

      toast.success(`${validRows.length} rânduri importate din "${sheetName}"`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Eroare import Excel"); }
    finally { setExcelRunning(false); }
  };

  const runAutoMatch = useCallback((rows: GridRow[], nameColIdx: number, products: ProductForMatch[], columnMap: Record<string, number> | null) => {
    if (rows.length === 0 || products.length === 0) return;
    const nextSuggestions: Record<string, string[]> = {};
    const nextMatched: Record<string, string | null> = {};

    const supplierNameText = selectedSupplier?.name || newSupplierName || "";
    const importBrand = getBrandFromName(supplierNameText);

    const validProducts = products.filter(p => {
      if (p.supplier_id && selectedSupplierId && p.supplier_id !== selectedSupplierId) return false;
      const productBrand = getBrandFromName(p.denumire_completa);
      if (productBrand && importBrand && productBrand !== importBrand) return false;
      return true; 
    });

    for (const r of rows) {
      const name = (r.cells[nameColIdx] || "").trim();
      let codeToMatch = "";
      if (columnMap?.cod_furnizor != null && columnMap.cod_furnizor >= 0) {
        codeToMatch = (r.cells[columnMap.cod_furnizor] || "").trim();
      }
      
      if (!name && !codeToMatch) continue;

      let results: { product: ProductForMatch; score: number }[] = [];
      
      if (codeToMatch) {
         const exactMatch = validProducts.find(p => p.cod_intern === codeToMatch);
         if (exactMatch) {
            results = [{ product: exactMatch, score: 1 }];
         }
      }

      if (results.length === 0 && name) {
          const textToSearch = codeToMatch ? `${name} ${codeToMatch}` : name;
          results = suggestProductsForName(textToSearch, validProducts, 5);
      }

      if (results.length > 0) {
        nextSuggestions[r.id] = results.map((s) => s.product.id);
        // Auto-confirm if best score is high enough; 0.75 covers cases where DB has longer/richer names
        if (results[0].score >= 0.75) nextMatched[r.id] = results[0].product.id;
      }
    }
    setSuggestionsByRowId(nextSuggestions);
    setMatchedProductIdByRowId(nextMatched);
    const autoCount = Object.values(nextMatched).filter(Boolean).length;
    toast.success(`Potrivire automată: ${autoCount}/${rows.length} rânduri`);
  }, [selectedSupplierId, selectedSupplier?.name, newSupplierName]);

  const setMatchedProductForRow = (rowId: string, productId: string | null) => {
    setMatchedProductIdByRowId((prev) => ({ ...prev, [rowId]: productId }));
  };

  const openCreateProduct = (row: GridRow) => {
    setCreateProductRowId(row.id);
    setCreateProductName((row.cells[matchNameColIdx] || "").trim());
    setCreateProductCodIntern(`OCR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`);
    setCreateProductUnit("");
  };

  const createProduct = async () => {
    if (!createProductRowId) return;
    const name = createProductName.trim();
    const cod = createProductCodIntern.trim();
    const unit = createProductUnit.trim();
    if (!name) { toast.error("Denumirea este obligatorie"); return; }
    if (!cod) { toast.error("Cod intern este obligatoriu"); return; }
    if (createProductRunning) return;
    setCreateProductRunning(true);
    try {
      const { data, error } = await supabase.from("products").insert({ cod_intern: cod, denumire_completa: name, unit: unit || null, pret_lista: 0, supplier_id: selectedSupplierId || null }).select("id").single();
      if (error) throw error;
      if (!data?.id) throw new Error("Eroare la creare produs");
      setMatchedProductForRow(createProductRowId, data.id);
      await queryClient.invalidateQueries({ queryKey: ["products-for-ocr-match"] });
      toast.success("Produs creat");
      setCreateProductRowId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Eroare la creare produs");
    } finally {
      setCreateProductRunning(false);
    }
  };

  const ensurePriceOverrides = () => {
    if (bodyRows.length === 0) return;
    setPriceOverridesByRowId((prev) => {
      const next = { ...prev };
      const defaultMapping = priceMappings.find(m => m.priceType.toLowerCase() === "preț listă" || m.priceType.toLowerCase() === "pret lista") || priceMappings[0];
      if (!defaultMapping) return prev;
      for (const r of bodyRows) {
        const cell = r.cells[defaultMapping.colIdx] || "";
        const parsed = parsePriceCell(cell);
        if (parsed === null) continue;
        if (typeof next[r.id] === "string" && next[r.id].trim() !== "") continue;
        next[r.id] = parsed.toString();
      }
      return next;
    });
  };

  const updateCatalogPrices = async () => {
    if (savePricesRunning) return;
    setSavePricesRunning(true);
    
    try {
      const productIdsToInvalidate = new Set<string>();

      for (const mapping of priceMappings) {
        const productIdsForThisMapping = [];
        const insertsForThisMapping = [];
        
        for (const r of bodyRows) {
          const productId = matchedProductIdByRowId[r.id];
          if (!productId) continue;
          
          const raw = r.cells[mapping.colIdx] || "";
          const parsed = parsePriceCell(raw);
          if (parsed === null) continue;
          
          productIdsForThisMapping.push(productId);
          productIdsToInvalidate.add(productId);
          
          insertsForThisMapping.push({
            product_id: productId,
            supplier_id: selectedSupplierId || null,
            price_type: mapping.priceType,
            price: parsed,
            currency: "RON",
            min_quantity: mapping.minQuantity,
          });
        }
        
        if (productIdsForThisMapping.length > 0) {
          const isBasePrice = mapping.priceType.toLowerCase() === "preț listă" || mapping.priceType.toLowerCase() === "pret lista";
          if (isBasePrice) {
            for (const insert of insertsForThisMapping) {
              await supabase.from("products").update({ pret_lista: insert.price }).eq("id", insert.product_id);
            }
          }
          
          let query = supabase.from("product_prices").update({ valid_to: new Date().toISOString() })
            .in("product_id", productIdsForThisMapping).eq("price_type", mapping.priceType).is("valid_to", null);
          if (selectedSupplierId) query = query.eq("supplier_id", selectedSupplierId);
          else query = query.is("supplier_id", null);
          await query;
          
          await supabase.from("product_prices").insert(insertsForThisMapping);
        }
      }

      toast.success(`Catalog actualizat cu succes pentru mapările definite.`);
      setSavePricesOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["products-for-ocr-match"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Eroare la actualizare catalog");
    } finally {
      setSavePricesRunning(false);
    }
  };

  const bulkUpdateCatalog = async () => {
    if (bulkRunning) return;
    setBulkRunning(true);

    try {
      const unmatchedRows = bodyRows.filter((r) => !matchedProductIdByRowId[r.id]);
      const freshMatched: Record<string, string> = {};

      const defaultMapping = priceMappings.find(m => m.priceType.toLowerCase() === "preț listă" || m.priceType.toLowerCase() === "pret lista") || priceMappings[0];
      if (!defaultMapping) { toast.error("Trebuie să definești cel puțin o mapare de preț"); setBulkRunning(false); return; }

      for (const r of unmatchedRows) {
        const denumire = (r.cells[matchNameColIdx] || "").trim();
        if (!denumire) continue;
        const pretRaw = (r.cells[defaultMapping.colIdx] || "").toString();
        const pretLista = parsePriceCell(pretRaw) ?? 0;
        const cod = `IMP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        
        const extraItem: Record<string, string | undefined> = {};
        if (aiColumnMap?.cod_furnizor != null && aiColumnMap.cod_furnizor >= 0) extraItem.cod_furnizor = (r.cells[aiColumnMap.cod_furnizor] || "").trim() || undefined;
        if (aiColumnMap?.cantitate_palet != null && aiColumnMap.cantitate_palet >= 0) extraItem.cantitate_palet = (r.cells[aiColumnMap.cantitate_palet] || "").trim() || undefined;
        if (aiColumnMap?.consum != null && aiColumnMap.consum >= 0) extraItem.consum = (r.cells[aiColumnMap.consum] || "").trim() || undefined;
        const grile_pret = Object.keys(extraItem).length > 0 ? extraItem : null;

        const { data: newProd, error: prodErr } = await supabase
          .from("products")
          .insert({ cod_intern: cod, denumire_completa: denumire, pret_lista: pretLista, unit: null, supplier_id: selectedSupplierId || null, grile_pret })
          .select("id")
          .single();
        if (prodErr) { toast.error(`Eroare la creare "${denumire}": ${prodErr.message}`); continue; }
        if (newProd?.id) freshMatched[r.id] = newProd.id;
      }

      const allMatched = { ...matchedProductIdByRowId, ...freshMatched };
      setMatchedProductIdByRowId(allMatched);
      
      for (const mapping of priceMappings) {
        const productIdsForThisMapping = [];
        const insertsForThisMapping = [];
        const basePriceUpdates = [];
        
        for (const r of bodyRows) {
          const productId = allMatched[r.id];
          if (!productId) continue; 
          
          const raw = (r.cells[mapping.colIdx] || "").toString();
          const parsed = parsePriceCell(raw);
          if (parsed === null) continue;
          
          productIdsForThisMapping.push(productId);
          insertsForThisMapping.push({
            product_id: productId,
            supplier_id: selectedSupplierId || null,
            price_type: mapping.priceType,
            price: parsed,
            currency: "RON",
            min_quantity: mapping.minQuantity,
          });

          if (!freshMatched[r.id]) {
            basePriceUpdates.push({ id: productId, price: parsed });
          }
        }
        
        if (productIdsForThisMapping.length > 0) {
          const isBasePrice = mapping.priceType.toLowerCase() === "preț listă" || mapping.priceType.toLowerCase() === "pret lista";
          if (isBasePrice) {
            for (const upd of basePriceUpdates) {
              await supabase.from("products").update({ pret_lista: upd.price }).eq("id", upd.id);
            }
          }
          
          let query = supabase.from("product_prices").update({ valid_to: new Date().toISOString() })
            .in("product_id", productIdsForThisMapping).eq("price_type", mapping.priceType).is("valid_to", null);
          if (selectedSupplierId) query = query.eq("supplier_id", selectedSupplierId);
          else query = query.is("supplier_id", null);
          await query;
          
          await supabase.from("product_prices").insert(insertsForThisMapping);
        }
      }

      const newCount = Object.keys(freshMatched).length;
      toast.success(`Catalog actualizat cu succes${newCount > 0 ? ` (${newCount} produse noi)` : ""}`);
      await queryClient.invalidateQueries({ queryKey: ["products-for-ocr-match"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Eroare la actualizare catalog");
    } finally {
      setBulkRunning(false);
    }
  };

  const updateCell = (rowId: string, colIndex: number, value: string) => {
    setGridRows((prev) => prev.map((r) => r.id !== rowId ? r : { ...r, cells: r.cells.map((c, i) => i === colIndex ? value : c) }));
  };

  const deleteColumn = (colIndex: number) => {
    if (headerCells.length <= 1) { toast.error("Tabelul trebuie să aibă cel puțin o coloană."); return; }
    setGridRows((prev) => prev.map((r) => ({ ...r, cells: r.cells.filter((_, i) => i !== colIndex) })));
    const adjust = (idx: number) => idx === colIndex ? 0 : idx > colIndex ? idx - 1 : idx;
    setMatchNameColIdx(adjust);
    setPriceMappings(prev => prev.map(m => ({ ...m, colIdx: adjust(m.colIdx) })));
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>, startRowIdx: number, startColIdx: number) => {
    const text = e.clipboardData.getData("text");
    if (!text || (!text.includes("\t") && !text.includes("\n"))) return;
    e.preventDefault();
    const pastedRows = text.split(/\r?\n/).filter((line) => line.length > 0).map((row) => row.split("\t"));
    setGridRows((prev) => {
      const next = [...prev];
      for (let r = 0; r < pastedRows.length; r++) {
        const ti = startRowIdx + r;
        if (ti >= next.length) break;
        const row = { ...next[ti] };
        const cells = [...row.cells];
        for (let c = 0; c < pastedRows[r].length; c++) {
          const tc = startColIdx + c;
          if (tc >= cells.length) break;
          cells[tc] = pastedRows[r][c];
        }
        row.cells = cells;
        next[ti] = row;
      }
      return next;
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-6xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Import OCR/Excel</h1>
            <p className="text-sm text-muted-foreground">Încarcă imagine sau Excel, potrivește produse și salvează prețuri</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setHelpOpen(true)}
            className="gap-1.5 shrink-0 border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
          >
            <HelpCircle className="h-4 w-4" />
            <span className="hidden sm:inline">Cum funcționează?</span>
          </Button>
        </div>

        {/* ── Help Guide Dialog ───────────────────────────────────────────── */}
        <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
          <DialogContent className="max-w-2xl max-h-[85vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">
                <HelpCircle className="h-5 w-5 text-blue-600" />
                Ghid: Importul de prețuri din Excel
              </DialogTitle>
              <DialogDescription>
                Urmează pașii de mai jos pentru a actualiza catalogul cu prețuri din fișierele Excel primite de la furnizori.
              </DialogDescription>
            </DialogHeader>

            <div className="overflow-y-auto max-h-[calc(85vh-120px)] pr-1">
              <div className="space-y-6 pb-4">

                {/* ── PASUL 1 ── */}
                <div className="rounded-lg border border-blue-100 bg-blue-50/30 p-4 space-y-3">
                  <h3 className="font-semibold text-base flex items-center gap-2">
                    <span className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-bold">1</span>
                    Furnizor &amp; Upload
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-start gap-2">
                      <Building2 className="h-4 w-4 mt-0.5 text-blue-600 shrink-0" />
                      <div><span className="font-medium">Selectează furnizorul</span> din dropdown-ul „Furnizor". Aceasta ajută sistemul să potrivească produsele corect.</div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Plus className="h-4 w-4 mt-0.5 text-blue-600 shrink-0" />
                      <div><span className="font-medium">Furnizor nou?</span> Scrie numele în câmpul „Sau creează nou" și apasă <strong>+</strong>.</div>
                    </div>
                    <div className="flex items-start gap-2">
                      <FileUp className="h-4 w-4 mt-0.5 text-blue-600 shrink-0" />
                      <div><span className="font-medium">Varianta A — Excel/CSV:</span> Încarcă fișierul (.xlsx, .csv) folosind butonul de upload. Dacă are mai multe foi, alege foaia dorită. Apoi apasă <strong>„Importă fișier"</strong>.</div>
                    </div>
                    <div className="flex items-start gap-2">
                      <ScanText className="h-4 w-4 mt-0.5 text-blue-600 shrink-0" />
                      <div><span className="font-medium">Varianta B — Imagine (OCR):</span> Încarcă o poză (PNG/JPG) cu lista de prețuri (ex: screenshot WhatsApp, scanare). Alege limba (RO/EN) și apasă <strong>„Scanează"</strong>. AI-ul va extrage tabelul din imagine.</div>
                    </div>
                    <div className="flex items-start gap-2">
                      <ArrowRight className="h-4 w-4 mt-0.5 text-blue-600 shrink-0" />
                      <div>Indiferent de variantă, AI-ul va analiza datele, va detecta coloanele (denumire, preț, UM) și va porni <strong>potrivirea automată</strong>. De aici, pașii sunt identici.</div>
                    </div>
                  </div>
                  <div className="rounded-md bg-blue-100/50 px-3 py-2 text-xs text-blue-800 flex items-start gap-2">
                    <Lightbulb className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>Selectează <strong>mereu</strong> furnizorul înainte de a importa fișierul. Badge-ul „Profil AI salvat" înseamnă că sistemul a memorat structura Excel-ului acestui furnizor.</span>
                  </div>
                </div>

                {/* ── PASUL 2 ── */}
                <div className="rounded-lg border border-emerald-100 bg-emerald-50/30 p-4 space-y-3">
                  <h3 className="font-semibold text-base flex items-center gap-2">
                    <span className="flex items-center justify-center w-7 h-7 rounded-full bg-emerald-600 text-white text-sm font-bold">2</span>
                    Tabel importat &amp; Potrivire produse
                  </h3>
                  <div className="text-sm space-y-2">
                    <p className="text-muted-foreground">După import, fiecare rând din Excel este comparat cu produsele din baza de date. Vei vedea:</p>
                    <div className="grid gap-2">
                      <div className="flex items-start gap-2 bg-white/70 rounded-md px-3 py-2 border">
                        <Badge variant="outline" className="shrink-0 text-xs border-green-500/30 text-green-700 bg-green-50 mt-0.5">
                          <Check className="h-3 w-3 mr-0.5" /> COD
                        </Badge>
                        <div><span className="font-medium text-green-700">Badge verde</span> — produsul a fost potrivit automat. Verifică dacă e corect; apasă 🗑️ pentru a desfaci.</div>
                      </div>
                      <div className="flex items-start gap-2 bg-white/70 rounded-md px-3 py-2 border">
                        <Badge variant="secondary" className="shrink-0 text-xs mt-0.5">3 sugestii</Badge>
                        <div><span className="font-medium">Dropdown cu sugestii</span> — sistemul a găsit câteva potriviri posibile. Deschide dropdown-ul și alege produsul corect.</div>
                      </div>
                      <div className="flex items-start gap-2 bg-white/70 rounded-md px-3 py-2 border">
                        <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />
                        <div><span className="font-medium text-orange-600">„Nepotrivit"</span> — folosește 🔍 (lupă) pentru căutare manuală, sau „+ Creează produs nou" pentru a-l adăuga în baza de date.</div>
                      </div>
                    </div>
                  </div>
                  <div className="text-sm space-y-1">
                    <p className="font-medium">Butoanele din această secțiune:</p>
                    <ul className="space-y-1 text-muted-foreground">
                      <li className="flex items-start gap-2"><ArrowRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-600" /><span><strong className="text-foreground">Coloană denumire</strong> — alege care coloană conține numele produsului (detectată automat).</span></li>
                      <li className="flex items-start gap-2"><ArrowRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-600" /><span><strong className="text-foreground">Potrivește automat</strong> — rerulează algoritmul de potrivire (util după corecturi).</span></li>
                      <li className="flex items-start gap-2"><ArrowRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-600" /><span><strong className="text-foreground">Doar nepotrivite / Toate</strong> — filtru ce ascunde rândurile deja potrivite.</span></li>
                    </ul>
                  </div>
                </div>

                {/* ── PASUL 3 ── */}
                <div className="rounded-lg border border-amber-100 bg-amber-50/30 p-4 space-y-3">
                  <h3 className="font-semibold text-base flex items-center gap-2">
                    <span className="flex items-center justify-center w-7 h-7 rounded-full bg-amber-600 text-white text-sm font-bold">3</span>
                    Prețuri &amp; Salvare
                  </h3>
                  <div className="text-sm space-y-2">
                    <p className="text-muted-foreground">Ultima secțiune — aici decizi ce prețuri se salvează în catalog:</p>
                    <ul className="space-y-2">
                      <li className="flex items-start gap-2">
                        <ArrowRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
                        <span><strong>Coloană preț</strong> — alege care coloană conține prețul (detectată automat, dar poți corecta).</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <ArrowRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
                        <span><strong>Preia prețuri</strong> — citește valorile numerice din coloana selectată. <em>Apasă înainte de salvare!</em></span>
                      </li>
                      <li className="flex items-start gap-2">
                        <ArrowRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
                        <span><strong>Actualizează Catalogul (doar potrivite)</strong> — salvează prețurile doar pentru rândurile cu produs selectat (✅ verde).</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <ArrowRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
                        <span><strong className="text-emerald-700">Butonul verde „Creează + Actualizează"</strong> — cel mai puternic: creează produse noi pentru TOATE rândurile nepotrivite ȘI actualizează prețurile.</span>
                      </li>
                    </ul>
                  </div>
                  <div className="rounded-md bg-amber-100/50 px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span><strong>Atenție la UM!</strong> Verifică dacă prețul din Excel este per aceeași unitate de măsură ca în baza de date (ex: per „mp" vs. per „buc").</span>
                  </div>
                </div>

                {/* ── Rezumat rapid ── */}
                <div className="rounded-lg border bg-muted/30 p-4">
                  <h3 className="font-semibold text-base mb-3">📋 Rezumat rapid — Ordinea pașilor</h3>
                  <ol className="space-y-1.5 text-sm">
                    <li className="flex items-center gap-2"><span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold shrink-0">1</span> Selectează furnizorul din dropdown</li>
                    <li className="flex items-center gap-2"><span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold shrink-0">2</span> Încarcă fișierul Excel (buton upload)</li>
                    <li className="flex items-center gap-2"><span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold shrink-0">3</span> Alege foaia Excel (dacă sunt mai multe)</li>
                    <li className="flex items-center gap-2"><span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold shrink-0">4</span> Apasă „Importă fișier" — AI-ul analizează</li>
                    <li className="flex items-center gap-2"><span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold shrink-0">5</span> Verifică potrivirile din coloana „Produs (DB)"</li>
                    <li className="flex items-center gap-2"><span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold shrink-0">6</span> Corectează: sugestii / căutare manuală / produs nou</li>
                    <li className="flex items-center gap-2"><span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold shrink-0">7</span> Verifică coloana de preț</li>
                    <li className="flex items-center gap-2"><span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold shrink-0">8</span> Apasă „Preia prețuri"</li>
                    <li className="flex items-center gap-2"><span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold shrink-0">9</span> Verifică tabelul de prețuri de jos</li>
                    <li className="flex items-center gap-2"><span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold shrink-0">10</span> Apasă „Actualizează Catalogul" sau butonul verde</li>
                  </ol>
                </div>

              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Supplier + Upload Section */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">1) Furnizor & Upload</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {/* Supplier selector */}
            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-[180px]">
                <Label className="text-xs flex items-center gap-1"><Building2 className="h-3 w-3" /> Furnizor</Label>
                <Select value={selectedSupplierId} onValueChange={setSelectedSupplierId}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Selectează furnizor..." /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-xs">{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-1 items-end flex-1 min-w-[180px]">
                <div className="flex-1">
                  <Label className="text-xs">Sau creează nou</Label>
                  <Input value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)} placeholder="Nume furnizor..." className="h-9 text-xs w-full" />
                </div>
                <Button variant="outline" size="sm" onClick={createSupplier} disabled={!newSupplierName.trim() || creatingSupplier} className="h-9">
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
              {selectedSupplier?.ai_column_map && Object.keys(selectedSupplier.ai_column_map).length > 0 && (
                <Badge variant="secondary" className="text-[10px]">Profil AI salvat</Badge>
              )}
            </div>

            {/* Image row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div className="md:col-span-2">
                <Label className="text-sm">Imagine (PNG/JPG) — WhatsApp sau scanare</Label>
                <Input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </div>
              <div className="flex gap-2 items-end">
                <Select value={lang} onValueChange={(v) => setLang(v as "eng" | "ron")}>
                  <SelectTrigger className="h-9 text-xs w-20"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ron">RO</SelectItem>
                    <SelectItem value="eng">EN</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={runImageOcr} disabled={!file || ocrRunning} className="gap-1.5">
                  <ScanText className="h-4 w-4" />{ocrRunning ? "Se analizează..." : "Scanează"}
                </Button>
              </div>
            </div>

            {/* Excel row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div className="md:col-span-2">
                <Label className="text-sm">Excel/CSV</Label>
                <Input type="file" accept=".xlsx,.xlsm,.csv,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleExcelFileSelect(f); else setExcelFile(null); }} />
              </div>
              <div className="flex gap-2 items-end">
                {excelSheetNames.length > 1 && (
                  <div className="min-w-[140px]">
                    <Label className="text-[10px]">Foaie Excel</Label>
                    <Select value={selectedSheetName} onValueChange={setSelectedSheetName}>
                      <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {excelSheetNames.map((sn) => (
                          <SelectItem key={sn} value={sn} className="text-xs">{sn}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Button variant="outline" onClick={() => runExcelImport()} disabled={!excelFile || excelRunning} className="gap-1.5">
                  <FileUp className="h-4 w-4" />{excelRunning ? "Se procesează..." : "Importă fișier"}
                </Button>
              </div>
            </div>

            {/* AI Column Map info */}
            {aiColumnMap && (
              <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1">
                <span className="font-medium">Coloane detectate AI:</span>
                {aiColumnMap.denumire != null && aiColumnMap.denumire >= 0 && <Badge variant="outline" className="text-[10px]">Denumire: col {aiColumnMap.denumire + 1}</Badge>}
                {aiColumnMap.pret != null && aiColumnMap.pret >= 0 && <Badge variant="outline" className="text-[10px]">Preț: col {aiColumnMap.pret + 1}</Badge>}
                {aiColumnMap.um != null && aiColumnMap.um >= 0 && <Badge variant="outline" className="text-[10px]">UM: col {aiColumnMap.um + 1}</Badge>}
                {aiColumnMap.cod_furnizor != null && aiColumnMap.cod_furnizor >= 0 && <Badge variant="outline" className="text-[10px]">Cod furnizor: col {aiColumnMap.cod_furnizor + 1}</Badge>}
                {aiColumnMap.cantitate_palet != null && aiColumnMap.cantitate_palet >= 0 && <Badge variant="outline" className="text-[10px]">Palet: col {aiColumnMap.cantitate_palet + 1}</Badge>}
                {aiColumnMap.consum != null && aiColumnMap.consum >= 0 && <Badge variant="outline" className="text-[10px]">Consum: col {aiColumnMap.consum + 1}</Badge>}
              </div>
            )}
            {categoryRows.length > 0 && (
              <div className="flex flex-wrap gap-1 text-[10px]">
                <span className="text-muted-foreground font-medium">Categorii detectate:</span>
                {categoryRows.map((cr, i) => <Badge key={i} variant="secondary" className="text-[10px]">{cr.category_name}</Badge>)}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Image Preview */}
        {imageUrl && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">2) Examinare imagine</CardTitle></CardHeader>
            <CardContent>
              <div className="relative w-full overflow-auto rounded-md border max-h-[400px]">
                <img src={imageUrl} alt="Upload" className="block max-w-full h-auto" />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main Data Table + Matching */}
        {gridRows.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base">3) Tabel importat & Potrivire produse</CardTitle>
                <div className="flex items-center gap-3 text-sm">
                  <Badge variant="secondary">{bodyRows.length} rânduri</Badge>
                  <Badge variant="default" className="bg-green-600">{matchedCount} potrivite</Badge>
                  <Badge variant="outline" className="text-orange-600 border-orange-300">{bodyRows.length - matchedCount} nepotrivite</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Controls */}
              <div className="flex flex-wrap gap-2 items-end">
                <div className="min-w-[180px]">
                  <Label className="text-xs">Coloană denumire</Label>
                  <Select value={matchNameColIdx.toString()} onValueChange={(v) => setMatchNameColIdx(Number(v))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {headerCells.map((h, i) => (<SelectItem key={i} value={i.toString()}>{h || `Col ${i + 1}`}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="outline" size="sm" onClick={() => runAutoMatch(bodyRows, matchNameColIdx, productsForMatch, aiColumnMap)} disabled={bodyRows.length === 0}>
                  Potrivește automat
                </Button>
                <Button
                  variant={showOnlyUnmatched ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowOnlyUnmatched(!showOnlyUnmatched)}
                  className="gap-1"
                >
                  <Filter className="h-3 w-3" />
                  {showOnlyUnmatched ? "Toate" : "Doar nepotrivite"}
                </Button>
              </div>

              {/* Desktop Table */}
              <div className="hidden md:block rounded-md border overflow-auto max-h-[600px]">
                <Table className="min-w-[900px]">
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead className="w-[40px]">#</TableHead>
                      {headerCells.map((h, idx) => (
                        <TableHead key={idx} className="min-w-[140px]">
                          <div className="flex items-center gap-1">
                            <Input value={h} onChange={(e) => { const hr = gridRows[headerRowIndex]; if (hr) updateCell(hr.id, idx, e.target.value); }} onPaste={(e) => handlePaste(e, headerRowIndex, idx)} className="h-7 text-xs" />
                            <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-destructive shrink-0" onClick={() => deleteColumn(idx)}><Trash2 className="h-3 w-3" /></Button>
                          </div>
                        </TableHead>
                      ))}
                      <TableHead className="min-w-[280px]">Produs (DB)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((r, rowIdx) => {
                      const name = (r.cells[matchNameColIdx] || "").trim();
                      let codeToMatch = "";
                      if (aiColumnMap?.cod_furnizor != null && aiColumnMap.cod_furnizor >= 0) {
                        codeToMatch = (r.cells[aiColumnMap.cod_furnizor] || "").trim();
                      }
                      const searchKeyword = codeToMatch ? `${name} ${codeToMatch}` : name;
                      return (
                        <TableRow key={r.id} className={matchedProductIdByRowId[r.id] ? "bg-green-50/30" : ""}>
                          <TableCell className="text-xs text-muted-foreground">{rowIdx + 1}</TableCell>
                          {r.cells.map((c, colIdx) => (
                            <TableCell key={colIdx}>
                              <Input value={c} onChange={(e) => updateCell(r.id, colIdx, e.target.value)} onPaste={(e) => { const ai = gridRows.findIndex((gr) => gr.id === r.id); if (ai >= 0) handlePaste(e, ai, colIdx); }} className="h-7 text-xs" />
                            </TableCell>
                          ))}
                          <TableCell className="min-w-[280px]">
                            <InlineProductSearch
                              rowId={r.id}
                              selectedProductId={matchedProductIdByRowId[r.id] || null}
                              suggestions={suggestionsByRowId[r.id] || []}
                              productsById={productsById}
                              onSelect={(pid) => setMatchedProductForRow(r.id, pid)}
                              onClear={() => setMatchedProductForRow(r.id, null)}
                              importedName={searchKeyword}
                            />
                            {!matchedProductIdByRowId[r.id] && (
                              <Button variant="link" size="sm" className="text-xs h-5 p-0 mt-1" onClick={() => openCreateProduct(r)}>+ Creează produs nou</Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Compact List */}
              <div className="block md:hidden">
                <ScrollArea className="max-h-[60vh]">
                  <div className="space-y-1">
                    {filteredRows.map((r, rowIdx) => {
                      const name = (r.cells[matchNameColIdx] || "").trim();
                      const isMatched = !!matchedProductIdByRowId[r.id];
                      const isExpanded = expandedRowId === r.id;
                      const matchedProduct = isMatched ? productsById.get(matchedProductIdByRowId[r.id]!) : null;

                      return (
                        <div key={r.id} className={`border rounded-md ${isMatched ? "border-green-300 bg-green-50/30" : "border-border"}`}>
                          <button
                            onClick={() => setExpandedRowId(isExpanded ? null : r.id)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left"
                          >
                            {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                            <span className="text-xs font-mono text-muted-foreground w-6">{rowIdx + 1}</span>
                            {isMatched ? (
                              <Check className="h-4 w-4 shrink-0 text-green-600" />
                            ) : (
                              <AlertTriangle className="h-4 w-4 shrink-0 text-orange-500" />
                            )}
                            <span className="text-sm truncate flex-1 font-medium">
                              {name || <span className="italic text-muted-foreground">fără denumire</span>}
                            </span>
                            {matchedProduct && (
                              <Badge variant="outline" className="shrink-0 text-[10px] border-green-400 text-green-700">
                                {matchedProduct.cod_intern}
                              </Badge>
                            )}
                          </button>

                          {isExpanded && (
                            <div className="px-3 pb-3 space-y-2 border-t">
                              <div className="grid grid-cols-2 gap-2 pt-2">
                                {r.cells.map((c, ci) => (
                                  <div key={ci} className="space-y-0.5">
                                    <Label className="text-[10px] text-muted-foreground">{headerCells[ci] || `Col ${ci + 1}`}</Label>
                                    <Input value={c} onChange={(e) => updateCell(r.id, ci, e.target.value)} className="h-7 text-xs" />
                                  </div>
                                ))}
                              </div>
                              <div className="pt-1 space-y-1">
                                <Label className="text-xs font-medium">Produs (DB)</Label>
                                <InlineProductSearch
                                  rowId={r.id}
                                  selectedProductId={matchedProductIdByRowId[r.id] || null}
                                  suggestions={suggestionsByRowId[r.id] || []}
                                  productsById={productsById}
                                  onSelect={(pid) => setMatchedProductForRow(r.id, pid)}
                                  onClear={() => setMatchedProductForRow(r.id, null)}
                                  importedName={r.cells[matchNameColIdx] || ""}
                                />
                                {!matchedProductIdByRowId[r.id] && (
                                  <Button variant="outline" size="sm" className="text-xs w-full" onClick={() => openCreateProduct(r)}>+ Creează produs nou</Button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>

              {/* Price comparison & save section */}
              <div className="rounded-md border p-3 space-y-3 mt-4">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  Mapări Prețuri & Salvare
                  <div className="group relative">
                    <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-64 p-2 bg-popover text-popover-foreground text-xs rounded shadow-lg border z-10">
                      Adaugă o mapare pentru fiecare coloană de preț din Excel. Toate variațiile definite vor fi salvate simultan!
                    </div>
                  </div>
                </h4>
                
                <div className="flex flex-col gap-3">
                  {priceMappings.map((mapping, idx) => (
                    <div key={mapping.id} className="flex flex-col sm:flex-row flex-wrap gap-2 items-end bg-muted/30 p-2 rounded border border-dashed">
                      <div className="min-w-[150px] flex-1">
                        <Label className="text-xs">Coloană preț</Label>
                        <Select value={mapping.colIdx.toString()} onValueChange={(v) => { 
                          setPriceMappings(prev => prev.map((m, i) => i === idx ? { ...m, colIdx: Number(v) } : m)); 
                        }}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{headerCells.map((h, i) => (<SelectItem key={i} value={i.toString()}>{h || `Col ${i + 1}`}</SelectItem>))}</SelectContent>
                        </Select>
                      </div>
                      <div className="min-w-[150px] flex-1">
                        <Label className="text-xs">Tip preț (ex: Preț listă, Palet)</Label>
                        <Input value={mapping.priceType} onChange={(e) => setPriceMappings(prev => prev.map((m, i) => i === idx ? { ...m, priceType: e.target.value } : m))} className="h-8 text-xs" />
                      </div>
                      <div className="min-w-[100px]">
                        <Label className="text-xs">Cant. min.</Label>
                        <Input type="number" min={1} value={mapping.minQuantity} onChange={(e) => setPriceMappings(prev => prev.map((m, i) => i === idx ? { ...m, minQuantity: Number(e.target.value) || 1 } : m))} className="h-8 text-xs" />
                      </div>
                      {priceMappings.length > 1 && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive shrink-0" onClick={() => setPriceMappings(prev => prev.filter((_, i) => i !== idx))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  
                  <div className="flex items-center">
                    <Button variant="outline" size="sm" className="text-xs border-dashed" onClick={() => setPriceMappings(prev => [...prev, { id: crypto.randomUUID(), colIdx: prev[prev.length - 1]?.colIdx || 0, priceType: "Preț nou", minQuantity: 1 }])}>
                      <Plus className="h-3 w-3 mr-1" /> Adaugă tip preț
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row flex-wrap gap-2 items-stretch sm:items-end mt-4 pt-4 border-t">
                  <Button variant="outline" size="sm" onClick={() => setSavePricesOpen(true)} disabled={bodyRows.length === 0 || bulkRunning} className="w-full sm:w-auto mt-auto">
                    Actualizează Catalogul (doar potrivite)
                  </Button>
                  {bodyRows.some((r) => !matchedProductIdByRowId[r.id]) && (
                    <Button
                      size="sm"
                      onClick={bulkUpdateCatalog}
                      disabled={bulkRunning}
                      className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white w-full sm:w-auto"
                    >
                      {bulkRunning ? "Se procesează..." : (
                        <>
                          <span className="hidden sm:inline">{`Creează produse noi + Actualizează Catalog (${bodyRows.filter((r) => !matchedProductIdByRowId[r.id]).length} noi)`}</span>
                          <span className="sm:hidden">{`Creează + Actualizează (${bodyRows.filter((r) => !matchedProductIdByRowId[r.id]).length} noi)`}</span>
                        </>
                      )}
                    </Button>
                  )}
                </div>

                {bodyRows.filter((r) => matchedProductIdByRowId[r.id]).length > 0 && (
                  <div className="rounded-md border overflow-auto max-h-[300px]">
                    <p className="text-[11px] text-amber-600 bg-amber-50 border-b border-amber-200 px-3 py-1.5">
                      Unitățile de măsură pot diferi între coloana importată și prețul din DB — verificați înainte de salvare.
                    </p>
                    <Table>
                      <TableHeader className="sticky top-0 bg-background">
                        <TableRow>
                          <TableHead className="text-xs">Produs</TableHead>
                          <TableHead className="text-xs w-[110px]" title={headerCells[priceMappings[0]?.colIdx || 0] || "Preț import"}>
                            <span className="block truncate max-w-[100px]">{headerCells[priceMappings[0]?.colIdx || 0] || "Preț import"}</span>
                          </TableHead>
                          <TableHead className="text-xs w-[100px]">Preț Vechi (DB)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bodyRows.filter((r) => matchedProductIdByRowId[r.id]).map((r) => {
                          const productId = matchedProductIdByRowId[r.id]!;
                          const product = productsById.get(productId);
                          const parsedOcr = parsePriceCell(r.cells[priceMappings[0]?.colIdx || 0] || "");
                          const dbUnit = product?.unit || "?";
                          return (
                            <TableRow key={r.id}>
                              <TableCell className="text-xs">
                                <span className="font-mono text-primary">{product?.cod_intern}</span>
                                <span className="ml-1 text-muted-foreground">{product?.denumire_completa?.slice(0, 35)}</span>
                              </TableCell>
                              <TableCell className="text-xs">{parsedOcr !== null ? parsedOcr.toFixed(2) : "-"}</TableCell>
                              <TableCell className="text-xs">
                                {product?.pret_lista != null
                                  ? <><span>{Number(product.pret_lista).toFixed(2)}</span><span className="text-muted-foreground ml-1">lei/{dbUnit}</span></>
                                  : "-"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Create Product Dialog */}
        <AlertDialog open={createProductRowId !== null} onOpenChange={(open) => !open && setCreateProductRowId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Creează produs nou</AlertDialogTitle>
              <AlertDialogDescription>Produsul va fi adăugat în DB și selectat pe rândul curent.</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3">
              <div><Label>Denumire</Label><Input value={createProductName} onChange={(e) => setCreateProductName(e.target.value)} /></div>
              <div><Label>Cod intern</Label><Input value={createProductCodIntern} onChange={(e) => setCreateProductCodIntern(e.target.value)} /></div>
              <div><Label>UM</Label><Input value={createProductUnit} onChange={(e) => setCreateProductUnit(e.target.value)} placeholder="buc / sac / kg" /></div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={createProductRunning}>Anulează</AlertDialogCancel>
              <AlertDialogAction onClick={createProduct} disabled={createProductRunning}>Creează</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Save Prices Dialog */}
        <AlertDialog open={savePricesOpen} onOpenChange={setSavePricesOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Actualizare Catalog</AlertDialogTitle>
              <AlertDialogDescription>Se vor actualiza direct în baza de date prețurile rândurilor care au produs selectat.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={savePricesRunning}>Anulează</AlertDialogCancel>
              <AlertDialogAction onClick={updateCatalogPrices} disabled={savePricesRunning}>Actualizează Catalogul</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
};

export default ImportOcr;
