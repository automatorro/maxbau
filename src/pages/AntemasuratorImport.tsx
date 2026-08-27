import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import * as pdfjsLib from "pdfjs-dist";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import {
  extractTableFromImageWithAnthropic,
  extractAntemasuratoareFromTextWithAnthropic,
  extractFloorPlanFromTextWithAnthropic,
} from "@/utils/anthropic";
import { findEquivalents } from "@/utils/equivalents";
import {
  detectIsFloorPlan,
  extractPdfTextItems,
  detectRoomBlocks,
  roomBlocksToPlanData,
  roomBlocksToExtractedItems,
  type FloorPlanItem,
} from "@/utils/floorPlanParser";
import {
  MATERIAL_SYSTEMS,
  expandToBOM,
  bomToExtractedItems,
  aggregateBOM,
} from "@/utils/bomEngine";
import type { PlanData, BOMItem } from "@/types/planTypes";
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
  Eye,
  Package,
  Layers,
  Building2,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface ExtractedItem {
  id: string;
  nr?: string;
  sectiune?: string;
  descriere_client: string;
  cantitate: number;
  unitate: string;
  // ── Câmpuri plan arhitectural (opționale) ────────────────────────────────
  needsManualReview?: boolean;
  reviewReason?: string;
  cameraNume?: string;
  materialTip?: "pardoseala" | "tavan" | "finisaj_perete";
  hFinisaj?: number;      // înălțimea finisajului (ex: 1.20)
  perimeterM?: number;    // perimetru cameră editabil (mp perete = perimeterM × hFinisaj)
}

interface MatchedProduct {
  product_id: string;
  cod_intern: string;
  denumire_completa: string;
  pret_lista: number;
  unit: string;
  justificare: string;
  scor: number;
  scorPenalized?: boolean;  // true dacă scorul a fost plafonat din cauza unui atribut obligatoriu lipsă
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

// Real construction BQ section headers are always ALL CAPS
// ("TERMOSISTEM FATADA - PERETI EXTERIORI", "TERMOSISTEM SOCLU - P.E.").
// Mixed-case lines like "performanță prindere termosistem, pt." are product
// name fragments, not section headers — even if they contain section keywords.
function looksLikeSectionHeader(line: string): boolean {
  return /^[A-ZĂÂÎȘȚ0-9\s.\/\-:()+*]{4,}$/.test(line);
}

function parseTextToItems(text: string): ExtractedItem[] {
  // Global flag needed to find ALL matches and pick the last one.
  // In PDFs, a table row produces: "Denumire... <consum>/mp  <cant>/pac  <necesar> pac"
  // The LAST unit in the line corresponds to the NECESAR column (rightmost = what we want).
  const unitRxG = new RegExp(
    `\\b(${KNOWN_UNITS.join("|")})\\.?\\b`,
    "ig"
  );
  const items: ExtractedItem[] = [];
  let currentSection = "";
  // Accumulates description fragments from lines that have no qty/unit yet.
  // Handles wrapped PDF table cells where the product name spans multiple rows.
  let pendingDesc = "";

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    // Clear section headers (all-caps or keyword): reset pending description
    if (looksLikeSectionHeader(line) && !/\d/.test(line)) {
      currentSection = line;
      pendingDesc = "";
      continue;
    }

    // Find the LAST unit occurrence — corresponds to the rightmost (NECESAR) column
    const allUnitMatches = [...line.matchAll(unitRxG)];
    if (!allUnitMatches.length) {
      // No qty/unit found: accumulate as pending description fragment
      const stripped = line.replace(/^\d+[.):\s]+/, "").trim();
      if (stripped.length >= 3 && !isDateDeCalcul(stripped)) {
        pendingDesc = pendingDesc ? pendingDesc + " " + stripped : stripped;
      }
      continue;
    }

    const lastUnitMatch = allUnitMatches[allUnitMatches.length - 1];
    const unitWord = lastUnitMatch[1];
    // Everything before the last unit occurrence
    const beforeUnit = line.slice(0, lastUnitMatch.index).trim();

