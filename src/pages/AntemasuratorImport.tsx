import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import * as pdfjsLib from "pdfjs-dist";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Upload,
  FileText,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  Plus,
  Trash2,
  ClipboardList,
  Info,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface ExtractedItem {
  id: string;
  nr?: string;
  sectiune?: string;
  descriere_client: string;
  cantitate: number;
  unitate: string;
}

interface MatchedProduct {
  product_id: string;
  cod_intern: string;
  denumire_completa: string;
  pret_lista: number;
  unit: string;
  justificare: string;
  scor: number;
}

type MatchStatus = "pending" | "loading" | "found" | "not_found";

interface ItemWithMatch extends ExtractedItem {
  matchStatus: MatchStatus;
  alternatives: MatchedProduct[];
  selectedMatchIdx: number | null;
  de_procurat: boolean;
}

// ── Client-side parsers ───────────────────────────────────────────────────────

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

const NORM_MAP: Record<string, string> = {
  ă: "a", â: "a", î: "i", ș: "s", ț: "t",
  Ă: "A", Â: "A", Î: "I", Ș: "S", Ț: "T",
};
function norm(s: string): string {
  return s
    .split("")
    .map((c) => NORM_MAP[c] ?? c)
    .join("")
    .toLowerCase()
    .trim();
}

// ── Text parser (for copy-paste from PDF/Excel) ───────────────────────────────
//
// Handles lines like:
//   "1  Vată minerală bazaltică 15 cm  1386 pac"
//   "Adeziv polistiren   5  25  157"   ← last number + known unit
//   "27 GLAFURI EXT. 190 BUC."

const KNOWN_UNITS = [
  "pac", "saci", "sac", "role", "rola", "buc", "ml", "mp", "mc",
  "gal", "galeti", "galet", "kg", "cutie", "cutii", "m", "t", "aprox",
];

function parseTextToItems(text: string): ExtractedItem[] {
  const unitRx = new RegExp(
    `\\b(${KNOWN_UNITS.join("|")})\\.?\\b`,
    "i"
  );
  const items: ExtractedItem[] = [];
  let currentSection = "";

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    // Section header: no digits or only very few, all-caps-ish, or known keywords
    const hasDigit = /\d/.test(line);
    const isHeaderKeyword =
      /termosistem|soclu|invelitoare|învelitoare|accesorii|trotuar|izolare|placa|planseu/i.test(
        line
      );
    if (
      (!hasDigit && line.length > 6 && /^[A-ZĂÂÎȘȚ\s.\/\-:0-9]{6,}$/i.test(line)) ||
      isHeaderKeyword
    ) {
      currentSection = line;
      continue;
    }

    // Find last occurrence of "number unit" at or near end of line
    const unitMatch = unitRx.exec(line);
    if (!unitMatch) continue;

    const unitWord = unitMatch[1];
    const beforeUnit = line.slice(0, unitMatch.index).trim();

    // Find last standalone number before the unit
    const numMatches = [...beforeUnit.matchAll(/(\d+(?:[.,]\d+)?)/g)];
    if (!numMatches.length) continue;

    const lastNum = numMatches[numMatches.length - 1];
    const qty = parseFloat(lastNum[0].replace(",", "."));
    if (!qty || qty <= 0) continue;

    // Everything before the quantity is description (strip leading "nr.")
    const beforeQty = beforeUnit.slice(0, lastNum.index!).trim();
    const descMatch = /^(\d+[.):\s]+)?(.+)$/.exec(beforeQty);
    if (!descMatch?.[2]?.trim()) continue;

    const descriere = descMatch[2].trim();
    if (descriere.length < 3) continue;
    if (isDateDeCalcul(descriere)) continue;

    items.push({
      id: randomId(),
      nr: descMatch[1]?.replace(/[.):\s]+$/, "").trim() || String(items.length + 1),
      sectiune: currentSection || undefined,
      descriere_client: descriere,
      cantitate: qty,
      unitate: unitWord,
    });
  }

  return items;
}

// ── "Date de calcul" filter ───────────────────────────────────────────────────
// Antemasurătorile încep cu un tabel de date de referință ale clădirii
// (suprafețe, perimetre, nr. ferestre) care NU sunt produse de achiziționat.

const DATE_CALCUL_KEYWORDS = [
  "arie ", "arie\t", "perimetru", "nr. fereastr", "nr. ferestre",
  "suprafata", "suprafață", "lungime", "adancime", "inaltime", "înălțime",
];

