/**
 * floorPlanParser.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Parser dedicat pentru planuri de arhitectură PDF (planșe de etaj/parter).
 *
 * Diferența față de parsarea devizelor tabulare:
 *  - Un plan are CAMERE (room blocks), nu rânduri de tabel
 *  - Fiecare cameră are un "pachet" de atribute: pardoseală, tavan, finisaj perete
 *  - Textul este dispus spațial (x,y), nu secvențial
 *  - Fonturile CAD produc adesea glyph-uri corupte (m² → "Pð", "antiderapantă" → corupt)
 *
 * Flux:
 *   extractPdfTextItems()         — extrage text + coordonate + unghi din PDF
 *       ↓
 *   detectIsFloorPlan()           — heuristică: ≥2 "S=\d" + ≥1 keyword material
 *       ↓
 *   detectRoomBlocks()            — identifică camere prin validare S=\d + 2D Voronoi
 *       ↓
 *   roomBlocksToExtractedItems()  — expandează în linii de ofertă (pardoseală + tavan + finisaj)
 * ──────────────────────────────────────────────────────────────────────────────
 */

import * as pdfjsLib from "pdfjs-dist";
import type { PlanData } from "../types/planTypes";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  angleDeg: number;
  font: string;
}

export type RoomAttributeType =
  | "suprafata"
  | "pardoseala"
  | "tavan"
  | "finisaj_perete"
  | "inaltime"
  | "other";

export interface RoomAttribute {
  type: RoomAttributeType;
  rawText: string;
  normalizedText: string;
  value?: number;
  unit?: string;
  hFinisaj?: number;        // înălțimea finisajului de perete (ex: 1.20)
  needsManualReview: boolean;
  reviewReason?: string;
  isRotated?: boolean;
}

export interface RoomBlock {
  name: string;             // "G.S. FETE"
  number?: string;          // "1", "2" etc. (din "(1)")
  centerX: number;
  centerY: number;
  suprafata?: number;       // valoarea S= parsată cu succes
  suprafataRaw?: string;    // string brut
  attributes: RoomAttribute[];
}

/** Extensie a ExtractedItem pentru planuri arhitecturale */
export interface FloorPlanItem {
  id: string;
  nr?: string;
  sectiune?: string;
  descriere_client: string;
  cantitate: number;
  unitate: string;
  // ── Câmpuri noi ──────────────────────────────
  needsManualReview?: boolean;
  reviewReason?: string;
  cameraNume?: string;
  materialTip?: "pardoseala" | "tavan" | "finisaj_perete";
  hFinisaj?: number;        // pentru calcul suprafață perete
  perimeterM?: number;      // editabil de utilizator; cantitate = perimeterM × hFinisaj
}

// ── Glyph corrections ─────────────────────────────────────────────────────────
// Corecții cunoscute pentru fonturile CAD care produc caractere corupte.
// Cheile sunt string-urile corupte; valorile sunt textul corect.

export const GLYPH_CORRECTIONS: Record<string, string> = {
  // m² — diverse variante de corupție
  "Pð":    "m²",
  "P²":    "m²",
  "mð":    "m²",
  "m\u00b2": "m²",
  // antiderapantă — Windows-1252 citit ca Latin-1 → rot13-like
  "DQWLGHUDSDQWă": "antiderapantă",
  "DQWLGHUDSDQW":  "antiderapant",
  "DQWLGHUDSDQWa": "antiderapanta",
};

export function applyGlyphCorrections(text: string): string {
  let result = text;
  for (const [corrupt, correct] of Object.entries(GLYPH_CORRECTIONS)) {
    if (result.includes(corrupt)) {
      result = result.split(corrupt).join(correct);
    }
  }
  return result;
}

// ── Material synonyms ─────────────────────────────────────────────────────────
// Canonicalizare: variante scrise → denumire standard de ofertare

