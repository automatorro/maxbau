import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { toast } from "sonner";
import { FileUp, ScanText, Trash2 } from "lucide-react";
import * as XLSX from "xlsx";

type OcrWord = {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};

type OcrLine = {
  id: string;
  words: OcrWord[];
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};

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
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function guessDelimitedSeparator(text: string): "\t" | ";" | "," {
  const sample = text.split(/\r?\n/).slice(0, 20).join("\n");
  if (sample.includes("\t")) return "\t";
  const semi = (sample.match(/;/g) || []).length;
  const comma = (sample.match(/,/g) || []).length;
  return semi >= comma ? ";" : ",";
}

function parseDelimitedText(text: string, separator: "\t" | ";" | ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let inQuotes = false;

  const pushCell = () => {
    row.push(current);
    current = "";
  };

  const pushRow = () => {
    rows.push(row);
    row = [];
  };

  const input = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === "\"") {
        const next = input[i + 1];
        if (next === "\"") {
          current += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "\"") {
      inQuotes = true;
      continue;
    }

    if (ch === separator) {
      pushCell();
      continue;
    }

    if (ch === "\n") {
      pushCell();
      pushRow();
      continue;
    }

    if (ch === "\r") {
      const next = input[i + 1];
      if (next === "\n") i += 1;
      pushCell();
      pushRow();
      continue;
    }

    current += ch;
  }

  pushCell();
  if (row.length > 1 || row.some((c) => c.trim() !== "")) pushRow();

  return rows;
}

function isSpreadsheetFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xlsm") || file.type.includes("spreadsheet");
}

function normalizeMatchText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function matchKeywordsFromText(input: string): string[] {
  const norm = normalizeMatchText(input);
  const tokens = norm.split(/[^a-z0-9]+/g).filter(Boolean);
  const uniq = new Set(tokens.filter((t) => t.length >= 2));
  return Array.from(uniq);
}

function suggestProductsForName(name: string, products: ProductForMatch[], limit: number): ProductForMatch[] {
  const keywords = matchKeywordsFromText(name);
  if (keywords.length === 0) return [];

  const scored: { p: ProductForMatch; score: number; matchedLength: number; matchedCount: number }[] = [];
  for (const p of products) {
    const target = normalizeMatchText(`${p.denumire_completa} ${p.cod_intern || ""}`);
    let matchedCount = 0;
    let matchedLength = 0;
    for (const kw of keywords) {
      if (target.includes(kw)) {
        matchedCount += 1;
        matchedLength += kw.length;
      }
    }
    const score = matchedCount / keywords.length;
    if (score < 0.5) continue;
    scored.push({ p, score, matchedLength, matchedCount });
  }

  scored.sort((a, b) => b.score - a.score || b.matchedLength - a.matchedLength || b.matchedCount - a.matchedCount);
  return scored.slice(0, Math.max(1, limit)).map((s) => s.p);
}

function parsePriceCell(text: string): number | null {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(/,(?=\d{3}(\D|$))/g, "");
  const normalized = cleaned.includes(",") && !cleaned.includes(".") ? cleaned.replace(",", ".") : cleaned;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return value;
}

function extractLinesFromBlocks(blocks: unknown): OcrLine[] {
  const blockArr = asArray(blocks);
  if (!blockArr) return [];
  const out: OcrLine[] = [];
  for (const b of blockArr) {
    if (!isRecord(b)) continue;
    const paragraphs = asArray(b.paragraphs);
    if (!paragraphs) continue;
    for (const p of paragraphs) {
      if (!isRecord(p)) continue;
      const lines = asArray(p.lines);
      if (!lines) continue;
      for (const l of lines) {
        if (!isRecord(l)) continue;
        const words = asArray(l.words);
        if (!words) continue;
        const lineWords: OcrWord[] = [];
        let minX0 = Number.POSITIVE_INFINITY;
        let minY0 = Number.POSITIVE_INFINITY;
        let maxX1 = Number.NEGATIVE_INFINITY;
        let maxY1 = Number.NEGATIVE_INFINITY;

        for (const w of words) {
          if (!isRecord(w)) continue;
          const text = typeof w.text === "string" ? w.text : "";
          const confidence = typeof w.confidence === "number" ? w.confidence : 0;
          const bbox = isRecord(w.bbox) ? w.bbox : null;
          if (!bbox) continue;
          const x0 = bbox.x0;
          const y0 = bbox.y0;
          const x1 = bbox.x1;
          const y1 = bbox.y1;
          if (typeof x0 !== "number" || typeof y0 !== "number" || typeof x1 !== "number" || typeof y1 !== "number") continue;
          if (!text) continue;
          lineWords.push({ text, confidence, bbox: { x0, y0, x1, y1 } });
          minX0 = Math.min(minX0, x0);
          minY0 = Math.min(minY0, y0);
          maxX1 = Math.max(maxX1, x1);
          maxY1 = Math.max(maxY1, y1);
        }

        if (lineWords.length === 0) continue;
        const sorted = [...lineWords].sort((a, c) => a.bbox.x0 - c.bbox.x0);
        const text = sorted.map((w) => w.text).join(" ").trim();
        out.push({
          id: crypto.randomUUID(),
          words: sorted,
          text,
          bbox: { x0: minX0, y0: minY0, x1: maxX1, y1: maxY1 },
        });
      }
    }
  }

  return out.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
}