function isDateDeCalcul(name: string): boolean {
  const n = norm(name);
  return DATE_CALCUL_KEYWORDS.some((kw) => n.startsWith(kw) || n.includes(" " + kw));
}

// ── OCR table → ExtractedItem[] mapper ───────────────────────────────────────
//
// ocr-whatsapp returns {headers: string[], rows: string[][]}
// We detect which column is name / quantity / unit by header keywords.

function mapOcrToItems(headers: string[], rows: string[][]): ExtractedItem[] {
  const h = headers.map(norm);

  // Column index finders
  const find = (...keywords: string[]) =>
    h.findIndex((c) => keywords.some((k) => c.includes(k)));

  const nameIdx = find("denu", "produ", "materi", "descri", "articol");
  // "Necesar pachete/buc total" or "Cantitate necesara" — the actual needed qty
  const qtyIdx = find("necesar", "cantit", "total", "qty", "buc. total");
  const unitIdx = find("um", "u.m", "unit", "masur");
  const secIdx = find("sectiu", "categ", "grup");

  const fallbackNameIdx = nameIdx >= 0 ? nameIdx : 0;
  // If no qty col found, try last numeric-looking column
  const numericColIdx = (row: string[]) => {
    for (let i = row.length - 1; i >= 0; i--) {
      if (i === fallbackNameIdx) continue;
      if (/^\d+([.,]\d+)?$/.test(row[i].trim())) return i;
    }
    return -1;
  };

  return rows
    .filter((row) => row.some((c) => c.trim()))
    .map((row, i) => {
      const name = row[fallbackNameIdx]?.trim() ?? "";
      const rawQty =
        qtyIdx >= 0 ? row[qtyIdx] : row[numericColIdx(row)] ?? "";
      const rawUnit = unitIdx >= 0 ? row[unitIdx] : "";

      // Try to extract unit from name if not found
      let unit = rawUnit.trim();
      if (!unit) {
        const m = unitRxGlobal.exec(name);
        if (m) unit = m[1];
      }

      return {
        id: randomId(),
        nr: String(i + 1),
        sectiune: secIdx >= 0 ? row[secIdx]?.trim() : undefined,
        descriere_client: name,
        cantitate: parseFloat(rawQty.replace(",", ".")) || 0,
        unitate: unit || "buc",
      };
    })
    .filter(
      (it) =>
        it.descriere_client.length > 2 &&
        it.cantitate > 0
    );
}

// ── PDF text extractor (pdfjs-dist, toate paginile) ──────────────────────────
// getTextContent() returnează elemente poziționate (x, y) în ordine arbitrară.
// Le grupăm pe rânduri după coordonata Y (toleranță 4pt), sortăm după X.

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

async function extractTextFromPdf(buf: ArrayBuffer): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const allLines: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const items = (content.items as any[]).filter((it) => it.str?.trim());
    if (!items.length) continue;

    // Grupăm elementele pe rânduri: tolerance 4pt în coordonata Y
    const rowMap = new Map<number, { x: number; str: string }[]>();
    for (const item of items) {
      const x: number = item.transform[4];
      const y: number = item.transform[5];
      const yRounded = Math.round(y);

      let rowKey = -Infinity;
      for (const [ky] of rowMap) {
        if (Math.abs(ky - yRounded) <= 4) { rowKey = ky; break; }
      }
      if (rowKey === -Infinity) {
        rowMap.set(yRounded, []);
        rowKey = yRounded;
      }
      rowMap.get(rowKey)!.push({ x, str: item.str });
    }

    // Sortăm rândurile de sus în jos (Y mare = sus în PDF)
    const sortedRows = [...rowMap.entries()]
      .sort(([ya], [yb]) => yb - ya)
      .map(([, els]) =>
        els
          .sort((a, b) => a.x - b.x)
          .map((e) => e.str)
          .join(" ")
          .trim()
      )
      .filter((l) => l.length > 0);

    allLines.push(...sortedRows);
  }

  return allLines.join("\n");
}

const unitRxGlobal = new RegExp(
  `\\b(${KNOWN_UNITS.join("|")})\\.?\\b`,
  "i"
);

// ── Excel → ExtractedItem[] ───────────────────────────────────────────────────