const MATERIAL_SYNONYMS: Record<string, string> = {
  "gresie antiderapanta de interior":   "gresie antiderapantă de interior",
  "gresie antiderapantă de interior":   "gresie antiderapantă de interior",
  "gresie antiderapanta":               "gresie antiderapantă de interior",
  "gresie antiderapantă":               "gresie antiderapantă de interior",
  "gresie antiderapanta de exterior":   "gresie antiderapantă de exterior",
  "gresie antiderapantă de exterior":   "gresie antiderapantă de exterior",
  "gresie de interior":                 "gresie de interior",
  "parchet laminat":                    "parchet laminat rezistent la trafic intens",
  "parchet":                            "parchet laminat rezistent la trafic intens",
  "tavan fals":                         "tavan fals",
  "beton":                              "beton",
  "faianta":                            "faianță",
  "vopsea":                             "vopsea pe bază de ulei",
  "vopsea lavabila":                    "vopsea pe bază de ulei",
  "vopsea pe baza de ulei":            "vopsea pe bază de ulei",
  "vopsea pe baza":                     "vopsea pe bază de ulei",
};

function normalizeMaterial(text: string): string {
  const lower = text.toLowerCase().trim();
  return MATERIAL_SYNONYMS[lower] ?? text;
}

// ── Known material keywords (pentru fallback corupții necunoscute) ─────────────

const MATERIAL_KEYWORDS = [
  "gresie", "parchet", "beton", "tavan fals", "tavan",
  "faianță", "faianta", "vopsea", "finisaj", "pardoseala", "pardoseală",
  "laminat", "antiderapant", "interior", "exterior",
];

/**
 * Returnează true dacă textul conține un token care arată corupt
 * (caractere non-ASCII neobișnuite + parte recognoscibilă din material)
 */
function looksCorrupted(text: string): boolean {
  const hasWeirdNonAscii = /[^\x00-\x7FăâîșțĂÂÎȘȚ]/.test(text);
  const hasUpperLowerMix = /[A-Z]{3,}[a-z]/.test(text) && !/^[A-ZĂÂÎȘȚ\s.()-]+$/.test(text);
  return hasWeirdNonAscii || hasUpperLowerMix;
}

function textNearMaterialKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return MATERIAL_KEYWORDS.some((kw) => lower.includes(kw));
}

// ── Text quality check (§13 spec) ─────────────────────────────────────────────

/**
 * Verifică CALITATEA textului extras din PDF. Necesar pe lângă verificarea
 * de cantitate (`items.length < 5`) — există PDF-uri CAD care exportă text
 * prin fonturi Type3/SHX cu encoding netradițional: vizual arată corect, dar
 * `getTextContent` returnează glife cu coduri de caractere gunoi.
 *
 * Metodă: procentul de caractere „recognoscibile" (cifre, litere ASCII,
 * litere RO, spații, punctuație uzuală) din tot textul extras. Sub prag =
 * text corupt → tratează ca „fără text layer" → rutează spre Vision.
 *
 * Prag recomandat: 0.70 (70%). Un text CAD real are >95% recognoscibile; un
 * text corupt încarce simboluri Unicode private / astea neasignate în masă.
 */