function extractWordsFromBlocks(blocks: unknown): OcrWord[] {
  const blockArr = asArray(blocks);
  if (!blockArr) return [];
  const out: OcrWord[] = [];
  for (const b of blockArr) {
    if (!isRecord(b)) continue;
    const paragraphs = asArray(b.paragraphs);
    if (!paragraphs) continue;
    for (const p of paragraphs) {
      if (!isRecord(p)) continue;
      const lines = asArray(p.lines);
      if (!lines) continue;
      for (const l of lines) {
        if (!isRecord(l)) continue;
        const words = asArray(l.words);
        if (!words) continue;
        for (const w of words) {
          if (!isRecord(w)) continue;
          const text = typeof w.text === "string" ? w.text : "";
          const confidence = typeof w.confidence === "number" ? w.confidence : 0;
          const bbox = isRecord(w.bbox) ? w.bbox : null;
          if (!bbox) continue;
          const x0 = bbox.x0;
          const y0 = bbox.y0;
          const x1 = bbox.x1;
          const y1 = bbox.y1;
          if (typeof x0 !== "number" || typeof y0 !== "number" || typeof x1 !== "number" || typeof y1 !== "number") continue;
          if (!text) continue;
          out.push({ text, confidence, bbox: { x0, y0, x1, y1 } });
        }
      }
    }
  }
  return out;
}

function buildColumnAnchors(lines: OcrLine[], mergePx: number): number[] {
  const xs: number[] = [];
  for (const line of lines) {
    for (const w of line.words) xs.push(w.bbox.x0);
  }
  xs.sort((a, b) => a - b);
  const anchors: number[] = [];
  let current: { mean: number; count: number } | null = null;
  const threshold = Math.max(1, mergePx);
  for (const x of xs) {
    if (!current) {
      current = { mean: x, count: 1 };
      continue;
    }
    if (Math.abs(x - current.mean) <= threshold) {
      const nextCount = current.count + 1;
      current.mean = (current.mean * current.count + x) / nextCount;
      current.count = nextCount;
      continue;
    }
    anchors.push(current.mean);
    current = { mean: x, count: 1 };
  }
  if (current) anchors.push(current.mean);
  return anchors.sort((a, b) => a - b);
}

