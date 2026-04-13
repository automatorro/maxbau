import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { FileUp, ScanText } from "lucide-react";

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
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
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
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string>("");
  const [lang, setLang] = useState<"eng" | "ron">("ron");
  const [running, setRunning] = useState(false);
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

  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const { data: productsForMatch = [] } = useQuery({
    queryKey: ["products-for-ocr-match"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("id, cod_intern, denumire_completa, unit");
      if (error) throw error;
      return data as ProductForMatch[];
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

  const headerCells = useMemo(() => {
    const row = gridRows[headerRowIndex];
    return row ? row.cells : [];
  }, [gridRows, headerRowIndex]);

  const bodyRows = useMemo(() => {
    return gridRows.filter((_, idx) => idx !== headerRowIndex);
  }, [gridRows, headerRowIndex]);

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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                      <Label>Granularitate coloane (px)</Label>
                      <Input
                        type="number"
                        min={1}
                        value={mergePx}
                        onChange={(e) => setMergePx(Math.max(1, Number(e.target.value || 1)))}
                      />
                    </div>
                    <div>
                      <Label>Rând header (index)</Label>
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
                              <Input
                                value={h}
                                onChange={(e) => {
                                  const headerRow = gridRows[headerRowIndex];
                                  if (!headerRow) return;
                                  updateCell(headerRow.id, idx, e.target.value);
                                }}
                              />
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
                                <Input value={c} onChange={(e) => updateCell(r.id, colIdx, e.target.value)} />
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
      </div>
    </DashboardLayout>
  );
};

export default ImportOcr;