export function textQualityRatio(items: PdfTextItem[]): number {
  const allText = items.map((i) => i.str).join("");
  if (allText.length === 0) return 0;
  // Recognoscibile: cifre, litere latine (inclusiv RO), spații, punctuație uzuală,
  // simboluri tehnice comune pe planuri (Ø, ×, ², °, /, -, +, =).
  const okChars = allText.match(/[0-9a-zA-ZăâîșțĂÂÎȘȚ\s.,;:()\[\]{}\-+=*\/×²°Ø<>@#!?'"%$&|_\\]/g);
  return okChars ? okChars.length / allText.length : 0;
}

/** True dacă PDF-ul are text extractibil ȘI text-ul e recognoscibil.
 *  Combinație de cantitate (>=5 items) + calitate (>=70% chars ok). */
export function hasUsableTextLayer(items: PdfTextItem[]): boolean {
  if (items.length < 5) return false;
  return textQualityRatio(items) >= 0.70;
}

// ── Table layout (§13 spec) ───────────────────────────────────────────────────

/**
 * Grupează text items pe rânduri (după y ±3pt) și ordonează pe x. Returnează
 * string cu rândurile separate prin `\n` și celulele prin ` | `. Folosit ca
 * input pentru extractoarele text — modelul are șansă mai mare să reconstruiască
 * un tabel dintr-un layout preservat decât dintr-un dump concatenat orbește.
 */
export function layoutTextItemsAsTable(items: PdfTextItem[]): string {
  const Y_TOL = 3;
  const rows = new Map<number, PdfTextItem[]>();
  for (const item of items) {
    let key: number | null = null;
    for (const k of rows.keys()) {
      if (Math.abs(k - item.y) <= Y_TOL) { key = k; break; }
    }
    if (key === null) { rows.set(item.y, [item]); }
    else { rows.get(key)!.push(item); }
  }
  return [...rows.entries()]
    .sort(([ya], [yb]) => yb - ya) // top-down: Y mare = sus
    .map(([, cells]) =>
      cells
        .sort((a, b) => a.x - b.x)
        .map((c) => c.str.trim())
        .filter((s) => s.length > 0)
        .join(" | ")
    )
    .filter((line) => line.length > 0)
    .join("\n");
}

// ── Floor plan heuristic ──────────────────────────────────────────────────────

/**
 * Detectează dacă un set de text items provine dintr-un plan de arhitectură
 * (vs deviz tabular obișnuit).
 * Criteriu: ≥2 pattern-uri "S=\d" ȘI ≥1 keyword de material de finisaj.
 */
export function detectIsFloorPlan(items: PdfTextItem[]): boolean {
  const allText = items.map((i) => i.str).join(" ").toLowerCase();

  const sPattCount = (allText.match(/s\s*=\s*\d/gi) ?? []).length;

  const kwHit = [
    "tavan fals", "faianță", "faianta", "gresie", "parchet",
    "pardoseala", "vopsea lavabila", "antiderapant",
  ].filter((kw) => allText.includes(kw)).length;

  return sPattCount >= 2 && kwHit >= 1;
}

// ── PDF text extraction ───────────────────────────────────────────────────────

/**
 * Extrage toate textele cu coordonate și unghi de rotație din PDF.
 * Aplică GLYPH_CORRECTIONS înainte de a returna.
 * Necesită ca pdfjs GlobalWorkerOptions.workerSrc să fie deja configurat de caller.
 */
export async function extractPdfTextItems(buf: ArrayBuffer): Promise<PdfTextItem[]> {
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const allItems: PdfTextItem[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    for (const item of content.items as any[]) {
      if (!item.str?.trim()) continue;

      const t = item.transform as number[]; // [a, b, c, d, e, f]
      const angleDeg = Math.round(
        (Math.atan2(t[1], t[0]) * 180) / Math.PI
      );

      const correctedStr = applyGlyphCorrections(item.str);

      allItems.push({
        str: correctedStr,
        x: Math.round(t[4]),
        y: Math.round(t[5]),
        w: Math.round(item.width ?? 0),
        h: Math.round(item.height ?? 0),
        angleDeg,
        font: item.fontName ?? "unknown",
      });
    }
  }

  return allItems;
}

// ── Room label detection ──────────────────────────────────────────────────────

// Texte ALL_CAPS care nu sunt nume de cameră
const NOT_ROOM_LABEL_FRAGMENTS = [
  "LIMITA", "PROPRIETATE", "ACCES PRINCIPAL", "ACCES SECUNDAR",
  "OBSERVATIE", "OBSERVAȚIE", "LEGENDA", "LEGENDĂ", "NOTA", "NOTĂ",
  "SCARA", "SCARĂ", "NIVEL", "ETAJ", "SUBSOL",
  "PLAN ", "SECTIUNE", "SECȚIUNE", "DETALIU", "PROIECT",
  "NORD", "SUD", "EST", "VEST",
  "EMISIE", "INCENDIU", "EVACUARE", "SIGURANTA",
  "SIMBOL", "TIP", "FORMAT", "DATA", "REVIZIE",
];

const ROOM_LABEL_RE = /^[A-ZĂÂÎȘȚ\s.()\d-]{4,}$/;

function looksLikeRoomLabel(text: string): boolean {
  const t = text.trim();
  if (t.length < 4) return false;
  if (!ROOM_LABEL_RE.test(t)) return false;
  // Exclude etichetele de plan / observații
  const upper = t.toUpperCase();
  if (NOT_ROOM_LABEL_FRAGMENTS.some((excl) => upper.includes(excl))) return false;
  return true;
}

function dist2D(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

// ── Room block detection ──────────────────────────────────────────────────────

/**
 * Identifică blocurile de cameră din textele planului:
 * 1. Candidați pentru etichete: ALL_CAPS ≥ 4 chars (excludem non-camere)
 * 2. Validare: eticheta e validă NUMAI dacă S=\d apare în raza VALIDATION_RADIUS
 * 3. Atribuire 2D Voronoi: fiecare item non-etichetă → camera cea mai apropiată
 * 4. Extragere atribute per cameră
 */
export function detectRoomBlocks(items: PdfTextItem[]): RoomBlock[] {
  const VALIDATION_RADIUS = 500; // pt — suficient pentru camere mari (Hol 2 = 58mp)

  // 1. Găsim candidații pentru etichete de cameră (text orizontal ≈ 0°)
  const candidates = items.filter(
    (item) =>
      looksLikeRoomLabel(item.str) && Math.abs(item.angleDeg) <= 5
  );

  if (!candidates.length) return [];

  // 2. Validăm: eticheta e cameră NUMAI dacă S=\d apare în vecinătate
  const validatedLabels = candidates.filter((label) =>
    items.some(
      (item) =>
        dist2D(label.x, label.y, item.x, item.y) <= VALIDATION_RADIUS &&
        /S\s*=\s*\d/i.test(item.str)
    )
  );

  if (!validatedLabels.length) return [];

  // 3. 2D Voronoi: atribuim fiecare item non-etichetă la camera cea mai apropiată
  const labelSets = new Map<PdfTextItem, PdfTextItem[]>();
  for (const label of validatedLabels) labelSets.set(label, []);

  for (const item of items) {
    if (validatedLabels.includes(item)) continue;

    let nearestLabel = validatedLabels[0];
    let minDist = Infinity;
    for (const label of validatedLabels) {
      const d = dist2D(item.x, item.y, label.x, label.y);
      if (d < minDist) {
        minDist = d;
        nearestLabel = label;
      }
    }
    labelSets.get(nearestLabel)!.push(item);
  }

  // 4. Construim blocurile
  const blocks: RoomBlock[] = [];
  for (const [label, assignedItems] of labelSets) {
    blocks.push(parseRoomBlock(label, assignedItems));
  }

  return blocks;
}

// ── Room block attribute extraction ──────────────────────────────────────────

/** Extrage atributele unui bloc de cameră din lista de items atribuite lui */
export function parseRoomBlock(
  label: PdfTextItem,
  items: PdfTextItem[]
): RoomBlock {
  const block: RoomBlock = {
    name: label.str.trim(),
    centerX: label.x,
    centerY: label.y,
    attributes: [],
  };

  // Numărul camerei: "G.S. FETE (1)" → "1"
  const numMatch = block.name.match(/\((\d+)\)/);
  if (numMatch) block.number = numMatch[1];

  // Textul total al blocului (toate items atribuite)
  const allText = items.map((i) => i.str).join(" ");

  // ── Suprafața S= ─────────────────────────────────────────────────────
  const sMatch = allText.match(/S\s*=\s*([\d.,]+)/i);
  if (sMatch) {
    const numStr = sMatch[1].replace(",", ".");
    if (numStr.endsWith(".")) {
      // Număr trunchiat — posibil glyph corupt m²
      block.attributes.push({
        type: "suprafata",
        rawText: `S=${sMatch[1]}`,
        normalizedText: `S=${numStr}`,
        value: parseFloat(numStr),
        unit: "mp",
        needsManualReview: true,
        reviewReason:
          "Cantitate trunchiată (se termină în punct) — posibil glyph corupt m². Verificați valoarea reală.",
      });
    } else {
      block.suprafata = parseFloat(numStr);
      block.suprafataRaw = sMatch[1];
    }
  } else {
    // S= prezent dar fără cifre după
    if (/S\s*=/i.test(allText)) {
      block.attributes.push({
        type: "suprafata",
        rawText: "S=",
        normalizedText: "S=",
        needsManualReview: true,
        reviewReason: "S= detectat fără valoare numerică",
      });
    }
  }

  // ── Înălțimea camerei H= ─────────────────────────────────────────────
  const hBigMatch = allText.match(/H\s*=\s*([\d.,]+)/);
  if (hBigMatch) {
    block.attributes.push({
      type: "inaltime",
      rawText: `H=${hBigMatch[1]}`,
      normalizedText: `H=${hBigMatch[1].replace(",", ".")}`,
      value: parseFloat(hBigMatch[1].replace(",", ".")),
      unit: "m",
      needsManualReview: false,
    });
  }

  // ── Pardoseală ───────────────────────────────────────────────────────
  const floorAttr = extractFloorMaterial(allText);
  if (floorAttr) block.attributes.push(floorAttr);

  // ── Tavan ────────────────────────────────────────────────────────────
  if (/tavan\s*fals/i.test(allText)) {
    block.attributes.push({
      type: "tavan",
      rawText: "tavan fals",
      normalizedText: "tavan fals",
      needsManualReview: false,
    });
  }

  // ── Finisaj perete ───────────────────────────────────────────────────
  const wallAttr = extractWallFinish(allText);
  if (wallAttr) block.attributes.push(wallAttr);

  // ── Text rotit — posibil suprafață rampă ─────────────────────────────
  const rotatedWithData = items.filter(
    (i) =>
      Math.abs(i.angleDeg) > 5 &&
      Math.abs(i.angleDeg) < 175 &&
      (/S\s*=/i.test(i.str) || /\d+[.,]\d+/.test(i.str))
  );
  for (const ri of rotatedWithData) {
    block.attributes.push({
      type: "suprafata",
      rawText: ri.str,
      normalizedText: ri.str,
      needsManualReview: true,
      reviewReason: `Text rotit la ${ri.angleDeg}° — cantitate posibil nedetectată (rampă / cotă)`,
      isRotated: true,
    });
  }

  return block;
}

// ── Floor material extraction ─────────────────────────────────────────────────

export function extractFloorMaterial(text: string): RoomAttribute | null {
  const lower = text.toLowerCase();
  const isExterior = lower.includes("exterior");

  // Gresie antiderapantă — cel mai frecvent
  if (lower.includes("gresie")) {
    const grIdx = lower.indexOf("gresie");
    const vicinity = text.slice(grIdx, grIdx + 80);
    const vicLower = vicinity.toLowerCase();

    if (vicLower.includes("antiderapant")) {
      const materialStr = isExterior
        ? "gresie antiderapantă de exterior"
        : "gresie antiderapantă de interior";
      return {
        type: "pardoseala",
        rawText: vicinity.trim().split(/\n/)[0].trim(),
        normalizedText: normalizeMaterial(materialStr),
        needsManualReview: false,
      };
    }

    // Verificăm corupție în vecinătatea cuvântului "gresie"
    if (looksCorrupted(vicinity) || textNearMaterialKeyword(vicinity)) {
      // Prezumăm că "antiderapantă" e coruptă
      return {
        type: "pardoseala",
        rawText: vicinity.trim().split(/\n/)[0].trim(),
        normalizedText: isExterior
          ? "gresie antiderapantă de exterior"
          : "gresie antiderapantă de interior",
        needsManualReview: true,
        reviewReason:
          "Atribut 'antiderapantă' posibil corupt sau lipsă — verificați dacă este gresie antiderapantă",
      };
    }

    // Gresie simplă (fără antiderapant detectat)
    return {
      type: "pardoseala",
      rawText: "gresie de interior",
      normalizedText: "gresie de interior",
      needsManualReview: false,
    };
  }

  // Parchet laminat
  if (lower.includes("parchet")) {
    return {
      type: "pardoseala",
      rawText: text
        .split(/\n/)
        .find((l) => l.toLowerCase().includes("parchet"))
        ?.trim() ?? "parchet laminat",
      normalizedText: normalizeMaterial("parchet laminat"),
      needsManualReview: false,
    };
  }

  // Beton
  if (lower.includes("beton")) {
    return {
      type: "pardoseala",
      rawText: "beton",
      normalizedText: "beton",
      needsManualReview: false,
    };
  }

  return null;
}

// ── Wall finish extraction ────────────────────────────────────────────────────

export function extractWallFinish(text: string): RoomAttribute | null {
  const lower = text.toLowerCase();

  // Înălțimea finisajului: h=1,20 sau h=1.20
  const hMatch = text.match(/\bh\s*=\s*([\d.,]+)\s*m?\b/i);
  const hFinisaj = hMatch
    ? parseFloat(hMatch[1].replace(",", "."))
    : undefined;

  let normalizedText: string | null = null;

  if (lower.includes("faianță") || lower.includes("faianta") || lower.includes("faia")) {
    normalizedText = "faianță";
  } else if (lower.includes("vopsea")) {
    normalizedText = "vopsea pe bază de ulei";
  }

  if (!normalizedText) return null;

  const hSuffix = hFinisaj ? ` h=${hFinisaj}m` : "";

  return {
    type: "finisaj_perete",
    rawText: normalizedText + hSuffix,
    normalizedText: normalizeMaterial(normalizedText),
    hFinisaj,
    needsManualReview: false,
  };
}

// ── Apply mandatory attribute penalty ────────────────────────────────────────

/**
 * Atribute tehnice obligatorii: dacă cererea le conține (sau ar trebui să le conțină)
 * dar produsul candidat NU le menționează, scorul e plafonat la maxScore.
 */
const MANDATORY_ATTRIBUTE_RULES: Array<{
  keywords: string[];        // dacă cererea conține oricare din acestea
  productMustContain: string[]; // produsul trebuie să conțină cel puțin unul
  maxScore: number;          // scor maxim dacă nu se potrivește
  label: string;             // pentru mesaj
}> = [
  {
    keywords: ["antiderapant", "anti-alunecare", "antialunec"],
    productMustContain: ["antiderapant", "anti-alunecare", "r10", "r11", "r12", "r9", "r13"],
    maxScore: 60,
    label: "antiderapant",
  },
  {
    keywords: ["trafic intens", "rezistent la trafic", "hdf", "ac4", "ac5"],
    productMustContain: ["trafic intens", "hdf", "ac4", "ac5", "ac 4", "ac 5"],
    maxScore: 65,
    label: "rezistent la trafic intens",
  },
  {
    keywords: ["exterior", "de exterior", "frost", "îngheț"],
    productMustContain: ["exterior", "frost", "inghet", "îngheț", "E1", "E2"],
    maxScore: 55,
    label: "utilizare exterior",
  },
];

export function applyMandatoryAttributePenalty(
  cerere: string,
  denumireProdusCandidат: string,
  scorInitial: number
): { score: number; penalized: boolean; reason?: string } {
  const cerLower = cerere.toLowerCase();
  const prodLower = denumireProdusCandidат.toLowerCase();

  for (const rule of MANDATORY_ATTRIBUTE_RULES) {
    const cerereHasAttr = rule.keywords.some((kw) => cerLower.includes(kw));
    if (!cerereHasAttr) continue;

    const productHasAttr = rule.productMustContain.some((kw) => prodLower.includes(kw));
    if (!productHasAttr && scorInitial > rule.maxScore) {
      return {
        score: rule.maxScore,
        penalized: true,
        reason: `Scor plafonat la ${rule.maxScore}: produsul nu menționează explicit "${rule.label}" (atribut obligatoriu din cerere)`,
      };
    }
  }

  return { score: scorInitial, penalized: false };
}

// ── OCR fallback pentru zone suspecte ────────────────────────────────────────

/**
 * Rasterizează o zonă din PDF și rulează Tesseract OCR pe ea.
 * Folosit NUMAI pentru:
 *  - Zone unde S= e urmat de non-cifră (truncat / glyph corupt)
 *  - Text rotit asociat unui bloc de cameră validat
 *
 * @param page       pdfjs PDFPageProxy
 * @param bbox       Bounding box în coordonate pdfjs (pt)
 * @param scaleFactor Rezoluție pentru rasterizare (default 3x pentru claritate)
 */
export async function ocrSuspiciousZone(
  page: any,
  bbox: { x: number; y: number; w: number; h: number },
  scaleFactor = 3
): Promise<string | null> {
  try {
    const { createWorker } = await import("tesseract.js");
    const viewport = page.getViewport({ scale: scaleFactor });

    // Rasterizăm pagina pe un OffscreenCanvas (browser API)
    const canvas = new OffscreenCanvas(
      Math.round(viewport.width),
      Math.round(viewport.height)
    );
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;

    // Crop la bbox-ul zonei suspecte (convertit la pixels)
    const px = bbox.x * scaleFactor;
    const py =
      (page.getViewport({ scale: 1 }).height - bbox.y - bbox.h) * scaleFactor;
    const pw = bbox.w * scaleFactor;
    const ph = bbox.h * scaleFactor;

    const croppedCanvas = new OffscreenCanvas(
      Math.max(1, Math.round(pw)),
      Math.max(1, Math.round(ph))
    );
    const croppedCtx = croppedCanvas.getContext("2d")!;
    croppedCtx.drawImage(canvas, px, py, pw, ph, 0, 0, pw, ph);

    // Convertim OffscreenCanvas la Blob
    const blob = await croppedCanvas.convertToBlob({ type: "image/png" });

    // Tesseract OCR — romanian language
    const worker = await createWorker("ron");
    const { data } = await worker.recognize(blob);
    await worker.terminate();

    return data.text.trim() || null;
  } catch (e) {
    console.warn("[floorPlanParser] ocrSuspiciousZone failed:", e);
    return null;
  }
}

// ── Main converter: RoomBlock[] → FloorPlanItem[] ────────────────────────────

let _idCounter = 0;
function randomId(): string {
  return `fp_${Date.now()}_${_idCounter++}`;
}

/**
 * Expandează fiecare RoomBlock în linii de ofertă distincte:
 *  - 1 linie pentru pardoseală (suprafața camerei)
 *  - 1 linie pentru tavan (suprafața camerei)
 *  - 1 linie pentru finisaj perete (cantitate 0, câmp perimetru editabil)
 *  - Linii suplimentare pentru cantități suspecte (review manual)
 */
export function roomBlocksToExtractedItems(
  blocks: RoomBlock[]
): FloorPlanItem[] {
  const items: FloorPlanItem[] = [];
  let nr = 1;

  for (const block of blocks) {
    const camName =
      block.name + (block.number ? ` (${block.number})` : "");

    const suprafata = block.suprafata ?? 0;
    const suprafataSuspect = block.attributes.find(
      (a) => a.type === "suprafata" && a.needsManualReview
    );

    // ── Pardoseală ──────────────────────────────────────────────────────
    const floorAttr = block.attributes.find((a) => a.type === "pardoseala");
    if (floorAttr) {
      const qty = suprafata;
      items.push({
        id: randomId(),
        nr: String(nr++),
        sectiune: camName,
        descriere_client: floorAttr.normalizedText,
        cantitate: qty,
        unitate: "mp",
        needsManualReview:
          floorAttr.needsManualReview ||
          !!suprafataSuspect ||
          qty === 0,
        reviewReason:
          floorAttr.reviewReason ??
          suprafataSuspect?.reviewReason ??
          (qty === 0 ? "Suprafață nedetectată — verificare manuală" : undefined),
        cameraNume: camName,
        materialTip: "pardoseala",
      });
    }

    // ── Tavan ────────────────────────────────────────────────────────────
    const tavanAttr = block.attributes.find((a) => a.type === "tavan");
    if (tavanAttr) {
      const qty = suprafata;
      items.push({
        id: randomId(),
        nr: String(nr++),
        sectiune: camName,
        descriere_client: tavanAttr.normalizedText,
        cantitate: qty,
        unitate: "mp",
        needsManualReview: qty === 0,
        reviewReason:
          qty === 0
            ? "Suprafață cameră nedetectată — necesară pentru tavan"
            : undefined,
        cameraNume: camName,
        materialTip: "tavan",
      });
    }

    // ── Finisaj perete ───────────────────────────────────────────────────
    const wallAttr = block.attributes.find((a) => a.type === "finisaj_perete");
    if (wallAttr) {
      const desc =
        wallAttr.normalizedText +
        (wallAttr.hFinisaj ? ` h=${wallAttr.hFinisaj}m` : "");
      items.push({
        id: randomId(),
        nr: String(nr++),
        sectiune: camName,
        descriere_client: desc,
        cantitate: 0,
        unitate: "mp",
        needsManualReview: true,
        reviewReason:
          "Suprafață perete = Perimetru cameră × înălțime finisaj — introduceți perimetrul",
        cameraNume: camName,
        materialTip: "finisaj_perete",
        hFinisaj: wallAttr.hFinisaj,
        perimeterM: undefined,
      });
    }

    // ── Suprafețe suspecte (rotite, trunchiate) ──────────────────────────
    const suspectAreas = block.attributes.filter(
      (a) => a.type === "suprafata" && a.needsManualReview
    );
    for (const sa of suspectAreas) {
      items.push({
        id: randomId(),
        nr: String(nr++),
        sectiune: camName,
        descriere_client: `[VERIFICARE SUPRAFAȚĂ] ${sa.rawText}`,
        cantitate: sa.value ?? 0,
        unitate: "mp",
        needsManualReview: true,
        reviewReason: sa.reviewReason,
        cameraNume: camName,
        materialTip: "suprafata" as any,
      });
    }
  }

  return items;
}

/**
 * Convertește RoomBlock[] generat de parserul local într-o structură PlanData
 * compatibilă cu motorul BOM.
 */
export function roomBlocksToPlanData(blocks: RoomBlock[]): PlanData {
  const spaces = blocks.map((block) => {
    const camName = block.name + (block.number ? ` (${block.number})` : "");
    const areaSqm = block.suprafata ?? 0;

    const floorAttr = block.attributes.find((a) => a.type === "pardoseala");
    const tavanAttr = block.attributes.find((a) => a.type === "tavan");
    const peretiAttr = block.attributes.find((a) => a.type === "finisaj_perete");
    const heightAttr = block.attributes.find((a) => a.type === "inaltime");

    const nameLower = camName.toLowerCase();
    const isWetRoom =
      nameLower.includes("baie") ||
      nameLower.includes("g.s.") ||
      nameLower.includes("wc") ||
      nameLower.includes("toilet") ||
      nameLower.includes("bucatarie") ||
      nameLower.includes("spalatorie");

    return {
      name: camName,
      areaSqm,
      isWetRoom,
      pardoseala: floorAttr ? floorAttr.normalizedText : undefined,
      tavan: tavanAttr ? tavanAttr.normalizedText : undefined,
      pereti: peretiAttr ? {
        finisaj: peretiAttr.normalizedText,
        hFinisaj: peretiAttr.hFinisaj ?? heightAttr?.value ?? undefined,
      } : undefined,
      heightM: heightAttr?.value ?? undefined,
    };
  });

  return {
    planType: "finisaje_rezidential",
    spaces,
    structuralElements: [],
  };
}