function nearestAnchorIndex(anchors: number[], x: number): number {
  let bestIdx = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < anchors.length; i += 1) {
    const d = Math.abs(anchors[i] - x);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function buildGrid(lines: OcrLine[], mergePx: number): { anchors: number[]; rows: GridRow[] } {
  const anchors = buildColumnAnchors(lines, mergePx);
  const colCount = anchors.length;
  if (colCount === 0) return { anchors: [], rows: [] };

  const rows: GridRow[] = lines.map((line) => {
    const byCol = new Map<number, OcrWord[]>();
    for (const w of line.words) {
      const col = nearestAnchorIndex(anchors, w.bbox.x0);
      const list = byCol.get(col);
      if (list) list.push(w);
      else byCol.set(col, [w]);
    }
    const cells = Array.from({ length: colCount }, () => "");
    for (const [col, ws] of byCol.entries()) {
      const text = ws.sort((a, b) => a.bbox.x0 - b.bbox.x0).map((w) => w.text).join(" ").trim();
      cells[col] = text;
    }
    return { id: line.id, cells };
  });

  const trimmed = rows.filter((r) => r.cells.some((c) => c.trim().length > 0));
  return { anchors, rows: trimmed };
}

const ImportOcr = () => {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [sheetFile, setSheetFile] = useState<File | null>(null);
  const [xlsxSheetNames, setXlsxSheetNames] = useState<string[]>([]);
  const [xlsxSheetName, setXlsxSheetName] = useState<string>("");
  const [imageUrl, setImageUrl] = useState<string>("");
  const [lang, setLang] = useState<"eng" | "ron">("ron");
  const [running, setRunning] = useState(false);
  const [sheetRunning, setSheetRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ocrText, setOcrText] = useState("");
  const [showRawText, setShowRawText] = useState(false);
  const [mergePx, setMergePx] = useState(22);
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [words, setWords] = useState<OcrWord[]>([]);
  const [lines, setLines] = useState<OcrLine[]>([]);
  const [gridRows, setGridRows] = useState<GridRow[]>([]);
  const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number; height: number } | null>(null);

  const [mobileLabelColIdx, setMobileLabelColIdx] = useState<number>(0);
  const [mobileEditColIdx, setMobileEditColIdx] = useState<number>(1);
  const [matchNameColIdx, setMatchNameColIdx] = useState<number>(0);
  const [suggestionsByRowId, setSuggestionsByRowId] = useState<Record<string, string[]>>({});
  const [matchedProductIdByRowId, setMatchedProductIdByRowId] = useState<Record<string, string | null>>({});
  const [createProductRowId, setCreateProductRowId] = useState<string | null>(null);
  const [createProductName, setCreateProductName] = useState("");
  const [createProductCodIntern, setCreateProductCodIntern] = useState("");
  const [createProductUnit, setCreateProductUnit] = useState("");
  const [createProductRunning, setCreateProductRunning] = useState(false);

  const [priceColIdx, setPriceColIdx] = useState<number>(0);
  const [priceOverridesByRowId, setPriceOverridesByRowId] = useState<Record<string, string>>({});
  const [newPriceSheetName, setNewPriceSheetName] = useState("");
  const [savePricesOpen, setSavePricesOpen] = useState(false);
  const [savePricesRunning, setSavePricesRunning] = useState(false);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const { data: productsForMatch = [] } = useQuery({
    queryKey: ["products-for-ocr-match"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("id, cod_intern, denumire_completa, unit, pret_lista");
      if (error) throw error;
      return data as ProductForMatch[];
    },
  });

  const { data: activePriceSheet } = useQuery({
    queryKey: ["active-price-sheet-ocr"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_sheets")
        .select("id, name, created_at")
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0] as { id: string; name: string; created_at: string } | undefined;
    },
  });

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setOcrText("");
    setWords([]);
    setLines([]);
    setGridRows([]);
    setProgress(0);
    setHeaderRowIndex(0);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    let cancelled = false;
    const loadSheets = async () => {
      if (!sheetFile) {
        setXlsxSheetNames([]);
        setXlsxSheetName("");
        return;
      }
      if (!isSpreadsheetFile(sheetFile)) {
        setXlsxSheetNames([]);
        setXlsxSheetName("");
        return;
      }

      try {
        const buf = await sheetFile.arrayBuffer();
        if (cancelled) return;
        const wb = XLSX.read(buf, { type: "array" });
        const names = wb.SheetNames || [];
        setXlsxSheetNames(names);
        setXlsxSheetName((prev) => (names.includes(prev) ? prev : (names[0] || "")));
      } catch {
        if (cancelled) return;
        setXlsxSheetNames([]);
        setXlsxSheetName("");
      }
    };
    void loadSheets();
    return () => {
      cancelled = true;
    };
  }, [sheetFile]);

  const headerCells = useMemo(() => {
    const row = gridRows[headerRowIndex];
    return row ? row.cells : [];
  }, [gridRows, headerRowIndex]);

  const bodyRows = useMemo(() => {
    return gridRows.filter((_, idx) => idx !== headerRowIndex);
  }, [gridRows, headerRowIndex]);

  const matchedProductIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of Object.values(matchedProductIdByRowId)) {
      if (id) ids.add(id);
    }
    return Array.from(ids);
  }, [matchedProductIdByRowId]);

  const { data: activePriceItems = [] } = useQuery({
    queryKey: ["active-price-items-ocr", activePriceSheet?.id, matchedProductIds.join("|")],
    enabled: Boolean(activePriceSheet?.id) && matchedProductIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_sheet_items")
        .select("id, product_id, label, unit, price")
        .eq("price_sheet_id", activePriceSheet!.id)
        .in("product_id", matchedProductIds)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as { id: string; product_id: string; label: string | null; unit: string | null; price: number }[];
    },
  });

  const activePriceItemByProductId = useMemo(() => {
    const map = new Map<string, { id: string; label: string | null; unit: string | null; price: number }>();
    for (const it of activePriceItems) {
      if (!map.has(it.product_id)) map.set(it.product_id, { id: it.id, label: it.label, unit: it.unit, price: Number(it.price) });
    }
    return map;
  }, [activePriceItems]);

  const productsById = useMemo(() => {
    const map = new Map<string, ProductForMatch>();
    for (const p of productsForMatch) map.set(p.id, p);
    return map;
  }, [productsForMatch]);

  useEffect(() => {
    const max = Math.max(0, headerCells.length - 1);
    setMobileLabelColIdx((v) => Math.max(0, Math.min(max, v)));
    setMobileEditColIdx((v) => Math.max(0, Math.min(max, v)));
    setMatchNameColIdx((v) => Math.max(0, Math.min(max, v)));
    setPriceColIdx((v) => Math.max(0, Math.min(max, v)));
  }, [headerCells.length]);

  useEffect(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas || !imageNaturalSize) return;

    const rect = img.getBoundingClientRect();
    const displayWidth = Math.max(1, Math.round(rect.width));
    const displayHeight = Math.max(1, Math.round(rect.height));

    canvas.width = displayWidth;
    canvas.height = displayHeight;
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (words.length === 0) return;

    const sx = displayWidth / imageNaturalSize.width;
    const sy = displayHeight / imageNaturalSize.height;

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(59, 130, 246, 0.8)";
    for (const w of words) {
      const x = Math.round(w.bbox.x0 * sx);
      const y = Math.round(w.bbox.y0 * sy);
      const wdt = Math.round((w.bbox.x1 - w.bbox.x0) * sx);
      const hgt = Math.round((w.bbox.y1 - w.bbox.y0) * sy);
      if (wdt <= 0 || hgt <= 0) continue;
      ctx.strokeRect(x, y, wdt, hgt);
    }
  }, [words, imageNaturalSize]);

  const regenerateGrid = () => {
    if (lines.length === 0) return;
    const built = buildGrid(lines, mergePx);
    setGridRows(built.rows);
    setHeaderRowIndex(0);
  };

  const generateSuggestionsForAllRows = () => {
    if (bodyRows.length === 0) return;
    if (productsForMatch.length === 0) {
      toast.error("Nu există produse încărcate pentru potrivire");
      return;
    }

    const next: Record<string, string[]> = {};
    for (const r of bodyRows) {
      const name = (r.cells[matchNameColIdx] || "").trim();
      if (!name) continue;
      const suggested = suggestProductsForName(name, productsForMatch, 5);
      if (suggested.length > 0) next[r.id] = suggested.map((p) => p.id);
    }
    setSuggestionsByRowId(next);
    toast.success("Sugestii generate");
  };

  const generateSuggestionsForRow = (row: GridRow) => {
    if (productsForMatch.length === 0) {
      toast.error("Nu există produse încărcate pentru potrivire");
      return;
    }
    const name = (row.cells[matchNameColIdx] || "").trim();
    if (!name) return;
    const suggested = suggestProductsForName(name, productsForMatch, 5);
    setSuggestionsByRowId((prev) => ({ ...prev, [row.id]: suggested.map((p) => p.id) }));
  };

  const setMatchedProductForRow = (rowId: string, productId: string | null) => {
    setMatchedProductIdByRowId((prev) => ({ ...prev, [rowId]: productId }));
  };

  const openCreateProduct = (row: GridRow) => {
    setCreateProductRowId(row.id);
    const suggestedName = (row.cells[matchNameColIdx] || "").trim();
    setCreateProductName(suggestedName);
    const newCode = `OCR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    setCreateProductCodIntern(newCode);
    setCreateProductUnit("");
  };

  const createProduct = async () => {
    if (!createProductRowId) return;
    const name = createProductName.trim();
    const cod = createProductCodIntern.trim();
    const unit = createProductUnit.trim();
    if (!name) {
      toast.error("Denumirea este obligatorie");
      return;
    }
    if (!cod) {
      toast.error("Cod intern este obligatoriu");
      return;
    }
    if (createProductRunning) return;

    setCreateProductRunning(true);
    try {
      const { data, error } = await supabase
        .from("products")
        .insert({
          cod_intern: cod,
          denumire_completa: name,
          unit: unit ? unit : null,
          pret_lista: 0,
        })
        .select("id")
        .single();
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

  const savePricesToNewPriceSheet = async () => {
    const name = newPriceSheetName.trim();
    if (!name) {
      toast.error("Numele foii de preț este obligatoriu");
      return;
    }
    if (savePricesRunning) return;

    const items: { product_id: string; price: number; unit: string | null; label: string | null }[] = [];
    for (const r of bodyRows) {
      const productId = matchedProductIdByRowId[r.id];
      if (!productId) continue;
      const raw = (priceOverridesByRowId[r.id] ?? r.cells[priceColIdx] ?? "").toString();
      const parsed = parsePriceCell(raw);
      if (parsed === null) continue;
      const p = productsById.get(productId);
      items.push({
        product_id: productId,
        price: parsed,
        unit: p?.unit ?? null,
        label: (headerCells[priceColIdx] || "").trim() || null,
      });
    }

    if (items.length === 0) {
      toast.error("Nu există rânduri valide pentru salvare (produs + preț numeric)");
      return;
    }

    setSavePricesRunning(true);
    try {
      const { data: sheet, error: sErr } = await supabase
        .from("price_sheets")
        .insert({
          name,
          source: "ocr",
          received_at: new Date().toISOString(),
          active: false,
        })
        .select("id")
        .single();
      if (sErr) throw sErr;
      if (!sheet?.id) throw new Error("Eroare la creare price sheet");

      const payload = items.map((it) => ({
        price_sheet_id: sheet.id,
        product_id: it.product_id,
        price: it.price,
        unit: it.unit,
        label: it.label,
      }));

      const { error: iErr } = await supabase.from("price_sheet_items").insert(payload);
      if (iErr) throw iErr;

      toast.success(`Salvat: ${items.length} prețuri`);
      setSavePricesOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Eroare la salvare prețuri");
    } finally {
      setSavePricesRunning(false);
    }
  };

  const updateCell = (rowId: string, colIndex: number, value: string) => {
    setGridRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const next = [...r.cells];
        next[colIndex] = value;
        return { ...r, cells: next };
      }),
    );
  };

  const deleteColumn = (colIndex: number) => {
    if (headerCells.length <= 1) {
      toast.error("Tabelul trebuie să aibă cel puțin o coloană.");
      return;
    }
    setGridRows((prev) =>
      prev.map((r) => {
        const nextCells = [...r.cells];
        nextCells.splice(colIndex, 1);
        return { ...r, cells: nextCells };
      }),
    );
    const adjustIdx = (idx: number) => {
      if (idx === colIndex) return 0;
      if (idx > colIndex) return idx - 1;
      return idx;
    };
    setMobileLabelColIdx((v) => adjustIdx(v));
    setMobileEditColIdx((v) => adjustIdx(v));
    setMatchNameColIdx((v) => adjustIdx(v));
    setPriceColIdx((v) => adjustIdx(v));
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>, startRowIdx: number, startColIdx: number) => {
    const text = e.clipboardData.getData("text");
    if (!text || (!text.includes("\t") && !text.includes("\n"))) return;
    
    e.preventDefault();
    const pastedRows = text.split(/\r?\n/).filter(line => line.length > 0).map(row => row.split("\t"));
    
    setGridRows((prev) => {
      const next = [...prev];
      for (let r = 0; r < pastedRows.length; r++) {
        const targetRowIdx = startRowIdx + r;
        if (targetRowIdx >= next.length) break;
        
        const row = { ...next[targetRowIdx] };
        const cells = [...row.cells];
        
        for (let c = 0; c < pastedRows[r].length; c++) {
          const targetColIdx = startColIdx + c;
          if (targetColIdx >= cells.length) break;
          cells[targetColIdx] = pastedRows[r][c];
        }
        row.cells = cells;
        next[targetRowIdx] = row;
      }
      return next;
    });
  };

  const importSheet = async () => {
    if (!sheetFile) {
      toast.error("Alegeți un fișier Excel/CSV");
      return;
    }
    if (sheetRunning) return;

    setSheetRunning(true);
    try {
      const name = sheetFile.name.toLowerCase();
      let rawRows: string[][] = [];

      if (isSpreadsheetFile(sheetFile)) {
        const buf = await sheetFile.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const selected = xlsxSheetName || wb.SheetNames[0] || "";
        const sheet = selected ? wb.Sheets[selected] : undefined;
        if (!sheet) {
          toast.error("Fișier Excel invalid (nu are foi)");
          return;
        }
        const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" }) as unknown[];
        rawRows = aoa.map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? "" : String(c))) : [String(r ?? "")]));
      } else {
        const txt = await sheetFile.text();
        const sep = guessDelimitedSeparator(txt);
        rawRows = parseDelimitedText(txt, sep).map((r) => r.map((c) => c ?? ""));
      }

      const nonEmpty = rawRows.filter((r) => r.some((c) => String(c).trim() !== ""));
      const maxCols = nonEmpty.reduce((m, r) => Math.max(m, r.length), 0);
      if (nonEmpty.length === 0 || maxCols === 0) {
        toast.error("Fișierul nu conține date");
        return;
      }

      const built: GridRow[] = nonEmpty.map((r) => ({
        id: crypto.randomUUID(),
        cells: Array.from({ length: maxCols }, (_, i) => String(r[i] ?? "")),
      }));

      setGridRows(built);
      setHeaderRowIndex(0);
      setOcrText("");
      setShowRawText(false);
      setWords([]);
      setLines([]);
      setProgress(0);
      setSuggestionsByRowId({});
      setMatchedProductIdByRowId({});
      setPriceOverridesByRowId({});
      setNewPriceSheetName("");
      setSavePricesOpen(false);
      setFile(null);
      setImageUrl("");
      setSheetFile(null);
      setXlsxSheetNames([]);
      setXlsxSheetName("");
      toast.success("Fișier importat");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Eroare la import");
    } finally {
      setSheetRunning(false);
    }
  };

  const runOcr = async () => {
    if (!file) {
      toast.error("Alegeți o imagine");
      return;
    }
    if (running) return;

    setRunning(true);
    setProgress(0);
    setOcrText("");
    setWords([]);
    setLines([]);
    setGridRows([]);
    setHeaderRowIndex(0);
    setSuggestionsByRowId({});
    setMatchedProductIdByRowId({});
    setPriceOverridesByRowId({});
    setNewPriceSheetName("");
    setSavePricesOpen(false);

    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker(lang, 1, {
        logger: (m: { status?: string; progress?: number }) => {
          if (typeof m?.progress === "number") setProgress(Math.round(m.progress * 100));
        },
      });

      const ret = await worker.recognize(file, {}, { blocks: true });
      const text = ret.data?.text || "";
      const extractedLines = extractLinesFromBlocks(ret.data?.blocks);
      const built = buildGrid(extractedLines, mergePx);
      setOcrText(text);
      setLines(extractedLines);
      setGridRows(built.rows);
      setWords(extractWordsFromBlocks(ret.data?.blocks));
      await worker.terminate();
      toast.success("OCR finalizat");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Eroare OCR");
    } finally {
      setRunning(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Import OCR/Excel</h1>
          <p className="text-muted-foreground">Încarcă o imagine, rulează OCR și verifică rezultatul înainte de potrivire și salvare</p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">1) Upload</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div className="md:col-span-2">
                <Label>Imagine (PNG/JPG)</Label>
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </div>
              <div>
                <Label>Limbă OCR</Label>
                <Select value={lang} onValueChange={(v) => setLang(v as "eng" | "ron")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Alege..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ron">Română</SelectItem>
                    <SelectItem value="eng">Engleză</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div className="md:col-span-2">
                <Label>Excel/CSV (XLSX/CSV/TSV)</Label>
                <Input
                  type="file"
                  accept=".xlsx,.xlsm,.csv,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => setSheetFile(e.target.files?.[0] || null)}
                />
                {xlsxSheetNames.length > 0 && (
                  <div className="mt-2">
                    <Label>Foaie (Excel)</Label>
                    <Select value={xlsxSheetName} onValueChange={setXlsxSheetName}>
                      <SelectTrigger>
                        <SelectValue placeholder="Alege foaia..." />
                      </SelectTrigger>
                      <SelectContent>
                        {xlsxSheetNames.map((sn) => (
                          <SelectItem key={sn} value={sn}>
                            {sn}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={importSheet} disabled={!sheetFile || sheetRunning}>
                  Importă fișier
                </Button>
                {sheetRunning && <div className="text-sm text-muted-foreground">Import...</div>}
                {!sheetRunning && sheetFile && (
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <FileUp className="h-4 w-4" />
                    {sheetFile.name}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={runOcr} disabled={!file || running} className="gap-2">
                <ScanText className="h-4 w-4" />
                Rulează OCR
              </Button>
              {running && (
                <div className="text-sm text-muted-foreground">
                  Procesare: {progress}%
                </div>
              )}
              {!running && file && (
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <FileUp className="h-4 w-4" />
                  {file.name}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">2) Examinare imagine</CardTitle>
            </CardHeader>
            <CardContent>
              {!imageUrl ? (
                <div className="text-sm text-muted-foreground">Încarcă o imagine pentru preview.</div>
              ) : (
                <div className="relative w-full overflow-auto rounded-md border">
                  <img
                    ref={imgRef}
                    src={imageUrl}
                    alt="Upload"
                    className="block max-w-full h-auto"
                    onLoad={(e) => {
                      const el = e.currentTarget;
                      setImageNaturalSize({ width: el.naturalWidth || 1, height: el.naturalHeight || 1 });
                    }}
                  />
                  <canvas ref={canvasRef} className="absolute left-0 top-0 pointer-events-none" />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">3) Tabel extras (editabil)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {gridRows.length === 0 ? (
                <div className="text-sm text-muted-foreground">Rulează OCR ca să obții tabelul.</div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                    <div>
                      <Label title="Ajustează distanța minimă dintre cuvinte pentru a forma coloane separate. O valoare mai mică va despărți mai ușor cuvintele pe mai multe coloane.">
                        Distanță lipire cuvinte (px) ℹ️
                      </Label>
                      <Input
                        type="number"
                        min={1}
                        value={mergePx}
                        onChange={(e) => setMergePx(Math.max(1, Number(e.target.value || 1)))}
                      />
                    </div>
                    <div>
                      <Label title="Indică rândul (începând cu 0) pe care se află denumirile coloanelor.">
                        Rândul cu denumiri coloane (index) ℹ️
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        max={Math.max(0, gridRows.length - 1)}
                        value={headerRowIndex}
                        onChange={(e) => setHeaderRowIndex(Math.max(0, Math.min(gridRows.length - 1, Number(e.target.value || 0))))}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" onClick={regenerateGrid} disabled={lines.length === 0}>
                        Regenerează tabel
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setShowRawText((v) => !v)}>
                        {showRawText ? "Ascunde text" : "Arată text"}
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                    <div className="md:col-span-2">
                      <Label>Coloană denumire produs (pentru potrivire)</Label>
                      <Select value={matchNameColIdx.toString()} onValueChange={(v) => setMatchNameColIdx(Number(v))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {headerCells.map((h, i) => (
                            <SelectItem key={i} value={i.toString()}>
                              {h || `Coloana ${i + 1}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" onClick={generateSuggestionsForAllRows} disabled={bodyRows.length === 0}>
                        Potrivește produse
                      </Button>
                    </div>
                  </div>

                  <div className="hidden md:block rounded-md border overflow-auto">
                    <Table className="min-w-[900px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[60px]">#</TableHead>
                          {headerCells.map((h, idx) => (
                            <TableHead key={idx} className="min-w-[180px]">
                              <div className="flex items-center gap-1">
                                <Input
                                  value={h}
                                  onChange={(e) => {
                                    const headerRow = gridRows[headerRowIndex];
                                    if (!headerRow) return;
                                    updateCell(headerRow.id, idx, e.target.value);
                                  }}
                                  onPaste={(e) => handlePaste(e, headerRowIndex, idx)}
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive flex-shrink-0"
                                  onClick={() => deleteColumn(idx)}
                                  title="Șterge coloana"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableHead>
                          ))}
                          <TableHead className="min-w-[260px]">Produs (DB)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bodyRows.map((r, rowIdx) => (
                          <TableRow key={r.id}>
                            <TableCell className="text-muted-foreground">{rowIdx + 1}</TableCell>
                            {r.cells.map((c, colIdx) => (
                              <TableCell key={colIdx} className="min-w-[180px]">
                                <Input 
                                  value={c} 
                                  onChange={(e) => updateCell(r.id, colIdx, e.target.value)} 
                                  onPaste={(e) => {
                                    const actualRowIdx = gridRows.findIndex(gr => gr.id === r.id);
                                    if (actualRowIdx >= 0) handlePaste(e, actualRowIdx, colIdx);
                                  }}
                                />
                              </TableCell>
                            ))}
                            <TableCell className="min-w-[260px]">
                              <div className="space-y-2">
                                <Select
                                  value={matchedProductIdByRowId[r.id] || ""}
                                  onValueChange={(v) => setMatchedProductForRow(r.id, v || null)}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Alege produs..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(suggestionsByRowId[r.id] || []).map((pid) => {
                                      const p = productsById.get(pid);
                                      if (!p) return null;
                                      return (
                                        <SelectItem key={pid} value={pid}>
                                          {p.cod_intern ? `${p.cod_intern} — ` : ""}
                                          {p.denumire_completa}
                                        </SelectItem>
                                      );
                                    })}
                                  </SelectContent>
                                </Select>
                                <div className="flex gap-2">
                                  <Button type="button" variant="outline" onClick={() => generateSuggestionsForRow(r)}>
                                    Sugerează
                                  </Button>
                                  {!matchedProductIdByRowId[r.id] && (
                                    <Button type="button" variant="outline" onClick={() => openCreateProduct(r)}>
                                      Creează
                                    </Button>
                                  )}
                                  {matchedProductIdByRowId[r.id] && (
                                    <Button type="button" variant="outline" onClick={() => setMatchedProductForRow(r.id, null)}>
                                      Șterge
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* MOBILE VIEW */}
                  <div className="block md:hidden space-y-4">
                    <div className="grid grid-cols-2 gap-3 p-3 bg-muted/50 rounded-md">
                      <div className="space-y-1">
                        <Label className="text-xs">Identificare (Denumire)</Label>
                        <Select
                          value={mobileLabelColIdx.toString()}
                          onValueChange={(v) => setMobileLabelColIdx(Number(v))}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {headerCells.map((h, i) => (
                              <SelectItem key={i} value={i.toString()}>
                                {h || `Coloana ${i + 1}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Coloană de editat</Label>
                        <Select
                          value={mobileEditColIdx.toString()}
                          onValueChange={(v) => setMobileEditColIdx(Number(v))}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {headerCells.map((h, i) => (
                              <SelectItem key={i} value={i.toString()}>
                                {h || `Coloana ${i + 1}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {bodyRows.map((r, rowIdx) => (
                        <div key={r.id} className="p-3 border rounded-md bg-card space-y-3">
                          <div className="text-xs font-medium text-muted-foreground">
                            Rând {rowIdx + 1}
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">
                              {headerCells[mobileLabelColIdx] || `Coloana ${mobileLabelColIdx + 1}`}
                            </Label>
                            <Input
                              value={r.cells[mobileLabelColIdx] || ""}
                              onChange={(e) => updateCell(r.id, mobileLabelColIdx, e.target.value)}
                            />
                          </div>
                          {mobileLabelColIdx !== mobileEditColIdx && (
                            <div className="space-y-1">
                              <Label className="text-xs text-primary font-medium">
                                {headerCells[mobileEditColIdx] || `Coloana ${mobileEditColIdx + 1}`}
                              </Label>
                              <Input
                                value={r.cells[mobileEditColIdx] || ""}
                                onChange={(e) => updateCell(r.id, mobileEditColIdx, e.target.value)}
                                className="border-primary/30 focus-visible:ring-primary"
                              />
                            </div>
                          )}
                          <div className="space-y-2">
                            <Label className="text-xs">Produs (DB)</Label>
                            <Select
                              value={matchedProductIdByRowId[r.id] || ""}
                              onValueChange={(v) => setMatchedProductForRow(r.id, v || null)}
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue placeholder="Alege produs..." />
                              </SelectTrigger>
                              <SelectContent>
                                {(suggestionsByRowId[r.id] || []).map((pid) => {
                                  const p = productsById.get(pid);
                                  if (!p) return null;
                                  return (
                                    <SelectItem key={pid} value={pid}>
                                      {p.cod_intern ? `${p.cod_intern} — ` : ""}
                                      {p.denumire_completa}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                            <div className="flex gap-2">
                              <Button type="button" variant="outline" onClick={() => generateSuggestionsForRow(r)} className="flex-1">
                                Sugerează
                              </Button>
                              {!matchedProductIdByRowId[r.id] && (
                                <Button type="button" variant="outline" onClick={() => openCreateProduct(r)} className="flex-1">
                                  Creează
                                </Button>
                              )}
                              {matchedProductIdByRowId[r.id] && (
                                <Button type="button" variant="outline" onClick={() => setMatchedProductForRow(r.id, null)} className="flex-1">
                                  Șterge
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-md border p-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                      <div className="md:col-span-1">
                        <Label>Coloană preț (pentru comparare/salvare)</Label>
                        <Select
                          value={priceColIdx.toString()}
                          onValueChange={(v) => {
                            setPriceColIdx(Number(v));
                            setPriceOverridesByRowId({});
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {headerCells.map((h, i) => (
                              <SelectItem key={i} value={i.toString()}>
                                {h || `Coloana ${i + 1}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="md:col-span-1">
                        <Label>Nume price sheet nou</Label>
                        <Input value={newPriceSheetName} onChange={(e) => setNewPriceSheetName(e.target.value)} placeholder="Ex: Baumit - Aprilie 2026 (OCR)" />
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" onClick={ensurePriceOverrides} disabled={bodyRows.length === 0}>
                          Preia prețuri
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setSavePricesOpen(true)}
                          disabled={bodyRows.length === 0}
                        >
                          Salvează prețuri
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {bodyRows.map((r) => {
                        const productId = matchedProductIdByRowId[r.id] || null;
                        const product = productId ? productsById.get(productId) : null;
                        const activeSpecial = productId ? activePriceItemByProductId.get(productId) : null;
                        const rawOcr = (r.cells[priceColIdx] || "").trim();
                        const parsedOcr = parsePriceCell(rawOcr);
                        const override = priceOverridesByRowId[r.id] ?? "";
                        const parsedOverride = parsePriceCell(override);
                        return (
                          <div key={r.id} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end p-3 rounded-md bg-muted/30">
                            <div className="md:col-span-2">
                              <Label className="text-xs">Denumire (OCR)</Label>
                              <div className="text-sm">{(r.cells[matchNameColIdx] || "").trim() || "-"}</div>
                            </div>
                            <div>
                              <Label className="text-xs">Preț OCR</Label>
                              <div className="text-sm">{parsedOcr === null ? "-" : parsedOcr.toFixed(2)}</div>
                            </div>
                            <div>
                              <Label className="text-xs">Preț listă (DB)</Label>
                              <div className="text-sm">{product?.pret_lista != null ? Number(product.pret_lista).toFixed(2) : "-"}</div>
                            </div>
                            <div>
                              <Label className="text-xs">Preț activ (sheet)</Label>
                              <div className="text-sm">{activeSpecial ? Number(activeSpecial.price).toFixed(2) : "-"}</div>
                            </div>
                            <div className="md:col-span-2">
                              <Label className="text-xs">Preț de salvat</Label>
                              <Input
                                value={override}
                                onChange={(e) => setPriceOverridesByRowId((prev) => ({ ...prev, [r.id]: e.target.value }))}
                                placeholder={parsedOcr === null ? "" : parsedOcr.toString()}
                                disabled={!productId}
                              />
                            </div>
                            <div className="md:col-span-3 text-xs text-muted-foreground">
                              {productId ? (
                                <>
                                  {product?.cod_intern ? `${product.cod_intern} — ` : ""}
                                  {product?.denumire_completa || ""}
                                  {parsedOverride === null && override.trim() !== "" ? " · preț invalid" : ""}
                                </>
                              ) : (
                                "Alege produs ca să poți salva prețul"
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {showRawText && (
                <Textarea
                  value={ocrText}
                  onChange={(e) => setOcrText(e.target.value)}
                  rows={10}
                  placeholder="Textul OCR (opțional)"
                />
              )}

              <div className="text-xs text-muted-foreground">
                {words.length ? `${words.length} cuvinte detectate (bbox desenate pe imagine).` : "BBox nu sunt afișate până nu rulezi OCR."}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Observații</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">
              Dacă OCR-ul prinde mai multe numere pe rând (ex: grosimi + mai multe coloane de preț), tabelul de mai sus păstrează coloanele pe poziția lor din imagine.
            </div>
          </CardContent>
        </Card>

        <AlertDialog open={createProductRowId !== null} onOpenChange={(open) => !open && setCreateProductRowId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Creează produs nou?</AlertDialogTitle>
              <AlertDialogDescription>
                Produsul va fi adăugat în baza de date și apoi selectat pe rândul curent.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Denumire</Label>
                <Input value={createProductName} onChange={(e) => setCreateProductName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Cod intern</Label>
                <Input value={createProductCodIntern} onChange={(e) => setCreateProductCodIntern(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>UM (opțional)</Label>
                <Input value={createProductUnit} onChange={(e) => setCreateProductUnit(e.target.value)} placeholder="Ex: buc / sac / kg" />
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={createProductRunning}>Anulează</AlertDialogCancel>
              <AlertDialogAction onClick={createProduct} disabled={createProductRunning}>
                Creează
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={savePricesOpen} onOpenChange={setSavePricesOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Salvezi prețurile într-un price sheet nou?</AlertDialogTitle>
              <AlertDialogDescription>
                Se va crea o foaie nouă și se vor salva doar rândurile care au produs selectat și preț numeric.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={savePricesRunning}>Anulează</AlertDialogCancel>
              <AlertDialogAction onClick={savePricesToNewPriceSheet} disabled={savePricesRunning}>
                Salvează
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
};

export default ImportOcr;