    // Find the last standalone number before that unit — the actual needed quantity
    const numMatches = [...beforeUnit.matchAll(/(\d+(?:[.,]\d+)?)/g)];
    if (!numMatches.length) {
      const stripped = line.replace(/^\d+[.):\s]+/, "").trim();
      if (stripped.length >= 3) pendingDesc = pendingDesc ? pendingDesc + " " + stripped : stripped;
      continue;
    }

    const lastNum = numMatches[numMatches.length - 1];
    const qty = parseFloat(lastNum[0].replace(",", "."));
    if (!qty || qty <= 0) continue;

    // Everything before the last quantity number is description text.
    // Strip: row-number prefix, and intermediate columns (consum/mp, cant/pachet)
    // by keeping only the part up to the first intermediate unit occurrence.
    const beforeQty = beforeUnit.slice(0, lastNum.index!).trim();

    // Find where intermediate column data starts (first unit match in beforeQty)
    // and truncate there to get a clean product description.
    const intermediateMatch = beforeQty.match(
      new RegExp(`\\s+[\\d.,]+\\s*\\b(${KNOWN_UNITS.join("|")})\\b`, "i")
    );
    const cleanBeforeQty = intermediateMatch
      ? beforeQty.slice(0, intermediateMatch.index!).trim()
      : beforeQty;

    const descMatch = /^(\d+[.):\s]+)?(.+)$/.exec(cleanBeforeQty);
    const lineDesc = descMatch?.[2]?.trim() ?? "";

    // Combine pending fragments with this line's description
    const fullDesc = pendingDesc
      ? lineDesc ? pendingDesc + " " + lineDesc : pendingDesc
      : lineDesc;
    pendingDesc = "";

    if (fullDesc.length < 3) continue;
    if (isDateDeCalcul(fullDesc)) continue;

    items.push({
      id: randomId(),
      nr: descMatch?.[1]?.replace(/[.):\s]+$/, "").trim() || String(items.length + 1),
      sectiune: currentSection || undefined,
      descriere_client: fullDesc,
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

  const nameIdx = h.findIndex(c => /denu|produ|materi|descri|articol/.test(c));
  const qtyIdx = h.findIndex(c => /necesar|cantit|total|qty|buc\. total/.test(c));
  const unitIdx = h.findIndex(c => /\bum\b|\bu\.m\.?|unit|masur/.test(c));
  const secIdx = h.findIndex(c => /sectiu|categ|grup/.test(c));

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

  const [step, setStep] = useState<1 | 2 | 3>(() => {
    const saved = localStorage.getItem("import_step");
    return saved ? (parseInt(saved) as 1 | 2 | 3) : 1;
  });

  // Step 1
  const [textInput, setTextInput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState("");
  const [items, setItems] = useState<ExtractedItem[]>(() => {
    const saved = localStorage.getItem("import_items");
    return saved ? JSON.parse(saved) : [];
  });
  const [activeTab, setActiveTab] = useState<"file" | "text">("file");
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Tipul documentului detectat (auto sau forțat de utilizator)
  const [docType, setDocType] = useState<"auto" | "floor_plan" | "structural" | "bof">("auto");
  // null = nu s-a detectat încă, true/false = rezultatul ultimei detecții
  const [detectedAsFloorPlan, setDetectedAsFloorPlan] = useState<boolean | null>(null);

  // ── BOM (Vision AI + Bill of Materials) ──────────────────────────────────
  const [planData, setPlanData] = useState<PlanData | null>(() => {
    const saved = localStorage.getItem("import_planData");
    return saved ? JSON.parse(saved) : null;
  });
  const [bomItems, setBomItems] = useState<BOMItem[]>(() => {
    const saved = localStorage.getItem("import_bomItems");
    return saved ? JSON.parse(saved) : [];
  });
  // "upload" → "bom_review" → "items" (lista clasică)
  const [bomStage, setBomStage] = useState<"upload" | "bom_review" | "items" >(() => {
    const saved = localStorage.getItem("import_bomStage");
    return (saved as any) || "upload";
  });

  // Step 2
  const [itemsWithMatches, setItemsWithMatches] = useState<ItemWithMatch[]>(() => {
    const saved = localStorage.getItem("import_itemsWithMatches");
    return saved ? JSON.parse(saved) : [];
  });
  const [matchProgress, setMatchProgress] = useState(0);
  const [matching, setMatching] = useState(false);

  // Step 3
  const [clientName, setClientName] = useState(() => localStorage.getItem("import_clientName") || "");
  const [clientPhone, setClientPhone] = useState(() => localStorage.getItem("import_clientPhone") || "");
  const [clientEmail, setClientEmail] = useState(() => localStorage.getItem("import_clientEmail") || "");
  const [projectDesc, setProjectDesc] = useState(() => localStorage.getItem("import_projectDesc") || "");
  const [saving, setSaving] = useState(false);

  // ── LocalStorage auto-save watchers ────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem("import_step", String(step));
  }, [step]);

  useEffect(() => {
    localStorage.setItem("import_items", JSON.stringify(items));
  }, [items]);

  useEffect(() => {
    localStorage.setItem("import_planData", JSON.stringify(planData));
  }, [planData]);

  useEffect(() => {
    localStorage.setItem("import_bomItems", JSON.stringify(bomItems));
  }, [bomItems]);

  useEffect(() => {
    localStorage.setItem("import_bomStage", bomStage);
  }, [bomStage]);

  useEffect(() => {
    localStorage.setItem("import_itemsWithMatches", JSON.stringify(itemsWithMatches));
  }, [itemsWithMatches]);

  useEffect(() => {
    localStorage.setItem("import_clientName", clientName);
  }, [clientName]);

  useEffect(() => {
    localStorage.setItem("import_clientPhone", clientPhone);
  }, [clientPhone]);

  useEffect(() => {
    localStorage.setItem("import_clientEmail", clientEmail);
  }, [clientEmail]);

  useEffect(() => {
    localStorage.setItem("import_projectDesc", projectDesc);
  }, [projectDesc]);

  // Resetare memorie import
  const clearSavedProgress = useCallback(() => {
    setStep(1);
    setItems([]);
    setPlanData(null);
    setBomItems([]);
    setBomStage("upload");
    setItemsWithMatches([]);
    setClientName("");
    setClientPhone("");
    setClientEmail("");
    setProjectDesc("");
    setDetectedAsFloorPlan(null);
    setTextInput("");

    localStorage.removeItem("import_step");
    localStorage.removeItem("import_items");
    localStorage.removeItem("import_planData");
    localStorage.removeItem("import_bomItems");
    localStorage.removeItem("import_bomStage");
    localStorage.removeItem("import_itemsWithMatches");
    localStorage.removeItem("import_clientName");
    localStorage.removeItem("import_clientPhone");
    localStorage.removeItem("import_clientEmail");
    localStorage.removeItem("import_projectDesc");

    toast.success("Memoria importului curent a fost resetată.");
  }, []);

  // Ștergere spațiu din listă cu recalculare BOM
  const handleDeleteSpace = useCallback((idx: number) => {
    if (!planData) return;
    const deletedSpaceName = planData.spaces[idx]?.name;
    const newSpaces = planData.spaces.filter((_, i) => i !== idx);
    const newPlanData = { ...planData, spaces: newSpaces };
    setPlanData(newPlanData);

    const newBom = expandToBOM(newPlanData);
    setBomItems(newBom);

    toast.info(`Spațiul "${deletedSpaceName}" a fost șters.`);
  }, [planData]);

  // Ștergere element structural din listă cu recalculare BOM
  const handleDeleteStructuralElement = useCallback((idx: number) => {
    if (!planData) return;
    const deletedName = `${planData.structuralElements[idx]?.type} (${planData.structuralElements[idx]?.material ?? ""})`;
    const newElements = planData.structuralElements.filter((_, i) => i !== idx);
    const newPlanData = { ...planData, structuralElements: newElements };
    setPlanData(newPlanData);

    const newBom = expandToBOM(newPlanData);
    setBomItems(newBom);

    toast.info(`Elementul "${deletedName}" a fost șters.`);
  }, [planData]);

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

  const handleExtractText = useCallback(async () => {
    if (!textInput.trim()) {
      toast.error("Introduceți textul antemasurătorii");
      return;
    }
    setProcessing(true);
    try {
      const data = await extractAntemasuratoareFromTextWithAnthropic(textInput);
      if (!data?.headers || !data?.rows) {
        toast.error("Nu s-a putut extrage tabelul din text");
        return;
      }
      applyItems(mapOcrToItems(data.headers, data.rows), "text");
    } catch (e: any) {
      toast.error("Eroare procesare text: " + (e.message ?? "necunoscută"));
    } finally {
      setProcessing(false);
    }
  }, [textInput, applyItems]);

  const handleFileUpload = useCallback(
    async (file: File) => {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      setProcessing(true);
      // Resetăm detecția la fiecare upload nou
      setDetectedAsFloorPlan(null);

      try {
        if (ext === "xlsx" || ext === "xls") {
          // Excel → client-side XLSX parsing (nemodificat)
          const buf = await file.arrayBuffer();
          applyItems(parseExcelToItems(buf), "Excel");

        } else if (ext === "pdf") {
          const buf = await file.arrayBuffer();

          // 1. Detectăm rapid dacă e plan (heuristică text)
          const textItems = await extractPdfTextItems(buf.slice(0));
          const autoIsFloorPlan = detectIsFloorPlan(textItems);
          setDetectedAsFloorPlan(autoIsFloorPlan);

          const treatAsFloorPlan =
            docType === "floor_plan" ||
            docType === "structural" ||
            (docType === "auto" && autoIsFloorPlan);

          if (treatAsFloorPlan) {
            // ── FLUX HIBRID: PARSER LOCAL ➔ ANTHROPIC AI FALLBACK ──────
            setProgressMsg("Inițializare Parser Local...");
            const roomBlocks = detectRoomBlocks(textItems);

            let extracted: any = null;

            if (roomBlocks.length >= 2) {
              // Parserul local a funcționat cu succes (ex: planul C1)
              setProgressMsg("Procesare locală a planului...");
              extracted = roomBlocksToPlanData(roomBlocks);
            } else {
              // Plan complex/scanat -> fallback pe Anthropic AI
              setProgressMsg("Inițializare Analiză AI (Anthropic)...");
              const flatText = textItems.map((i) => i.str).join("\n");
              const aiResult = await extractFloorPlanFromTextWithAnthropic(flatText);

              const spaces = (aiResult.camere ?? []).map((cam) => {
                const nameLower = cam.camera.toLowerCase();
                const isWetRoom =
                  nameLower.includes("baie") ||
                  nameLower.includes("g.s.") ||
                  nameLower.includes("wc") ||
                  nameLower.includes("toilet") ||
                  nameLower.includes("bucatarie") ||
                  nameLower.includes("spalatorie");

                return {
                  name: cam.camera,
                  areaSqm: cam.suprafata_mp ?? 0,
                  isWetRoom,
                  pardoseala: cam.pardoseala ?? undefined,
                  tavan: cam.tavan ?? undefined,
                  pereti: cam.finisaj_perete
                    ? {
                        finisaj: cam.finisaj_perete,
                        hFinisaj: cam.h_finisaj ?? cam.inaltime_camera ?? undefined,
                      }
                    : undefined,
                  heightM: cam.inaltime_camera ?? undefined,
                  specialNotes: cam.note ? [cam.note] : [],
                };
              });

              extracted = {
                planType: "finisaje_rezidential",
                spaces,
                structuralElements: [],
              };
            }

            setPlanData(extracted);

            // Expandăm imediat cu toate sistemele (toate bifate default)
            const bom = expandToBOM(extracted);
            setBomItems(bom);
            setBomStage("bom_review");
            setProgressMsg("");

            const nSpaces = extracted.spaces.length;
            const nItems = bom.filter(b => b.selected).length;
            toast.success(
              `Plan detectat: ${nSpaces} spații, ${nItems} materiale în sistemele de finisaj.`,
              { duration: 5000 }
            );
            // Nu apelăm applyItems încă — utilizatorul revizuiește BOM-ul mai întâi
            return;

          } else {
            // ── FLUX DEVIZ TABULAR (existent, nemodificat) ───────────────
            const flatText = textItems.map((i) => i.str).join("\n");
            const data = await extractAntemasuratoareFromTextWithAnthropic(flatText);
            if (!data?.headers || !data?.rows) {
              toast.error("Nu s-a putut extrage tabelul din PDF");
              return;
            }
            applyItems(mapOcrToItems(data.headers, data.rows), "PDF");
          }

        } else {
          // Imagine → Anthropic vision (restaurat)
          const buf = await file.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = "";
          for (let i = 0; i < bytes.length; i++)
            binary += String.fromCharCode(bytes[i]);
          const base64 = btoa(binary);
          const mime = file.type || "image/jpeg";

          const data = await extractTableFromImageWithAnthropic(base64, mime, "antemasuratoare");
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
    [applyItems, docType]
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
        const data = await findEquivalents(item.descriere_client);

        if (!data?.success) {
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
          .filter((e: any) => e.scor >= 20)
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

    await runWithConcurrency(tasks, 2, (done) => {
      setMatchProgress(Math.round((done / validItems.length) * 100));
    });

    setMatching(false);
  }, [validItems]);

  const reMatchItem = useCallback(async (idx: number) => {
    const currentItem = itemsWithMatches[idx];
    if (!currentItem || !currentItem.descriere_client.trim()) return;

    setItemsWithMatches((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, matchStatus: "loading" } : it))
    );

    try {
      const desc = (currentItem as ItemWithMatch).descriere_client;

      // Motor unificat de echivalare: DB-first cu bariere dure de tip/atribute,
      // fallback AI (tot prin bariere) doar dacă DB-ul nu găsește nimic.
      let echivalente: MatchedProduct[] = [];
      const data = await findEquivalents(desc);
      if (data?.success && data.echivalente) {
        echivalente = data.echivalente.filter((e: any) => e.scor >= 20).slice(0, 5);
      }

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
          i === idx ? { ...it, matchStatus: "not_found", de_procurat: true } : it
        )
      );
    }
  }, [itemsWithMatches]);

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
          nota_ai: match
            ? { echivalent: `Echivalent propus AI (scor ${match.scor}/100): ${match.justificare}` }
            : { echivalent: "De procurat — nu există în catalog" },
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
      <div className="w-full">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl md:text-2xl font-bold">Import Antemasurătoare</h1>
          {(items.length > 0 || planData !== null) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSavedProgress}
              className="text-muted-foreground hover:text-destructive flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Resetează progres
            </Button>
          )}
        </div>
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
                <TabsList className="mb-4 h-auto flex flex-wrap w-full sm:w-auto">
                  <TabsTrigger value="file" className="text-xs sm:text-sm whitespace-normal">
                    <Upload className="w-4 h-4 mr-2 shrink-0" />
                    Fișier (PDF · Excel · Imagine)
                  </TabsTrigger>
                  <TabsTrigger value="text" className="text-xs sm:text-sm whitespace-normal">
                    <FileText className="w-4 h-4 mr-2 shrink-0" />
                    Text / Copy-paste
                  </TabsTrigger>
                </TabsList>

                {/* File upload */}
                <TabsContent value="file">
                  <div
                    className="border-2 border-dashed border-muted rounded-lg p-6 md:p-10 text-center cursor-pointer hover:border-primary transition-colors"
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
                        <p>{progressMsg || "Procesare document..."}</p>
                        {progressMsg && (
                          <p className="text-xs text-blue-600 font-medium">
                            AI-ul analizează planul arhitectural…
                          </p>
                        )}
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

                  {/* Tip document + dropdown de selecție */}
                  <div className="mt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-md border p-3 text-sm bg-slate-50 border-slate-200">
                    <div className="flex items-center gap-2 text-slate-700">
                      <Info className="w-4 h-4 shrink-0 text-blue-500" />
                      <span>
                        {detectedAsFloorPlan !== null ? (
                          detectedAsFloorPlan
                            ? "Detecție automată: Plan Arhitectural"
                            : "Detecție automată: Antemasurătoare tabelară"
                        ) : (
                          "Selectează manual tipul de plan înainte sau după încărcare"
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                      <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">Interpretează ca:</span>
                      <select
                        value={docType}
                        onChange={(e) => {
                          const val = e.target.value as "auto" | "floor_plan" | "structural" | "bof";
                          setDocType(val);
                          toast.info(`Tip interpretare setat pe: ${val === "auto" ? "Autodetecție" : val === "floor_plan" ? "Plan Finisaje" : val === "structural" ? "Plan Structură" : "Antemasurătoare"}`);
                        }}
                        className="text-xs bg-white border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary w-full sm:w-auto"
                      >
                        <option value="auto">Autodetecție automată</option>
                        <option value="floor_plan">Plan Finisaje / Pardoseli</option>
                        <option value="structural">Plan Rezistență & Structură</option>
                        <option value="bof">Antemasurătoare tabelară (deviz)</option>
                      </select>
                    </div>
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

              {/* ── BOM REVIEW (după extragere Vision AI) ───────────────────── */}
              {step === 1 && bomStage === "bom_review" && planData && (
                <div className="mt-6 space-y-4">
                  {/* Header plan */}
                  <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <Building2 className="w-6 h-6 text-blue-600 shrink-0" />
                    <div className="flex-1">
                      <p className="font-semibold text-blue-900">
                        {planData.titlu ?? "Plan arhitectural detectat"}
                      </p>
                      <p className="text-sm text-blue-700">
                        {planData.spaces.length > 0 && `${planData.spaces.length} spații identificate`}
                        {planData.spaces.length > 0 && planData.structuralElements && planData.structuralElements.length > 0 && " · "}
                        {planData.structuralElements && planData.structuralElements.length > 0 && `${planData.structuralElements.length} elemente structurale`}
                        &nbsp;&middot;&nbsp;
                        {planData.totalArieConstruita
                          ? `${planData.totalArieConstruita} mp total`
                          : planData.spaces.reduce((s, x) => s + x.areaSqm, 0).toFixed(1) + " mp total"}
                        {planData.scara && ` · Scară ${planData.scara}`}
                      </p>
                      {planData.isPartialExtraction && (
                        <p className="text-xs text-amber-600 mt-1">
                          ⚠️ Extragere parțială — unele spații pot necesita completare manuală
                        </p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-blue-700 border-blue-300">
                      {planData.planType.replace(/_/g, " ")}
                    </Badge>
                  </div>

                  {/* Spații extrase */}
                  {planData.spaces && planData.spaces.length > 0 && (
                    <div>
                      <h3 className="font-semibold mb-2 flex items-center gap-2">
                        <Eye className="w-4 h-4" /> Spații detectate
                      </h3>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Spațiu</TableHead>
                              <TableHead className="text-right">S (mp)</TableHead>
                              <TableHead className="text-right">Perimetru (m)</TableHead>
                              <TableHead>Pardoseală</TableHead>
                              <TableHead>Pereți</TableHead>
                              <TableHead>Tavan</TableHead>
                              <TableHead className="w-[50px] text-center">Șterge</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {planData.spaces.map((sp, idx) => (
                              <TableRow key={idx} className={sp.isWetRoom ? "bg-blue-50" : ""}>
                                <TableCell className="font-medium">
                                  {sp.name}
                                  {sp.isWetRoom && (
                                    <Badge variant="outline" className="ml-2 text-xs text-blue-600 border-blue-300">
                                      zonă umedă
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">{sp.areaSqm}</TableCell>
                                <TableCell className="text-right">
                                  {sp.perimeterM ? sp.perimeterM.toFixed(1) : 
                                    <span className="text-amber-500 text-xs">estimat</span>}
                                </TableCell>
                                <TableCell className="text-sm">{sp.pardoseala ?? "—"}</TableCell>
                                <TableCell className="text-sm">
                                  {sp.pereti?.finisaj
                                    ? `${sp.pereti.finisaj}${sp.pereti.hFinisaj ? ` h=${sp.pereti.hFinisaj}m` : ""}`
                                    : "—"}
                                </TableCell>
                                <TableCell className="text-sm">{sp.tavan ?? "—"}</TableCell>
                                <TableCell className="text-center">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDeleteSpace(idx)}
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                    title="Șterge acest spațiu"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {/* Elemente Structurale extrase */}
                  {planData.structuralElements && planData.structuralElements.length > 0 && (
                    <div className="mt-4">
                      <h3 className="font-semibold mb-2 flex items-center gap-2">
                        <Package className="w-4 h-4" /> Elemente structurale detectate
                      </h3>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Element</TableHead>
                              <TableHead>Material</TableHead>
                              <TableHead className="text-right">Cantitate</TableHead>
                              <TableHead>Locație</TableHead>
                              <TableHead className="w-[50px] text-center">Șterge</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {planData.structuralElements.map((el, idx) => (
                              <TableRow key={idx}>
                                <TableCell className="font-medium capitalize">{el.type}</TableCell>
                                <TableCell className="text-sm">{el.material ?? "—"}</TableCell>
                                <TableCell className="text-right font-mono font-medium">
                                  {el.cantitate} {el.unit}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">{el.locatie ?? "—"}</TableCell>
                                <TableCell className="text-center">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDeleteStructuralElement(idx)}
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                    title="Șterge acest element"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {/* Sisteme de materiale */}
                  <div>
                    <h3 className="font-semibold mb-2 flex items-center gap-2">
                      <Layers className="w-4 h-4" /> Sisteme de materiale generate
                    </h3>
                    <p className="text-sm text-muted-foreground mb-3">
                      Bifează materialele pe care dorești să le incluzi în ofertă. 
                      Cantitățile sunt calculate automat cu procente de pierderi standard.
                    </p>

                    {/* Grupat pe sistem */}
                    {(() => {
                      const bySystem = new Map<string, BOMItem[]>();
                      for (const item of bomItems) {
                        const key = `${item.spaceName}:::${item.systemName}`;
                        if (!bySystem.has(key)) bySystem.set(key, []);
                        bySystem.get(key)!.push(item);
                      }
                      return [...bySystem.entries()].map(([key, sItems]) => {
                        const [spaceName, systemName] = key.split(":::");
                        const allSelected = sItems.every(i => i.selected);
                        const someSelected = sItems.some(i => i.selected);
                        return (
                          <div key={key} className="border rounded-lg mb-3 overflow-hidden">
                            <div className="bg-muted/40 px-4 py-2 flex items-center gap-3">
                              <Checkbox
                                checked={allSelected}
                                onCheckedChange={(checked) => {
                                  setBomItems(prev => prev.map(b =>
                                    b.spaceName === spaceName && b.systemName === systemName
                                      ? { ...b, selected: Boolean(checked) }
                                      : b
                                  ));
                                }}
                              />
                              <div>
                                <span className="font-medium text-sm">{systemName}</span>
                                <span className="text-xs text-muted-foreground ml-2">— {spaceName}</span>
                              </div>
                              <Badge variant="outline" className="ml-auto text-xs">
                                {sItems.filter(i => i.selected).length}/{sItems.length} componente
                              </Badge>
                            </div>
                            <div className="divide-y">
                              {sItems.map(bItem => (
                                <div
                                  key={bItem.id}
                                  className={`flex items-center gap-3 px-4 py-2 text-sm ${
                                    !bItem.selected ? "opacity-50" : ""
                                  } ${bItem.isOptional ? "bg-slate-50/50" : ""}`}
                                >
                                  <Checkbox
                                    checked={bItem.selected}
                                    onCheckedChange={(checked) => {
                                      setBomItems(prev => prev.map(b =>
                                        b.id === bItem.id ? { ...b, selected: Boolean(checked) } : b
                                      ));
                                    }}
                                  />
                                  <span className="flex-1">{bItem.descriere}</span>
                                  {bItem.isOptional && (
                                    <Badge variant="outline" className="text-xs shrink-0">opțional</Badge>
                                  )}
                                  <span className="text-right font-mono font-semibold shrink-0 min-w-[80px]">
                                    {bItem.cantitate.toFixed(2)} {bItem.unit}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>

                  {/* Acțiuni */}
                  <div className="flex flex-wrap gap-3 pt-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setPlanData(null);
                        setBomItems([]);
                        setBomStage("upload");
                      }}
                    >
                      ↩ Încearcă alt fișier
                    </Button>
                    <Button
                      className="ml-auto"
                      onClick={() => {
                        const aggregated = aggregateBOM(bomItems);
                        const extracted = bomToExtractedItems(aggregated);
                        if (!extracted.length) {
                          toast.error("Selectează cel puțin un material");
                          return;
                        }
                        applyItems(
                          extracted.map(e => ({ ...e, unitate: e.unitate })) as any,
                          "Plan arhitectural (BOM)"
                        );
                        setBomStage("items");
                      }}
                    >
                      <Package className="w-4 h-4 mr-2" />
                      Confirmă {bomItems.filter(b => b.selected).length} materiale → Căută echivalente
                    </Button>
                  </div>
                </div>
              )}

              {/* Extracted items table */}
              {items.length > 0 && (
                <div className="mt-6">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-muted-foreground">
                      {items.length} produse extrase
                      {items.filter((i) => i.needsManualReview).length > 0 && (
                        <span className="ml-2 text-amber-600 font-semibold">
                          · ⚠️ {items.filter((i) => i.needsManualReview).length} necesită verificare
                        </span>
                      )}
                    </p>
                    <Button variant="outline" size="sm" onClick={addEmptyItem}>
                      <Plus className="w-3 h-3 mr-1" />
                      Adaugă rând
                    </Button>
                  </div>

                  <div className="rounded border overflow-x-auto overflow-y-auto max-h-[480px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">#</TableHead>
                          <TableHead className="w-36">Secțiune / Cameră</TableHead>
                          <TableHead>Denumire produs (din cerere)</TableHead>
                          <TableHead className="w-28">Cantitate</TableHead>
                          <TableHead className="w-32">Perimetru (m)</TableHead>
                          <TableHead className="w-24">UM</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((item, i) => (
                          <TableRow
                            key={item.id}
                            className={item.needsManualReview
                              ? "bg-amber-50 hover:bg-amber-100"
                              : undefined
                            }
                          >
                            <TableCell className="text-xs text-muted-foreground">
                              {item.nr || i + 1}
                            </TableCell>
                            <TableCell>
                              <Input
                                value={item.sectiune ?? ""}
                                onChange={(e) =>
                                  updateItem(item.id, "sectiune", e.target.value)
                                }
                                className="h-7 text-xs"
                                placeholder="Secțiune"
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                <Input
                                  value={item.descriere_client}
                                  onChange={(e) =>
                                    updateItem(item.id, "descriere_client", e.target.value)
                                  }
                                  className={`h-7 text-xs ${
                                    item.needsManualReview
                                      ? "border-amber-400 focus:ring-amber-400"
                                      : ""
                                  }`}
                                />
                                {item.needsManualReview && (
                                  <span
                                    className="flex items-center gap-1 text-xs text-amber-700"
                                    title={item.reviewReason}
                                  >
                                    <AlertTriangle className="w-3 h-3 shrink-0" />
                                    {item.reviewReason?.slice(0, 60) ??
                                      "Verificare manuală necesară"}
                                  </span>
                                )}
                              </div>
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
                                className={`h-7 text-xs ${
                                  item.needsManualReview && item.cantitate === 0
                                    ? "border-amber-400"
                                    : ""
                                }`}
                                placeholder={item.needsManualReview && item.cantitate === 0 ? "?" : ""}
                              />
                            </TableCell>
                            {/* Câmp perimetru — vizibil doar pentru finisaje perete */}
                            <TableCell>
                              {item.materialTip === "finisaj_perete" ? (
                                <div className="flex flex-col gap-1">
                                  <Input
                                    type="number"
                                    placeholder="m"
                                    value={item.perimeterM ?? ""}
                                    onChange={(e) => {
                                      const p = parseFloat(e.target.value) || 0;
                                      const h = item.hFinisaj ?? 1.2;
                                      // Actualizăm perimetrul și recalculăm cantitatea
                                      setItems((prev) =>
                                        prev.map((it) =>
                                          it.id === item.id
                                            ? {
                                                ...it,
                                                perimeterM: p,
                                                cantitate: p > 0 ? Math.round(p * h * 100) / 100 : 0,
                                                needsManualReview: p === 0,
                                              }
                                            : it
                                        )
                                      );
                                    }}
                                    className="h-7 text-xs w-20"
                                  />
                                  {item.hFinisaj && (
                                    <span className="text-xs text-muted-foreground">
                                      × {item.hFinisaj}m
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Input
                                value={item.unitate}
                                onChange={(e) =>
                                  updateItem(item.id, "unitate", e.target.value)
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

                  <div className="mt-4 flex justify-stretch sm:justify-end">
                    <Button
                      onClick={startMatching}
                      size="lg"
                      disabled={validItems.length === 0}
                      className="w-full sm:w-auto"
                    >
                      <Sparkles className="w-4 h-4 mr-2 shrink-0" />
                      Caută echivalente AI ({validItems.length} produse)
                      <ChevronRight className="w-4 h-4 ml-2 shrink-0" />
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
                2. Echivalente din catalogul de produse
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

              <div className="flex justify-end mb-3">
                <Button variant="outline" size="sm" onClick={addEmptyMatchedItem}>
                  <Plus className="w-3 h-3 mr-1" />
                  Adaugă rând
                </Button>
              </div>

              <div className="space-y-2">
                {itemsWithMatches.map((item, idx) => {
                  const selectedProduct =
                    item.selectedMatchIdx !== null
                      ? item.alternatives[item.selectedMatchIdx]
                      : null;

                  return (
                    <div
                      key={item.id}
                      className={`rounded-lg border p-3 ${
                        item.de_procurat ? "bg-amber-50/60 border-amber-200" : "bg-white"
                      }`}
                    >
                      {/* Row 1: status + delete */}
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          {item.matchStatus === "pending" && (
                            <Badge variant="outline" className="text-xs">
                              Așteptare
                            </Badge>
                          )}
                          {item.matchStatus === "loading" && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Caută echivalent...
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
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={() => removeMatchedItem(idx)}
                        >
                          <Trash2 className="w-3 h-3 text-destructive" />
                        </Button>
                      </div>

                      {/* Row 2: cerere client editable + Re-caută button */}
                      <div className="flex items-center gap-2 mb-2">
                        <Input
                          value={item.descriere_client}
                          onChange={(e) =>
                            updateMatchedItem(idx, "descriere_client", e.target.value)
                          }
                          className="h-8 text-sm flex-1"
                          placeholder="Denumire produs cerut de client"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0"
                          onClick={() => reMatchItem(idx)}
                          disabled={item.matchStatus === "loading"}
                        >
                          <Sparkles className="w-3 h-3 mr-1 text-amber-500" />
                          Re-caută
                        </Button>
                      </div>

                      {/* Row 3: sectiune + cant + UM */}
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        {item.sectiune && (
                          <span className="text-xs text-muted-foreground">
                            {item.sectiune}
                          </span>
                        )}
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">Cant:</span>
                          <Input
                            type="number"
                            value={item.cantitate || ""}
                            onChange={(e) =>
                              updateMatchedItem(idx, "cantitate", parseFloat(e.target.value) || 0)
                            }
                            className="h-7 text-xs w-20"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">UM:</span>
                          <Input
                            value={item.unitate}
                            onChange={(e) =>
                              updateMatchedItem(idx, "unitate", e.target.value)
                            }
                            className="h-7 text-xs w-16"
                          />
                        </div>
                        <div className="flex items-center gap-2 ml-auto">
                          <Checkbox
                            id={`procurat-${item.id}`}
                            checked={item.de_procurat}
                            onCheckedChange={(checked) =>
                              setItemsWithMatches((prev) =>
                                prev.map((it, i) =>
                                  i === idx ? { ...it, de_procurat: !!checked } : it
                                )
                              )
                            }
                          />
                          <label
                            htmlFor={`procurat-${item.id}`}
                            className="text-xs text-muted-foreground cursor-pointer"
                          >
                            Procurare specială
                          </label>
                        </div>
                      </div>

                      {/* Row 4: produs propus dropdown */}
                      {!item.de_procurat && item.alternatives.length > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">
                            Produs propus din catalog:
                          </p>
                          <Select
                            value={String(item.selectedMatchIdx ?? 0)}
                            onValueChange={(val) =>
                              setItemsWithMatches((prev) =>
                                prev.map((it, i) =>
                                  i === idx
                                    ? { ...it, selectedMatchIdx: parseInt(val) }
                                    : it
                                )
                              )
                            }
                          >
                            <SelectTrigger className="h-8 text-xs w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {item.alternatives.map((alt, ai) => (
                                <SelectItem key={alt.cod_intern} value={String(ai)}>
                                  <span className="font-mono text-xs text-muted-foreground mr-2">
                                    {alt.cod_intern}
                                  </span>
                                  {alt.denumire_completa.length > 55
                                    ? alt.denumire_completa.slice(0, 55) + "…"
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
                      )}
                      {item.de_procurat && (
                        <p className="text-xs text-muted-foreground italic">
                          Nicio potrivire în catalog — va fi inclus ca articol de procurat
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {!matching && itemsWithMatches.length > 0 && (
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    <span className="text-green-700 font-medium">
                      <CheckCircle2 className="w-4 h-4 inline mr-1" />
                      {foundCount} găsite în catalog
                    </span>
                    <span className="text-amber-700 font-medium">
                      <AlertTriangle className="w-4 h-4 inline mr-1" />
                      {procuratCount} de procurat
                    </span>
                  </div>
                  <Button onClick={() => setStep(3)} size="lg" className="w-full sm:w-auto">
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

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <Button variant="outline" onClick={() => setStep(2)} className="w-full sm:w-auto">
                  ← Înapoi la matching
                </Button>
                <Button
                  onClick={generateQuote}
                  disabled={saving || !clientName.trim()}
                  size="lg"
                  className="w-full sm:w-auto"
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
