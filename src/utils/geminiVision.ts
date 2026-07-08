/**
 * geminiVision.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Extrage specificații din planuri arhitecturale PDF folosind Gemini Vision.
 *
 * Flux:
 *   ArrayBuffer (PDF)
 *     → renderPageToBase64()     — randează fiecare pagină în canvas → JPEG base64
 *     → callGeminiVision()       — trimite imaginile la Gemini 2.5 Flash Vision
 *     → parsePlanDataResponse()  — parsează JSON-ul returnat în PlanData
 */

import * as pdfjsLib from "pdfjs-dist";
import { callAiProxy } from "@/utils/aiProxy";
import type { PlanData, PlanSpace, StructuralElement } from "@/types/planTypes";

// ── Randare pagini PDF → imagini base64 ──────────────────────────────────────

/**
 * Randează o pagină PDF într-un canvas și o returnează ca JPEG base64.
 * Scale=2.0 pentru suficientă rezoluție la citirea textului și cotelor.
 */
async function renderPageToBase64(page: any, scale = 2.0): Promise<string> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  // JPEG la 85% calitate — suficient pentru text, mai mic decât PNG
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
}

// ── Prompt Gemini Vision ──────────────────────────────────────────────────────

const FLOOR_PLAN_PROMPT = `Ești un expert în citirea planurilor arhitecturale românești.
Analizează imaginile atașate (pagini dintr-un plan PDF) și extrage toate informațiile de mai jos.
Returnează EXCLUSIV un obiect JSON valid, fără text suplimentar.

SCHEMA JSON DE RETURNAT:
{
  "planType": "<finisaje_rezidential|finisaje_public|industrial|structural|acoperis|subsol|mixt|necunoscut>",
  "titlu": "<titlul planului din cartuș dacă există>",
  "scara": "<ex: 1:100>",
  "totalArieConstruita": <număr mp total dacă e menționat>,
  "spaces": [
    {
      "name": "<denumirea exactă din plan, ex: G.S. FETE, SALA CLASA 1, LIVING, HOL>",
      "areaSqm": <suprafața numerică din S=, ex: 8.20>,
      "perimeterM": <perimetrul calculat din cotele planului = 2*(L+l) sau suma laturilor>,
      "dimensions": [{"w": <lățime m>, "l": <lungime m>, "label": "<opțional>"}],
      "heightM": <înălțimea din H=, ex: 2.80>,
      "isWetRoom": <true dacă e baie, grup sanitar, bucătărie, WC, dus, lavoar>,
      "pardoseala": "<tipul pardoselii dacă e specificat, ex: gresie antiderapantă de interior>",
      "pereti": {
        "finisaj": "<tipul finisajului ex: faianță, vopsea lavabilă, tencuială decorativă>",
        "hFinisaj": <înălțimea finisajului în m, ex: 1.20>
      },
      "tavan": "<tipul tavanului, ex: tavan casetat 600x600, tavan fals rigips, zugrăveală>",
      "specialNotes": ["<alte observații relevante>"]
    }
  ],
  "structuralElements": [
    {
      "type": "<zidarie|planseu|fundatie|stalp|grinda|acoperis|alt>",
      "material": "<ex: cărămidă, BCA, beton C20/25>",
      "dimensiuni": {"grosime": 0.25},
      "cantitate": <dacă e menționată>,
      "unit": "<mp|mc|ml|buc>",
      "locatie": "<ex: perete exterior, perete interior>"
    }
  ],
  "envelope": {
    "termosistem": {
      "tip": "<vată minerală bazaltică|polistiren expandat EPS>",
      "grosimeMM": <100|120|150>,
      "suprafataMP": <suprafața în mp>
    },
    "acoperis": {
      "tip": "<terasa necirculabila|sarpanta|terasa circulabila>",
      "suprafataMP": <mp>,
      "panta": <grade sau procente>,
      "material": "<membrane bituminoase|tiglă ceramică>"
    }
  },
  "generalNotes": ["<observații generale din plan>"],
  "isPartialExtraction": <true dacă planul e greu de citit sau lipsesc date>
}

REGULI IMPORTANTE:
1. Extrage TOATE spațiile vizibile în plan, inclusiv holuri, casa scărilor, depozite.
2. Perimetrul se calculează din liniile de cotă (dimensiunile înscrise pe plan). Dacă spațiul
   are dimensiunile 3.50m x 4.20m, perimetrul = 2*(3.50+4.20) = 15.40m.
3. Dacă nu găsești o valoare, pune null (nu omite câmpul).
4. Dacă planul nu are finisaje specificate (ex: plan structural), returnează spaces[] gol
   și completează structuralElements[].
5. isWetRoom = true pentru: baie, grup sanitar, G.S., WC, bucătărie, spălătorie, filtru sanitar.
6. Pentru clădiri industriale/hale, tipul pardoselii poate fi: beton sclivisit, pardoseală
   industrială epoxidică, etc.
7. Returnează NUMAI JSON valid. Fără \`\`\`json sau alte prefixe.`;

/**
 * Helper pentru conversia rapidă a ArrayBuffer în Base64 în mod securizat (fără call stack overflow).
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000; // 32KB chunks
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as any);
  }
  return btoa(binary);
}

// ── Apel Gemini Vision ────────────────────────────────────────────────────────

/**
 * Extrage date structurate dintr-un plan PDF folosind Gemini 2.5 Flash Vision.
 *
 * @param pdfBuf   ArrayBuffer-ul fișierului PDF
 * @param onProgress Callback opțional de progres (string cu statusul curent)
 * @returns PlanData cu toate spațiile și specificațiile extrase
 */
