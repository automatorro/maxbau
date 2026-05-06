import { useEffect, useMemo, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ScanText, Trash2, Search, Check, AlertTriangle, ChevronDown, ChevronRight, Filter, FileUp, Building2, Plus } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  const tokens = norm.split(/[^a-z0-9]+/g).filter(Boolean);
  return Array.from(new Set(tokens.filter((t) => t.length >= 2)));
}

function suggestProductsForName(name: string, products: ProductForMatch[], limit: number): { product: ProductForMatch; score: number }[] {
  const keywords = matchKeywordsFromText(name);
  if (keywords.length === 0) return [];
  const scored: { product: ProductForMatch; score: number; matchedLength: number }[] = [];
  for (const p of products) {
    const target = normalizeMatchText(`${p.denumire_completa} ${p.cod_intern || ""}`);
    let matchedCount = 0;
    let matchedLength = 0;
    for (const kw of keywords) {
      if (target.includes(kw)) { matchedCount += 1; matchedLength += kw.length; }
    }
    const score = matchedCount / keywords.length;
    if (score < 0.5) continue;
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
      const { data, error } = await supabase
        .from("products")
        .select("id, cod_intern, denumire_completa, unit, pret_lista")
        .or(`denumire_completa.ilike.%${searchText}%,cod_intern.ilike.%${searchText}%`)
        .order("denumire_completa")
        .limit(10);
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

  const [priceColIdx, setPriceColIdx] = useState<number>(0);
  const [priceOverridesByRowId, setPriceOverridesByRowId] = useState<Record<string, string>>({});
  const [savePricesOpen, setSavePricesOpen] = useState(false);
  const [savePricesRunning, setSavePricesRunning] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: productsForMatch = [] } = useQuery({
    queryKey: ["products-for-ocr-match"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("id, cod_intern, denumire_completa, unit, pret_lista, supplier_id");
      if (error) throw error;
      return data as ProductForMatch[];
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
    setPriceColIdx((v) => Math.max(0, Math.min(max, v)));
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
    setPriceOverridesByRowId({}); setSavePricesOpen(false);
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
    setPriceColIdx(priceIdx);

    if (columnMap) setAiColumnMap(columnMap);
    if (catRows && catRows.length > 0) {
      setCategoryRows(catRows);
      toast.info(`${catRows.length} categorii detectate în tabel`);
    }

    if (note) toast.info(note);
    setTimeout(() => {
      if (productsForMatch.length > 0 && bodyGridRows.length > 0)
        runAutoMatch(bodyGridRows, nameIdx, productsForMatch);
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
      const { data, error } = await supabase.functions.invoke("ai-product-info", {
        body: { action: "ocr-image", image_base64: base64, mime_type: file.type || "image/jpeg" }
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Extragere eșuată");
      loadAiResult(data.headers, data.rows, data.note);
      toast.success(`${data.rows.length} rânduri extrase din imagine`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Eroare scanare imagine"); }
    finally { setOcrRunning(false); }
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
      const { data, error } = await supabase.functions.invoke("ai-product-info", {
        body: { action: "ocr-excel", rows: rawRows, filename: excelFile.name, supplier_column_map: supplierColumnMap }
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Procesare eșuată");
      loadAiResult(data.headers, data.rows, data.note, data.column_map, data.category_rows);

      // Auto-save column_map to supplier if first import
      if (data.column_map && selectedSupplierId && (!supplierColumnMap || Object.keys(supplierColumnMap).length === 0)) {
        await saveSupplierColumnMap(data.column_map);
        toast.info("Profilul furnizorului a fost salvat automat");
      }

      toast.success(`${data.rows.length} rânduri importate din "${sheetName}"`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Eroare import Excel"); }
    finally { setExcelRunning(false); }
  };

  const runAutoMatch = useCallback((rows: GridRow[], nameColIdx: number, products: ProductForMatch[]) => {
    if (rows.length === 0 || products.length === 0) return;
    const nextSuggestions: Record<string, string[]> = {};
    const nextMatched: Record<string, string | null> = {};

    const supplierNameText = selectedSupplier?.name || newSupplierName || "";
    const importBrand = getBrandFromName(supplierNameText);

    // Filter out products that belong to a DIFFERENT supplier or have a clashing brand
    const validProducts = products.filter(p => {
      // Rule 1: Strict supplier_id check if available
      if (p.supplier_id && selectedSupplierId && p.supplier_id !== selectedSupplierId) return false;
      
      // Rule 2: Brand clash check
      const productBrand = getBrandFromName(p.denumire_completa) || (p.brand ? getBrandFromName(p.brand) : null);
      if (productBrand && importBrand && productBrand !== importBrand) {
        return false; // The product is from a different known brand!
      }

      return true; 
    });

    for (const r of rows) {
      const name = (r.cells[nameColIdx] || "").trim();
      if (!name) continue;
      const results = suggestProductsForName(name, validProducts, 5);
      if (results.length > 0) {
        nextSuggestions[r.id] = results.map((s) => s.product.id);
        if (results[0].score >= 0.85) nextMatched[r.id] = results[0].product.id;
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
      for (const r of bodyRows) {
        const cell = r.cells[priceColIdx] || "";
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
    const updates: { id: string; pret_lista: number; grile_pret: Record<string, string> | null; supplier_id?: string | null }[] = [];
    for (const r of bodyRows) {
      const productId = matchedProductIdByRowId[r.id];
      if (!productId) continue;
      const raw = (priceOverridesByRowId[r.id] ?? r.cells[priceColIdx] ?? "").toString();
      const parsed = parsePriceCell(raw);
      if (parsed === null) continue;
      
      const extraItem: Record<string, string | undefined> = {};
      if (aiColumnMap?.cod_furnizor != null && aiColumnMap.cod_furnizor >= 0) extraItem.cod_furnizor = (r.cells[aiColumnMap.cod_furnizor] || "").trim() || undefined;
      if (aiColumnMap?.cantitate_palet != null && aiColumnMap.cantitate_palet >= 0) extraItem.cantitate_palet = (r.cells[aiColumnMap.cantitate_palet] || "").trim() || undefined;
      if (aiColumnMap?.consum != null && aiColumnMap.consum >= 0) extraItem.consum = (r.cells[aiColumnMap.consum] || "").trim() || undefined;
      const grile_pret = Object.keys(extraItem).length > 0 ? extraItem as Record<string, string> : null;

      updates.push({ id: productId, pret_lista: parsed, grile_pret, ...(selectedSupplierId ? { supplier_id: selectedSupplierId } : {}) });
    }
    
    if (updates.length === 0) { toast.error("Nu există rânduri valide (produs + preț numeric)"); return; }
    setSavePricesRunning(true);
    
    try {
      await Promise.all(updates.map(u => supabase.from("products").update(u).eq("id", u.id)));
      toast.success(`Catalog actualizat: ${updates.length} prețuri`);
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
      // 1. Create products for all unmatched rows that have a non-empty name
      const unmatchedRows = bodyRows.filter((r) => !matchedProductIdByRowId[r.id]);
      const freshMatched: Record<string, string> = {};

      for (const r of unmatchedRows) {
        const denumire = (r.cells[matchNameColIdx] || "").trim();
        if (!denumire) continue;
        const pretRaw = (priceOverridesByRowId[r.id] ?? r.cells[priceColIdx] ?? "").toString();
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

      // 2. Merge newly created into matched map
      const allMatched = { ...matchedProductIdByRowId, ...freshMatched };
      setMatchedProductIdByRowId(allMatched);
      
      // 3. Update existing matched rows
      const updates = [];
      for (const r of bodyRows) {
        const productId = allMatched[r.id];
        if (!productId || freshMatched[r.id]) continue; // skip new products, already saved
        
        const raw = (priceOverridesByRowId[r.id] ?? r.cells[priceColIdx] ?? "").toString();
        const parsed = parsePriceCell(raw);
        if (parsed === null) continue;
        
        const extraItem: Record<string, string | undefined> = {};
        if (aiColumnMap?.cod_furnizor != null && aiColumnMap.cod_furnizor >= 0) extraItem.cod_furnizor = (r.cells[aiColumnMap.cod_furnizor] || "").trim() || undefined;
        if (aiColumnMap?.cantitate_palet != null && aiColumnMap.cantitate_palet >= 0) extraItem.cantitate_palet = (r.cells[aiColumnMap.cantitate_palet] || "").trim() || undefined;
        if (aiColumnMap?.consum != null && aiColumnMap.consum >= 0) extraItem.consum = (r.cells[aiColumnMap.consum] || "").trim() || undefined;
        const grile_pret = Object.keys(extraItem).length > 0 ? extraItem as Record<string, string> : null;

        updates.push({ id: productId, pret_lista: parsed, grile_pret, ...(selectedSupplierId ? { supplier_id: selectedSupplierId } : {}) });
      }

      if (updates.length > 0) {
        await Promise.all(updates.map(u => supabase.from("products").update(u).eq("id", u.id)));
      }

      const newCount = Object.keys(freshMatched).length;
      toast.success(`Catalog actualizat: ${updates.length + newCount} produse prelucrate${newCount > 0 ? ` (${newCount} produse noi)` : ""}`);
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
    setPriceColIdx(adjust);
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
        <div>
          <h1 className="text-2xl font-bold text-foreground">Import OCR/Excel</h1>
          <p className="text-sm text-muted-foreground">Încarcă imagine sau Excel, potrivește produse și salvează prețuri</p>
        </div>

        {/* Supplier + Upload Section */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">1) Furnizor & Upload</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {/* Supplier selector */}
            <div className="flex flex-wrap gap-2 items-end">
              <div className="min-w-[200px]">
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
              <div className="flex gap-1 items-end">
                <div>
                  <Label className="text-xs">Sau creează nou</Label>
                  <Input value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)} placeholder="Nume furnizor..." className="h-9 text-xs w-40" />
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
                <Button variant="outline" size="sm" onClick={() => runAutoMatch(bodyRows, matchNameColIdx, productsForMatch)} disabled={bodyRows.length === 0}>
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
                      <TableHead className="min-w-[280px] sticky right-0 bg-background">Produs (DB)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((r, rowIdx) => (
                      <TableRow key={r.id} className={matchedProductIdByRowId[r.id] ? "bg-green-50/30" : ""}>
                        <TableCell className="text-xs text-muted-foreground">{rowIdx + 1}</TableCell>
                        {r.cells.map((c, colIdx) => (
                          <TableCell key={colIdx}>
                            <Input value={c} onChange={(e) => updateCell(r.id, colIdx, e.target.value)} onPaste={(e) => { const ai = gridRows.findIndex((gr) => gr.id === r.id); if (ai >= 0) handlePaste(e, ai, colIdx); }} className="h-7 text-xs" />
                          </TableCell>
                        ))}
                        <TableCell className="min-w-[280px] sticky right-0 bg-background">
                          <InlineProductSearch
                            rowId={r.id}
                            selectedProductId={matchedProductIdByRowId[r.id] || null}
                            suggestions={suggestionsByRowId[r.id] || []}
                            productsById={productsById}
                            onSelect={(pid) => setMatchedProductForRow(r.id, pid)}
                            onClear={() => setMatchedProductForRow(r.id, null)}
                            importedName={(r.cells[matchNameColIdx] || "").trim()}
                          />
                          {!matchedProductIdByRowId[r.id] && (
                            <Button variant="link" size="sm" className="text-xs h-5 p-0 mt-1" onClick={() => openCreateProduct(r)}>+ Creează produs nou</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
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
                                  importedName={name}
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
                <h4 className="text-sm font-medium">Prețuri & Salvare</h4>
                <div className="flex flex-wrap gap-2 items-end">
                  <div className="min-w-[150px]">
                    <Label className="text-xs">Coloană preț</Label>
                    <Select value={priceColIdx.toString()} onValueChange={(v) => { setPriceColIdx(Number(v)); setPriceOverridesByRowId({}); }}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{headerCells.map((h, i) => (<SelectItem key={i} value={i.toString()}>{h || `Col ${i + 1}`}</SelectItem>))}</SelectContent>
                    </Select>
                  </div>
                  <Button variant="outline" size="sm" onClick={ensurePriceOverrides} disabled={bodyRows.length === 0}>Preia prețuri</Button>
                  <Button variant="outline" size="sm" onClick={() => setSavePricesOpen(true)} disabled={bodyRows.length === 0 || bulkRunning}>
                    Actualizează Catalogul (doar potrivite)
                  </Button>
                  {bodyRows.some((r) => !matchedProductIdByRowId[r.id]) && (
                    <Button
                      size="sm"
                      onClick={bulkUpdateCatalog}
                      disabled={bulkRunning}
                      className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      {bulkRunning ? "Se procesează..." : `Creează produse noi + Actualizează Catalog (${bodyRows.filter((r) => !matchedProductIdByRowId[r.id]).length} noi)`}
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
                          <TableHead className="text-xs w-[110px]" title={headerCells[priceColIdx] || "Preț import"}>
                            <span className="block truncate max-w-[100px]">{headerCells[priceColIdx] || "Preț import"}</span>
                          </TableHead>
                          <TableHead className="text-xs w-[100px]">Preț Vechi (DB)</TableHead>
                          <TableHead className="text-xs w-[100px]">Preț Nou</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bodyRows.filter((r) => matchedProductIdByRowId[r.id]).map((r) => {
                          const productId = matchedProductIdByRowId[r.id]!;
                          const product = productsById.get(productId);
                          const parsedOcr = parsePriceCell(r.cells[priceColIdx] || "");
                          const override = priceOverridesByRowId[r.id] ?? "";
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
                              <TableCell>
                                <Input value={override} onChange={(e) => setPriceOverridesByRowId((prev) => ({ ...prev, [r.id]: e.target.value }))} placeholder={parsedOcr !== null ? parsedOcr.toString() : ""} className="h-7 text-xs" />
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