function parseExcelToItems(buf: ArrayBuffer): ExtractedItem[] {
  const wb = XLSX.read(buf, { type: "array" });
  const allItems: ExtractedItem[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows: string[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: "",
      raw: false,
    }) as string[][];

    if (!rows.length) continue;

    // Find header row (first row that has 3+ non-empty cells)
    const headerRowIdx = rows.findIndex(
      (r) => r.filter((c) => String(c).trim()).length >= 3
    );
    if (headerRowIdx < 0) continue;

    const headers = rows[headerRowIdx].map((c) => String(c));
    const dataRows = rows.slice(headerRowIdx + 1).map((r) =>
      r.map((c) => String(c))
    );

    const mapped = mapOcrToItems(headers, dataRows);
    allItems.push(...mapped);
  }

  return allItems;
}

// ── Concurrency helper ────────────────────────────────────────────────────────

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
  onDone?: (done: number) => void
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let idx = 0;
  let done = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
      done++;
      onDone?.(done);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// ── Step indicator ────────────────────────────────────────────────────────────

const STEPS = ["Extragere", "Matching AI", "Generare Ofertă"];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2 mb-6 flex-wrap">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <div key={n} className="flex items-center gap-2">
            <div
              className={`flex items-center justify-center w-7 h-7 rounded-full text-sm font-semibold border-2 transition-colors ${
                done
                  ? "bg-green-500 border-green-500 text-white"
                  : active
                  ? "bg-primary border-primary text-primary-foreground"
                  : "border-muted-foreground/40 text-muted-foreground"
              }`}
            >
              {done ? <CheckCircle2 className="w-4 h-4" /> : n}
            </div>
            <span
              className={`text-sm font-medium ${
                active ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AntemasuratorImport() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1
  const [textInput, setTextInput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [items, setItems] = useState<ExtractedItem[]>([]);
  const [activeTab, setActiveTab] = useState<"file" | "text">("file");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2
  const [itemsWithMatches, setItemsWithMatches] = useState<ItemWithMatch[]>([]);
  const [matchProgress, setMatchProgress] = useState(0);
  const [matching, setMatching] = useState(false);

  // Step 3
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [projectDesc, setProjectDesc] = useState("");
  const [saving, setSaving] = useState(false);

  // ── Step 1 handlers ───────────────────────────────────────────────────────

  const applyItems = useCallback(
    (parsed: ExtractedItem[], source: string) => {
      if (!parsed.length) {
        toast.error(`Nu s-au identificat produse în ${source}`);
        return;
      }
      setItems(parsed);
      toast.success(`${parsed.length} produse extrase din ${source}`);
    },
    []
  );

  const handleExtractText = useCallback(() => {
    if (!textInput.trim()) {
      toast.error("Introduceți textul antemasurătorii");
      return;
    }
    const parsed = parseTextToItems(textInput);
    applyItems(parsed, "text");
  }, [textInput, applyItems]);

  const handleFileUpload = useCallback(
    async (file: File) => {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      setProcessing(true);

      try {
        if (ext === "xlsx" || ext === "xls") {
          // Excel → client-side XLSX parsing
          const buf = await file.arrayBuffer();
          applyItems(parseExcelToItems(buf), "Excel");
        } else if (ext === "pdf") {
          // PDF → pdfjs extrage text din TOATE paginile → parser text
          const buf = await file.arrayBuffer();
          const text = await extractTextFromPdf(buf);
          const parsed = parseTextToItems(text);
          applyItems(parsed, "PDF");
        } else {
          // Imagine → ocr-whatsapp (Gemini vision)
          const buf = await file.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = "";
          for (let i = 0; i < bytes.length; i++)
            binary += String.fromCharCode(bytes[i]);
          const base64 = btoa(binary);
          const mime = file.type || "image/jpeg";

          const { data, error } = await supabase.functions.invoke(
            "ocr-whatsapp",
            { body: { image_base64: base64, mime_type: mime } }
          );

          if (error) throw new Error(error.message ?? "Eroare OCR");
          if (!data?.headers || !data?.rows) {
            toast.error("Imaginea nu conține un tabel lizibil");
            return;
          }

          applyItems(
            mapOcrToItems(data.headers as string[], data.rows as string[][]),
            file.name
          );
        }
      } catch (e: any) {
        toast.error("Eroare procesare: " + (e.message ?? "necunoscută"));
      } finally {
        setProcessing(false);
      }
    },
    [applyItems]
  );

  const addEmptyItem = () =>
    setItems((prev) => [
      ...prev,
      { id: randomId(), descriere_client: "", cantitate: 0, unitate: "buc" },
    ]);

  const removeItem = (id: string) =>
    setItems((prev) => prev.filter((i) => i.id !== id));

  const updateItem = (id: string, field: keyof ExtractedItem, value: any) =>
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, [field]: value } : i))
    );

  const validItems = items.filter(
    (i) => i.descriere_client.trim() && i.cantitate > 0
  );

  // ── Step 2 helpers ────────────────────────────────────────────────────────

  const updateMatchedItem = (idx: number, field: keyof ItemWithMatch, value: any) =>
    setItemsWithMatches((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it))
    );

  const removeMatchedItem = (idx: number) =>
    setItemsWithMatches((prev) => prev.filter((_, i) => i !== idx));

  const addEmptyMatchedItem = () =>
    setItemsWithMatches((prev) => [
      ...prev,
      {
        id: randomId(),
        descriere_client: "",
        cantitate: 0,
        unitate: "buc",
        matchStatus: "pending" as MatchStatus,
        alternatives: [],
        selectedMatchIdx: null,
        de_procurat: false,
      },
    ]);

  // ── Step 2: AI Matching ───────────────────────────────────────────────────

  const startMatching = useCallback(async () => {
    if (!validItems.length) {
      toast.error(
        "Adăugați cel puțin un produs valid (cu denumire și cantitate)"
      );
      return;
    }

    setStep(2);
    setMatching(true);
    setMatchProgress(0);

    setItemsWithMatches(
      validItems.map((i) => ({
        ...i,
        matchStatus: "pending" as MatchStatus,
        alternatives: [],
        selectedMatchIdx: null,
        de_procurat: false,
      }))
    );

    const tasks = validItems.map((item, idx) => async () => {
      setItemsWithMatches((prev) =>
        prev.map((it, i) =>
          i === idx ? { ...it, matchStatus: "loading" } : it
        )
      );

      try {
        const { data, error } = await supabase.functions.invoke(
          "ai-find-equivalent",
          { body: { cerere_client: item.descriere_client } }
        );

        if (error || !data?.success) {
          setItemsWithMatches((prev) =>
            prev.map((it, i) =>
              i === idx
                ? { ...it, matchStatus: "not_found", de_procurat: true }
                : it
            )
          );
          return;
        }

        const echivalente: MatchedProduct[] = (data.echivalente ?? [])
          .filter((e: any) => e.scor >= 35)
          .slice(0, 5);

        const found = echivalente.length > 0;
        setItemsWithMatches((prev) =>
          prev.map((it, i) =>
            i === idx
              ? {
                  ...it,
                  matchStatus: found ? "found" : "not_found",
                  alternatives: echivalente,
                  selectedMatchIdx: found ? 0 : null,
                  de_procurat: !found,
                }
              : it
          )
        );
      } catch {
        setItemsWithMatches((prev) =>
          prev.map((it, i) =>
            i === idx
              ? { ...it, matchStatus: "not_found", de_procurat: true }
              : it
          )
        );
      }
    });

    await runWithConcurrency(tasks, 5, (done) => {
      setMatchProgress(Math.round((done / validItems.length) * 100));
    });

    setMatching(false);
  }, [validItems]);

  // ── Step 3: Generate Quote ────────────────────────────────────────────────

  const generateQuote = useCallback(async () => {
    if (!clientName.trim()) {
      toast.error("Introduceți numele clientului");
      return;
    }
    setSaving(true);

    try {
      const quoteItemRows = itemsWithMatches.map((item) => {
        const match =
          !item.de_procurat && item.selectedMatchIdx !== null
            ? item.alternatives[item.selectedMatchIdx]
            : null;
        const pretUnitar = match?.pret_lista ?? 0;
        return {
          product_id: match?.product_id ?? null,
          cod_intern: match?.cod_intern ?? "CERERE",
          denumire: match ? match.denumire_completa : item.descriere_client,
          quantity: item.cantitate,
          unit: match?.unit ?? item.unitate,
          pret_unitar: pretUnitar,
          discount_percent: 0,
          pret_final: pretUnitar,
          subtotal: pretUnitar * item.cantitate,
          cerere_initiala: item.descriere_client,
          nota_echivalenta: match
            ? `Echivalent propus AI (scor ${match.scor}/100): ${match.justificare}`
            : "De procurat — nu există în catalogul maxbau",
        };
      });

      const totalNet = quoteItemRows.reduce((s, i) => s + i.subtotal, 0);
      const totalTva = totalNet * 0.19;

      const { data: quote, error: quoteErr } = await supabase
        .from("quotes")
        .insert({
          user_id: user!.id,
          client_name: clientName.trim(),
          client_phone: clientPhone.trim() || null,
          client_email: clientEmail.trim() || null,
          project_description: projectDesc.trim() || null,
          status: "draft",
          total_net: totalNet,
          total_tva: totalTva,
          total_gross: totalNet + totalTva,
        })
        .select("id")
        .single();

      if (quoteErr) throw quoteErr;

      if (quoteItemRows.length > 0) {
        const { error: itemsErr } = await supabase
          .from("quote_items")
          .insert(
            quoteItemRows.map((qi) => ({ ...qi, quote_id: quote.id }))
          );
        if (itemsErr) throw itemsErr;
      }

      toast.success(
        "Ofertă creată! Poți ajusta prețurile și discounturile."
      );
      navigate(`/quote/${quote.id}/edit`);
    } catch (e: any) {
      toast.error("Eroare la salvare: " + (e.message ?? "necunoscută"));
    } finally {
      setSaving(false);
    }
  }, [
    clientName,
    clientPhone,
    clientEmail,
    projectDesc,
    itemsWithMatches,
    user,
    navigate,
  ]);

  // ── Render ────────────────────────────────────────────────────────────────

  const foundCount = itemsWithMatches.filter(
    (i) => !i.de_procurat && i.alternatives.length > 0
  ).length;
  const procuratCount = itemsWithMatches.filter((i) => i.de_procurat).length;

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-1">Import Antemasurătoare</h1>
        <p className="text-muted-foreground mb-6">
          Încarcă o antemasurătoare (PDF, Excel, imagine sau text) — AI
          identifică produsele echivalente din catalog și generează oferta.
        </p>

        <StepIndicator current={step} />

        {/* ── STEP 1 ─────────────────────────────────────────────────────── */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="w-5 h-5" />
                1. Introdu antemasurătoarea
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as "file" | "text")}
              >
                <TabsList className="mb-4">
                  <TabsTrigger value="file">
                    <Upload className="w-4 h-4 mr-2" />
                    Fișier (PDF · Excel · Imagine)
                  </TabsTrigger>
                  <TabsTrigger value="text">
                    <FileText className="w-4 h-4 mr-2" />
                    Text / Copy-paste
                  </TabsTrigger>
                </TabsList>

                {/* File upload */}
                <TabsContent value="file">
                  <div
                    className="border-2 border-dashed border-muted rounded-lg p-10 text-center cursor-pointer hover:border-primary transition-colors"
                    onClick={() =>
                      !processing && fileInputRef.current?.click()
                    }
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files[0];
                      if (f && !processing) handleFileUpload(f);
                    }}
                  >
                    {processing ? (
                      <div className="flex flex-col items-center gap-3 text-muted-foreground">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        <p>Procesare document...</p>
                        <p className="text-xs">
                          PDF și imagini: extragere tabel via AI · Excel:
                          procesare directă
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <Upload className="w-10 h-10 text-muted-foreground" />
                        <p className="font-medium">
                          Trage fișierul aici sau click pentru selectare
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Excel (.xlsx, .xls) · PDF · Imagini (JPG, PNG, WebP)
                        </p>
                      </div>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png,.webp"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileUpload(f);
                      e.target.value = "";
                    }}
                  />
                  <div className="mt-3 flex items-start gap-2 rounded-md bg-blue-50 border border-blue-200 p-3">
                    <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-blue-700">
                      <strong>Excel</strong> — cel mai precis, procesare instant. &nbsp;
                      <strong>PDF/Imagine</strong> — extragere OCR via AI. &nbsp;
                      <strong>PDF multi-pagină</strong> — OCR extrage primul tabel; produsele de pe paginile 2+ pot fi adăugate manual sau prin tab-ul <em>Text / Copy-paste</em>.
                    </p>
                  </div>
                </TabsContent>

                {/* Text paste */}
                <TabsContent value="text">
                  <Textarea
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    placeholder={
                      "Lipește textul antemasurătorii sau copiază direct din Excel...\n\n" +
                      "Exemplu:\n" +
                      "TERMOSISTEM FATADA\n" +
                      "1  Vată minerală bazaltică 15 cm  1386 pac\n" +
                      "2  Adeziv masă șpaclu vată minerală  533 saci\n" +
                      "3  Plasă armare fibră sticlă 160g/m²  37 role"
                    }
                    rows={12}
                    className="font-mono text-sm mb-3"
                  />
                  <Button
                    onClick={handleExtractText}
                    disabled={!textInput.trim()}
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Extrage produse
                  </Button>
                  <p className="text-xs text-muted-foreground mt-2">
                    Parserul detectează automat produsele și cantitățile.
                    Verifică și corectează rezultatul în tabelul de mai jos.
                  </p>
                </TabsContent>
              </Tabs>

              {/* Extracted items table */}
              {items.length > 0 && (
                <div className="mt-6">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-muted-foreground">
                      {items.length} produse extrase — verificați și corectați
                      dacă e necesar
                    </p>
                    <Button variant="outline" size="sm" onClick={addEmptyItem}>
                      <Plus className="w-3 h-3 mr-1" />
                      Adaugă rând
                    </Button>
                  </div>

                  <div className="rounded border overflow-auto max-h-[420px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">#</TableHead>
                          <TableHead className="w-36">Secțiune</TableHead>
                          <TableHead>Denumire produs (din cerere)</TableHead>
                          <TableHead className="w-28">Cantitate</TableHead>
                          <TableHead className="w-24">UM</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((item, i) => (
                          <TableRow key={item.id}>
                            <TableCell className="text-xs text-muted-foreground">
                              {item.nr || i + 1}
                            </TableCell>
                            <TableCell>
                              <Input
                                value={item.sectiune ?? ""}
                                onChange={(e) =>
                                  updateItem(
                                    item.id,
                                    "sectiune",
                                    e.target.value
                                  )
                                }
                                className="h-7 text-xs"
                                placeholder="Secțiune"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={item.descriere_client}
                                onChange={(e) =>
                                  updateItem(
                                    item.id,
                                    "descriere_client",
                                    e.target.value
                                  )
                                }
                                className="h-7 text-xs"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                value={item.cantitate || ""}
                                onChange={(e) =>
                                  updateItem(
                                    item.id,
                                    "cantitate",
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                                className="h-7 text-xs"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={item.unitate}
                                onChange={(e) =>
                                  updateItem(
                                    item.id,
                                    "unitate",
                                    e.target.value
                                  )
                                }
                                className="h-7 text-xs"
                              />
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => removeItem(item.id)}
                              >
                                <Trash2 className="w-3 h-3 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="mt-4 flex justify-end">
                    <Button
                      onClick={startMatching}
                      size="lg"
                      disabled={validItems.length === 0}
                    >
                      <Sparkles className="w-4 h-4 mr-2" />
                      Caută echivalente AI ({validItems.length} produse)
                      <ChevronRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── STEP 2 ─────────────────────────────────────────────────────── */}
        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5" />
                2. Echivalente din catalogul maxbau
              </CardTitle>
            </CardHeader>
            <CardContent>
              {matching && (
                <div className="mb-5">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">
                      AI procesează produsele...
                    </span>
                    <span className="font-medium">{matchProgress}%</span>
                  </div>
                  <Progress value={matchProgress} className="h-2" />
                  <p className="text-xs text-muted-foreground mt-1">
                    Fiecare produs este clasificat în categoria corectă, apoi AI
                    alege cel mai bun echivalent tehnic ignorând brandul.
                  </p>
                </div>
              )}

              <div className="flex justify-end mb-2">
                <Button variant="outline" size="sm" onClick={addEmptyMatchedItem}>
                  <Plus className="w-3 h-3 mr-1" />
                  Adaugă rând
                </Button>
              </div>

              <div className="rounded border overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[200px]">
                        Cerere client
                      </TableHead>
                      <TableHead className="w-24">Cant.</TableHead>
                      <TableHead className="w-20">UM</TableHead>
                      <TableHead className="w-28">Status</TableHead>
                      <TableHead className="min-w-[300px]">
                        Produs propus din catalog
                      </TableHead>
                      <TableHead className="w-36">De procurat</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itemsWithMatches.map((item, idx) => {
                      const selectedProduct =
                        item.selectedMatchIdx !== null
                          ? item.alternatives[item.selectedMatchIdx]
                          : null;

                      return (
                        <TableRow
                          key={item.id}
                          className={
                            item.de_procurat ? "bg-amber-50/60" : ""
                          }
                        >
                          <TableCell>
                            <Input
                              value={item.descriere_client}
                              onChange={(e) =>
                                updateMatchedItem(idx, "descriere_client", e.target.value)
                              }
                              className="h-7 text-xs"
                              placeholder="Denumire produs"
                            />
                            {item.sectiune && (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {item.sectiune}
                              </div>
                            )}
                          </TableCell>

                          <TableCell>
                            <Input
                              type="number"
                              value={item.cantitate || ""}
                              onChange={(e) =>
                                updateMatchedItem(idx, "cantitate", parseFloat(e.target.value) || 0)
                              }
                              className="h-7 text-xs w-20"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={item.unitate}
                              onChange={(e) =>
                                updateMatchedItem(idx, "unitate", e.target.value)
                              }
                              className="h-7 text-xs w-16"
                            />
                          </TableCell>

                          <TableCell>
                            {item.matchStatus === "pending" && (
                              <Badge variant="outline" className="text-xs">
                                Așteptare
                              </Badge>
                            )}
                            {item.matchStatus === "loading" && (
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Caută...
                              </div>
                            )}
                            {item.matchStatus !== "pending" &&
                              item.matchStatus !== "loading" &&
                              !item.de_procurat && (
                                <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">
                                  <CheckCircle2 className="w-3 h-3 mr-1" />
                                  Găsit ({selectedProduct?.scor ?? 0}%)
                                </Badge>
                              )}
                            {item.matchStatus !== "pending" &&
                              item.matchStatus !== "loading" &&
                              item.de_procurat && (
                                <Badge
                                  variant="outline"
                                  className="border-amber-400 text-amber-700 text-xs"
                                >
                                  <AlertTriangle className="w-3 h-3 mr-1" />
                                  De procurat
                                </Badge>
                              )}
                          </TableCell>

                          <TableCell>
                            {!item.de_procurat &&
                            item.alternatives.length > 0 ? (
                              <div>
                                <Select
                                  value={String(item.selectedMatchIdx ?? 0)}
                                  onValueChange={(val) =>
                                    setItemsWithMatches((prev) =>
                                      prev.map((it, i) =>
                                        i === idx
                                          ? {
                                              ...it,
                                              selectedMatchIdx: parseInt(val),
                                            }
                                          : it
                                      )
                                    )
                                  }
                                >
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {item.alternatives.map((alt, ai) => (
                                      <SelectItem
                                        key={alt.cod_intern}
                                        value={String(ai)}
                                      >
                                        <span className="font-mono text-xs text-muted-foreground mr-2">
                                          {alt.cod_intern}
                                        </span>
                                        {alt.denumire_completa.length > 55
                                          ? alt.denumire_completa.slice(
                                              0,
                                              55
                                            ) + "…"
                                          : alt.denumire_completa}
                                        <span className="ml-2 text-muted-foreground">
                                          ({alt.scor}%)
                                        </span>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {selectedProduct && (
                                  <p className="text-xs text-muted-foreground mt-1 leading-snug">
                                    {selectedProduct.justificare}
                                  </p>
                                )}
                              </div>
                            ) : item.de_procurat ? (
                              <span className="text-xs text-muted-foreground italic">
                                Nicio potrivire în catalog
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </TableCell>

                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Checkbox
                                checked={item.de_procurat}
                                onCheckedChange={(checked) =>
                                  setItemsWithMatches((prev) =>
                                    prev.map((it, i) =>
                                      i === idx
                                        ? { ...it, de_procurat: !!checked }
                                        : it
                                    )
                                  )
                                }
                              />
                              <span className="text-xs text-muted-foreground">
                                Procurare specială
                              </span>
                            </div>
                          </TableCell>

                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => removeMatchedItem(idx)}
                            >
                              <Trash2 className="w-3 h-3 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {!matching && itemsWithMatches.length > 0 && (
                <div className="mt-4 flex items-center justify-between">
                  <div className="flex gap-6 text-sm">
                    <span className="text-green-700 font-medium">
                      <CheckCircle2 className="w-4 h-4 inline mr-1" />
                      {foundCount} găsite în catalog
                    </span>
                    <span className="text-amber-700 font-medium">
                      <AlertTriangle className="w-4 h-4 inline mr-1" />
                      {procuratCount} de procurat
                    </span>
                  </div>
                  <Button onClick={() => setStep(3)} size="lg">
                    Continuă la ofertă
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── STEP 3 ─────────────────────────────────────────────────────── */}
        {step === 3 && (
          <Card>
            <CardHeader>
              <CardTitle>3. Date client și generare ofertă</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="space-y-1">
                  <Label htmlFor="clientName">Nume client *</Label>
                  <Input
                    id="clientName"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="ex: SC Construct SRL"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="clientPhone">Telefon</Label>
                  <Input
                    id="clientPhone"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    placeholder="07xx xxx xxx"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="clientEmail">Email</Label>
                  <Input
                    id="clientEmail"
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                    placeholder="client@email.com"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="projectDesc">Descriere proiect</Label>
                  <Input
                    id="projectDesc"
                    value={projectDesc}
                    onChange={(e) => setProjectDesc(e.target.value)}
                    placeholder="ex: Reabilitare bloc Bv. Eroilor, Timișoara"
                  />
                </div>
              </div>

              {/* Summary table */}
              <div className="rounded border overflow-auto mb-5">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cerere client</TableHead>
                      <TableHead>Produs catalog</TableHead>
                      <TableHead className="w-24">Cant.</TableHead>
                      <TableHead className="w-20">UM</TableHead>
                      <TableHead className="w-28 text-right">
                        Preț/unit.
                      </TableHead>
                      <TableHead className="w-28 text-right">Subtotal</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itemsWithMatches.map((item, idx) => {
                      const match =
                        !item.de_procurat && item.selectedMatchIdx !== null
                          ? item.alternatives[item.selectedMatchIdx]
                          : null;
                      const subtotal =
                        (match?.pret_lista ?? 0) * item.cantitate;

                      return (
                        <TableRow
                          key={item.id}
                          className={item.de_procurat ? "bg-amber-50/60" : ""}
                        >
                          <TableCell className="text-sm">
                            <Input
                              value={item.descriere_client}
                              onChange={(e) =>
                                updateMatchedItem(idx, "descriere_client", e.target.value)
                              }
                              className="h-7 text-xs"
                            />
                          </TableCell>
                          <TableCell className="text-sm">
                            {match ? (
                              <>
                                <span className="font-mono text-xs text-muted-foreground mr-1">
                                  {match.cod_intern}
                                </span>
                                {match.denumire_completa}
                              </>
                            ) : (
                              <Badge
                                variant="outline"
                                className="border-amber-400 text-amber-700 text-xs"
                              >
                                De procurat
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={item.cantitate || ""}
                              onChange={(e) =>
                                updateMatchedItem(idx, "cantitate", parseFloat(e.target.value) || 0)
                              }
                              className="h-7 text-xs w-20"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={item.unitate}
                              onChange={(e) =>
                                updateMatchedItem(idx, "unitate", e.target.value)
                              }
                              className="h-7 text-xs w-16"
                            />
                          </TableCell>
                          <TableCell className="text-sm text-right tabular-nums">
                            {match
                              ? `${match.pret_lista.toFixed(2)} lei`
                              : "—"}
                          </TableCell>
                          <TableCell className="text-sm text-right tabular-nums font-medium">
                            {subtotal > 0
                              ? `${subtotal.toFixed(2)} lei`
                              : "—"}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => removeMatchedItem(idx)}
                            >
                              <Trash2 className="w-3 h-3 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Totals */}
              {(() => {
                const totalNet = itemsWithMatches.reduce((s, item) => {
                  const match =
                    !item.de_procurat && item.selectedMatchIdx !== null
                      ? item.alternatives[item.selectedMatchIdx]
                      : null;
                  return s + (match?.pret_lista ?? 0) * item.cantitate;
                }, 0);
                const tva = totalNet * 0.19;
                return totalNet > 0 ? (
                  <div className="flex justify-end mb-5">
                    <div className="text-sm space-y-1 text-right">
                      <div className="text-muted-foreground">
                        Total net:{" "}
                        <span className="font-medium text-foreground tabular-nums">
                          {totalNet.toFixed(2)} lei
                        </span>
                      </div>
                      <div className="text-muted-foreground">
                        TVA 19%:{" "}
                        <span className="tabular-nums">{tva.toFixed(2)} lei</span>
                      </div>
                      <div className="font-semibold text-base">
                        Total:{" "}
                        <span className="tabular-nums">
                          {(totalNet + tva).toFixed(2)} lei
                        </span>
                      </div>
                      {procuratCount > 0 && (
                        <p className="text-xs text-amber-600">
                          * {procuratCount} produse "De procurat" nu sunt
                          incluse în total
                        </p>
                      )}
                    </div>
                  </div>
                ) : null;
              })()}

              <div className="flex items-center justify-between">
                <Button variant="outline" onClick={() => setStep(2)}>
                  ← Înapoi la matching
                </Button>
                <Button
                  onClick={generateQuote}
                  disabled={saving || !clientName.trim()}
                  size="lg"
                >
                  {saving && (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  )}
                  Generează ofertă draft
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