export async function extractPlanWithGeminiVision(
  pdfBuf: ArrayBuffer,
  onProgress?: (msg: string) => void
): Promise<PlanData> {
  onProgress?.("Inițializare PDF...");

  let totalPages = 1;
  try {
    const pdf = await pdfjsLib.getDocument({ data: pdfBuf.slice(0) }).promise;
    totalPages = pdf.numPages;
  } catch (err) {
    console.warn("Nu s-a putut citi numărul de pagini din PDF:", err);
  }

  onProgress?.("Pregătesc fișierul PDF pentru analiză...");
  const base64Pdf = arrayBufferToBase64(pdfBuf);

  onProgress?.("Trimit planul direct la Gemini Vision...");

  // Construim payload-ul Gemini multimodal cu PDF-ul direct
  const payload = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: base64Pdf
            }
          },
          { text: FLOOR_PLAN_PROMPT }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,      // deterministic — vrem extragere precisă
      maxOutputTokens: 8192,
    },
  };

  const { ok, status, data } = await callAiProxy("gemini", payload, "gemini-2.0-flash");

  if (!ok) {
    throw new Error(`Gemini Vision error (${status}): ${data?.error ?? "eroare necunoscută"}`);
  }

  // Extragem textul din răspunsul Gemini
  const rawText: string =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  if (!rawText.trim()) {
    throw new Error("Gemini Vision nu a returnat date. Verificați că PDF-ul conține un plan lizibil.");
  }

  onProgress?.("Parsez răspunsul...");
  return parsePlanDataResponse(rawText, totalPages);
}

// ── Parser răspuns JSON ───────────────────────────────────────────────────────

function parsePlanDataResponse(rawText: string, numPages: number): PlanData {
  // Curățăm eventuale markdown code blocks (deși am cerut JSON pur)
  const cleaned = rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err: any) {
    // Dacă JSON-ul e malformat, returnăm un PlanData minimal cu review necesar
    console.error("[geminiVision] JSON parse error. Raw:", cleaned.slice(0, 500));
    return {
      planType: "necunoscut",
      numPages,
      spaces: [],
      structuralElements: [],
      isPartialExtraction: true,
      generalNotes: ["Eroare parsare răspuns Gemini: " + err.message],
      rawResponseText: rawText,
    };
  }

  // Normalizăm spaces
  const spaces: PlanSpace[] = (parsed.spaces ?? []).map((s: any) => ({
    name: String(s.name ?? "Spațiu necunoscut"),
    areaSqm: parseNum(s.areaSqm) ?? 0,
    perimeterM: parseNum(s.perimeterM) ?? undefined,
    dimensions: s.dimensions ?? undefined,
    heightM: parseNum(s.heightM) ?? undefined,
    isWetRoom: Boolean(s.isWetRoom),
    pardoseala: s.pardoseala ?? undefined,
    pereti: s.pereti?.finisaj
      ? {
          finisaj: String(s.pereti.finisaj),
          hFinisaj: parseNum(s.pereti.hFinisaj) ?? undefined,
        }
      : undefined,
    tavan: s.tavan ?? undefined,
    specialNotes: Array.isArray(s.specialNotes) ? s.specialNotes : undefined,
  }));

  // Normalizăm structural elements
  const structuralElements: StructuralElement[] = (parsed.structuralElements ?? []).map(
    (el: any) => ({
      type: el.type ?? "alt",
      material: el.material ?? undefined,
      dimensiuni: el.dimensiuni ?? undefined,
      cantitate: parseNum(el.cantitate) ?? undefined,
      unit: el.unit ?? "buc",
      locatie: el.locatie ?? undefined,
    })
  );

  return {
    planType: parsed.planType ?? "necunoscut",
    titlu: parsed.titlu ?? undefined,
    scara: parsed.scara ?? undefined,
    totalArieConstruita: parseNum(parsed.totalArieConstruita) ?? undefined,
    numPages,
    spaces,
    structuralElements,
    envelope: parsed.envelope
      ? {
          termosistem: parsed.envelope.termosistem
            ? {
                tip: String(parsed.envelope.termosistem.tip ?? ""),
                grosimeMM: parseNum(parsed.envelope.termosistem.grosimeMM) ?? 100,
                suprafataMP: parseNum(parsed.envelope.termosistem.suprafataMP) ?? 0,
              }
            : undefined,
          acoperis: parsed.envelope.acoperis
            ? {
                tip: String(parsed.envelope.acoperis.tip ?? ""),
                suprafataMP: parseNum(parsed.envelope.acoperis.suprafataMP) ?? 0,
                panta: parseNum(parsed.envelope.acoperis.panta) ?? undefined,
                material: parsed.envelope.acoperis.material ?? undefined,
              }
            : undefined,
        }
      : undefined,
    generalNotes: Array.isArray(parsed.generalNotes) ? parsed.generalNotes : [],
    isPartialExtraction: Boolean(parsed.isPartialExtraction),
    rawResponseText: rawText,
  };
}

function parseNum(val: any): number | null {
  if (val === null || val === undefined) return null;
  const n = typeof val === "string" ? parseFloat(val.replace(",", ".")) : Number(val);
  return isNaN(n) ? null : n;
}
