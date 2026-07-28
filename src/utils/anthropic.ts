import { supabase } from "@/integrations/supabase/client";
import { callAiProxy } from "@/utils/aiProxy";
import {
  ANTHROPIC_VISION_MODEL,
  ANTHROPIC_TEXT_MODEL,
  ANTHROPIC_MAX_TOKENS_EXTRACT,
  ANTHROPIC_MAX_TOKENS_CLASSIFY,
} from "@/utils/aiConfig";

// API keys are stored server-side and used only inside the `ai-proxy` edge
// function. The browser never has access to them.


// Helper to make text queries accent-insensitive in PostgreSQL ilike
function makeIlikePattern(word: string): string {
  return word
    .replace(/[aăâAĂÂ]/g, '_')
    .replace(/[iîIÎ]/g, '_')
    .replace(/[sșşSȘŞ]/g, '_')
    .replace(/[tțţTȚŢ]/g, '_');
}

// Helper to remove diacritics for local string comparison
function removeDiacritics(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ș/g, 's').replace(/ț/g, 't')
    .replace(/Ș/g, 'S').replace(/Ț/g, 'T')
    .replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
    .replace(/Ă/g, 'A').replace(/Â/g, 'A').replace(/Î/g, 'I');
}

// Helper to recursively convert OpenAPI/JSON schema to Gemini-compliant format (capitalized types)
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
    // Remove unsupported properties in Gemini schema
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

// ── Generic Tool Caller for Gemini (Structured JSON) ────────────────────────
async function callGeminiTool(
  systemPrompt: string,
  userPrompt: string,
  toolSchema: any,
  imageInput?: { mimeType: string; base64: string }
): Promise<any> {
  const parts: any[] = [];
  if (imageInput) {
    parts.push({
      inlineData: {
        mimeType: imageInput.mimeType,
        data: imageInput.base64
      }
    });
  }
  parts.push({ text: userPrompt });

  // Append the expected JSON schema to the system prompt so Gemini knows the exact output structure.
  const schemaHint = toolSchema?.input_schema
    ? `\n\nRăspunde EXCLUSIV cu un obiect JSON valid care respectă exact această schemă:\n${JSON.stringify(toolSchema.input_schema, null, 2)}`
    : "";

  const body = {
    contents: [
      {
        role: "user",
        parts
      }
    ],
    systemInstruction: {
      parts: [{ text: systemPrompt + schemaHint }]
    },
    generationConfig: {
      // responseMimeType asigură că modelul returnează JSON valid.
      responseMimeType: "application/json"
    }
  };

  const { ok, status, data } = await callAiProxy("gemini", body);
  if (!ok) {
    console.error("Gemini API Error:", status, data);
    throw new Error(`Eroare API Gemini (${status}): ${data?.error || ""}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini nu a returnat date structurate valabile.");
  }

  return JSON.parse(text.trim());
}

// ── Generic Tool Caller for Anthropic with Gemini Fallback ───────────────────
async function callAnthropicTool(
  systemPrompt: string,
  userPrompt: string,
  toolSchema: any,
  toolName: string
): Promise<any> {
  try {
    const { ok, status, data } = await callAiProxy("anthropic", {
      model: ANTHROPIC_TEXT_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      tools: [toolSchema],
      tool_choice: { type: "tool", name: toolName }
    });

    if (!ok) {
      console.error("Anthropic API Error:", status, data);
      throw new Error(`Eroare API Anthropic (${status})`);
    }

    const toolCall = data.content?.find((c: any) => c.type === "tool_use" && c.name === toolName);

    if (!toolCall?.input) {
      throw new Error("Modelul nu a returnat date structurate valabile.");
    }

    return toolCall.input;
  } catch (error) {
    console.warn("Anthropic call failed or key missing, trying Gemini fallback...", error);
    try {
      return await callGeminiTool(systemPrompt, userPrompt, toolSchema);
    } catch (geminiError: any) {
      console.error("Gemini fallback also failed:", geminiError);
      throw new Error(`Apelul AI a eșuat. Anthropic: ${error instanceof Error ? error.message : error}. Gemini: ${geminiError?.message || geminiError}`);
    }
  }
}

// ── Vision Table Extractor (replacing ocr-whatsapp) ─────────────────────────
export async function extractTableFromImageWithAnthropic(
  imageBase64: string,
  mimeType: string,
  contextType: "price_list" | "antemasuratoare" = "price_list"
): Promise<{ headers: string[]; rows: string[][]; column_map?: any }> {
  
  const systemPrompt = contextType === "price_list" 
    ? `Ești expert în extragerea tabelelor din liste de prețuri pentru materiale de construcții din România (Baumit, Weber, Ceresit, Knauf, Mapei, Leier, Bramac etc.), trimise pe WhatsApp de furnizori.
Extrage TOATE rândurile din tabel, inclusiv rândul de antet (header).
Reguli stricte:
- Păstrează denumirile produselor exact cum apar în imagine
- Prețurile sunt valori numerice pure, fără simbol de monedă (ex: 47.50 nu "47,50 lei")
- UM = unitate de măsură: sac, kg, m2, ml, buc, l, t, set etc.
- Ignoră logo-uri, anteturi de companie, numere de pagină, ștampile
- Toate rândurile returnate trebuie să aibă același număr de celule ca header-ul
- Celulele goale se returnează ca string gol ""`
    : `Ești expert în extragerea datelor din Antemăsurători (liste de cantități / devize) pentru construcții din România.
Extrage TOATE rândurile din tabel, inclusiv rândul de antet (header).
Reguli stricte:
- Extrage toate materialele, suprafețele, lucrările sau operațiunile generice exact cum apar în imagine.
- Nu ignora rândurile care nu par a fi "produse standard". Dacă este o operațiune sau un material generic (ex: "Sapa", "Vata", "Manopera"), extrage-l!
- Extrage cantitatea și unitatea de măsură (mp, mc, buc, kg, etc.) pentru fiecare rând.
- Toate rândurile returnate trebuie să aibă același număr de celule ca header-ul.
- Celulele goale se returnează ca string gol "".`;

  const toolSchema = {
    name: "extract_price_table",
    description: "Structured extraction of a price list table from image",
    input_schema: {
      type: "object",
      properties: {
        headers: { type: "array", items: { type: "string" }, description: "Column names from the header row" },
        rows: {
          type: "array",
          items: { type: "array", items: { type: "string" } },
          description: "All data rows (excluding header). Each inner array has same length as headers.",
        },
        column_map: {
          type: "object",
          properties: {
            denumire: { type: "number", description: "Index (0-based) of the product name column" },
            pret: { type: "number", description: "Index of the price column" },
            um: { type: "number", description: "Index of the unit of measure column, or -1 if not present" },
            cod_furnizor: { type: "number", description: "Index of the supplier/internal product code column, or -1 if not present" },
            cantitate_palet: { type: "number", description: "Index of pallet quantity column, or -1 if not present" },
            consum: { type: "number", description: "Index of consumption column, or -1 if not present" }
          },
          description: "Mapping of semantic columns to their 0-based index in headers. Use -1 if column not found."
        },
        note: { type: "string", description: "Optional: observation about image quality" },
      },
      required: ["headers", "rows"]
    }
  };

  try {
    const { ok, status, data } = await callAiProxy("anthropic", {
      model: ANTHROPIC_VISION_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mimeType, data: imageBase64 }
            },
            { type: "text", text: "Extrage tabelul complet din această imagine. Include rândul de antet și toate rândurile de date." }
          ]
        }
      ],
      tools: [toolSchema],
      tool_choice: { type: "tool", name: "extract_price_table" }
    });

    if (!ok) {
      console.error("Anthropic API Error:", status, data);
      throw new Error(`Eroare API Anthropic (${status}): ${data?.error || ""}`);
    }

    const toolCall = data.content?.find((c: any) => c.type === "tool_use" && c.name === "extract_price_table");
    if (!toolCall?.input) throw new Error("Nu s-au putut extrage datele structurate din imagine.");
    
    const extracted = toolCall.input;
    const colCount = (extracted.headers || []).length;
    const normalizedRows = (extracted.rows || []).map((row: string[]) => {
      const padded = [...row];
      while (padded.length < colCount) padded.push("");
      return padded.slice(0, colCount);
    });

    return { headers: extracted.headers, rows: normalizedRows, column_map: extracted.column_map };
  } catch (error) {
    console.error("Vision Anthropic call failed:", error);
    throw new Error(`Eroare extragere imagine (Vision). Anthropic: ${error instanceof Error ? error.message : error}`);
  }
}

// ── Text Table Extractor (for PDFs and manual paste) ─────────────────────────
export async function extractAntemasuratoareFromTextWithAnthropic(
  text: string
): Promise<{ headers: string[]; rows: string[][] }> {
  
  const systemPrompt = `Ești expert în extragerea datelor din Antemăsurători (liste de cantități / devize) pentru construcții din România, extrase ca text brut din fișiere PDF.
Sarcina ta este să convertești textul brut într-un tabel structurat.
Reguli stricte:
- Extrage toate materialele, suprafețele, lucrările sau operațiunile generice exact cum apar în text.
- Nu ignora rândurile cu materiale generice (ex: "Sapa", "Vata", "Manopera", etc).
- Extrage cantitatea și unitatea de măsură (mp, mc, buc, kg, etc.) pentru fiecare rând.
- Toate rândurile returnate trebuie să aibă același număr de celule ca header-ul.
- Celulele goale se returnează ca string gol "".`;

  const toolSchema = {
    name: "extract_price_table",
    description: "Structured extraction of a bill of quantities table from raw text",
    input_schema: {
      type: "object",
      properties: {
        headers: { 
          type: "array", 
          items: { type: "string" }, 
          description: "MUST be exactly these 3 column names: ['Denumire', 'Cantitate', 'UM']" 
        },
        rows: {
          type: "array",
          items: { type: "array", items: { type: "string" } },
          description: "All data rows (excluding header). Each inner array has same length as headers.",
        },
      },
      required: ["headers", "rows"]
    }
  };

  try {
    const { ok, status, data } = await callAiProxy("anthropic", {
      model: ANTHROPIC_TEXT_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: `Text brut extras din antemăsurătoare:\n\n${text.substring(0, 50000)}` }],
      tools: [toolSchema],
      tool_choice: { type: "tool", name: "extract_price_table" }
    });

    if (!ok) {
      console.error("Anthropic API Error:", status, data);
      throw new Error(`Eroare API Anthropic (${status}): ${data?.error || ""}`);
    }
    const toolCall = data.content?.find((c: any) => c.type === "tool_use" && c.name === "extract_price_table");
    if (!toolCall?.input) throw new Error("Nu s-au putut extrage datele structurate din text.");
    
    const extracted = toolCall.input;
    const colCount = (extracted.headers || []).length;
    const normalizedRows = (extracted.rows || []).map((row: string[]) => {
      const padded = [...row];
      while (padded.length < colCount) padded.push("");
      return padded.slice(0, colCount);
    });

    return { headers: extracted.headers, rows: normalizedRows };
  } catch (error) {
    console.warn("Text extraction Anthropic call failed, trying Gemini fallback...", error);
    try {
      const extracted = await callGeminiTool(
        systemPrompt,
        `Text brut extras din antemăsurătoare:\n\n${text.substring(0, 50000)}`,
        toolSchema
      );
      const colCount = (extracted.headers || []).length;
      const normalizedRows = (extracted.rows || []).map((row: string[]) => {
        const padded = [...row];
        while (padded.length < colCount) padded.push("");
        return padded.slice(0, colCount);
      });
      return { headers: extracted.headers, rows: normalizedRows };
    } catch (geminiError: any) {
      console.error("Gemini text extraction fallback also failed:", geminiError);
      throw new Error(`Eroare extragere text. Anthropic: ${error instanceof Error ? error.message : error}. Gemini: ${geminiError?.message || geminiError}`);
    }
  }
}

// ── Floor Plan Text Extractor ────────────────────────────────────────────────
// Prompt dedicat pentru planuri arhitecturale (planșe de etaj/parter).
// DIFERIT de extractAntemasuratoareFromTextWithAnthropic care e pentru devize tabelulare.
export async function extractFloorPlanFromTextWithAnthropic(
  text: string
): Promise<{
  camere: Array<{
    camera: string;
    suprafata_mp: number | null;
    suprafata_needs_review: boolean;
    pardoseala: string | null;
    tavan: string | null;
    finisaj_perete: string | null;
    h_finisaj: number | null;
    inaltime_camera: number | null;
    note: string;
  }>;
}> {
  const systemPrompt = `Ești expert în citirea planșelor de arhitectură (plan parter, plan etaj) din România.
Textul primit este extras din PDF și conține datele de finisaje ale camerelor.
Fiecare cameră are de regulă:
- Nume cameră (ALL CAPS, ex: "G.S. FETE", "SALA CLASA 1", "HOL 1")
- S = <valoare> mp (suprafața pardoselii)
- Material pardoseală (ex: gresie antiderapantă de interior, parchet laminat, beton)
- Tavan: "tavan fals" dacă apare explicit
- Finisaj perete: "faianță h=1,20m" sau "vopsea pe bază de ulei h=1,20m"
- H = <valoare> (înălțimea camerei, dacă diferă de standard)

REGULI STRICTE:
1. Extrage FIECARE cameră ca un obiect separat
2. Pentru fiecare cameră extrage TOATE cele 3-4 atribute: pardoseala, tavan, finisaj_perete
3. Dacă valoarea S= pare trunchiată (ex: "41." fără zecimale sau "S=" fără cifre), setează suprafata_needs_review=true
4. Normalizează: "antiderapanta" → "antiderapantă", "faianta" → "faianță"
5. "gresie" lângă text corupt = probabil "gresie antiderapantă de interior"
6. Dacă un atribut lipsește, returnează null (nu inventa date)
7. Nu confunda etichetele de plan ("LIMITA PROPRIETATE", "NORD") cu camere — camerele au S= asociat`;

  const toolSchema = {
    name: "extract_floor_plan",
    description: "Extracts room-by-room finishing materials from architectural floor plan text",
    input_schema: {
      type: "object",
      properties: {
        camere: {
          type: "array",
          items: {
            type: "object",
            properties: {
              camera:                 { type: "string",  description: "Numele camerei (ALL CAPS)" },
              suprafata_mp:          { type: ["number", "null"], description: "Valoarea S= în mp. null dacă lipsește." },
              suprafata_needs_review:{ type: "boolean", description: "true dacă S= pare trunchiat sau lipsă" },
              pardoseala:            { type: ["string", "null"], description: "Material pardoseală. null dacă nu apare." },
              tavan:                 { type: ["string", "null"], description: "'tavan fals' sau null" },
              finisaj_perete:        { type: ["string", "null"], description: "'faianță' sau 'vopsea pe bază de ulei' sau null" },
              h_finisaj:             { type: ["number", "null"], description: "Înălțimea finisajului de perete în m (ex: 1.20). null dacă nu e specificat." },
              inaltime_camera:       { type: ["number", "null"], description: "Înălțimea camerei H= în m. null dacă nu apare." },
              note:                  { type: "string",  description: "Observații (corupții detectate, text rotit, etc.)" },
            },
            required: ["camera", "suprafata_mp", "suprafata_needs_review", "pardoseala", "tavan", "finisaj_perete", "h_finisaj", "inaltime_camera", "note"],
          },
        },
      },
      required: ["camere"],
    },
  };

  const userMsg = `Text extras din planșa de arhitectură:\n\n${text.substring(0, 60000)}`;

  try {
    const result = await callAnthropicTool(
      systemPrompt,
      userMsg,
      toolSchema,
      "extract_floor_plan"
    );
    return result;
  } catch (error) {
    console.warn("extractFloorPlanFromTextWithAnthropic failed:", error);
    // Gemini fallback
    try {
      return await callGeminiTool(systemPrompt, userMsg, toolSchema);
    } catch (geminiError: any) {
      throw new Error(
        `Eroare extragere plan arhitectural. Anthropic: ${
          error instanceof Error ? error.message : error
        }. Gemini: ${geminiError?.message ?? geminiError}`
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STRUCTURAL PLAN VISION EXTRACTORS
// ─────────────────────────────────────────────────────────────────────────────
// Extragere planuri structurale (armătură + beton) din PDF-uri SCANATE, care
// nu au text layer. Randare pdfjs → JPEG base64 → Anthropic Vision cu tool
// schema dedicată. Aritmetica se face DETERMINIST în rebarAggregator.ts, NU
// e cerută modelului. Vezi CLAUDE.md §8 + spec §5, §6.
// ═══════════════════════════════════════════════════════════════════════════

/** Helper: apel Anthropic Vision cu tool_choice, fără fallback Gemini (imaginile
 *  au format diferit între cei doi provideri, iar spec-ul cere Anthropic). */
async function callAnthropicVisionTool(
  systemPrompt: string,
  userText: string,
  imageBase64: string,
  mimeType: string,
  toolSchema: any,
  toolName: string,
  maxTokens = ANTHROPIC_MAX_TOKENS_EXTRACT
): Promise<any> {
  const { ok, status, data } = await callAiProxy("anthropic", {
    model: ANTHROPIC_VISION_MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mimeType, data: imageBase64 },
          },
          { type: "text", text: userText },
        ],
      },
    ],
    tools: [toolSchema],
    tool_choice: { type: "tool", name: toolName },
  });

  if (!ok) {
    console.error("Anthropic Vision Error:", status, data);
    throw new Error(`Anthropic Vision (${status}): ${data?.error ?? "eroare necunoscută"}`);
  }

  const toolCall = data.content?.find(
    (c: any) => c.type === "tool_use" && c.name === toolName
  );
  if (!toolCall?.input) {
    throw new Error("Modelul Vision nu a returnat date structurate valabile.");
  }
  return toolCall.input;
}

// ── (A) EXTRAS DE ARMĂTURĂ — tabel centralizator, sursă primară ──────────────

export interface ExtractedExtrasResult {
  categorie: string | null;      // ex: "ARMARE FUNDAȚII" / "ARMARE CENTURI ȘI GRINZI"
  proiect: string | null;
  beneficiar: string | null;
  marcaImplicita: string | null; // marcă activă pentru rândurile fără marcă explicită
  randuri: Array<{
    poz: string;
    marca: string | null;        // marca specifică rândului, dacă diferă (null → moștenește marcaImplicita)
    diametruMm: number;
    numarBare: number;
    lungimeUnaBara: number;      // metri
    lungimeTotalaSursa: number | null; // valoarea tipărită în tabel — pentru cross-check
    tipBara: "dreapta" | "etrier" | "distributie";
    note: string;
  }>;
  footer: {
    perDiametru: Array<{
      diametruMm: number;
      totalMl: number | null;
      totalKg: number | null;
    }>;
    totalKg: number | null;
  };
  observatii: string;
}

export async function extractStructuralExtrasFromImageWithAnthropic(
  imageBase64: string,
  mimeType: string
): Promise<ExtractedExtrasResult> {
  const systemPrompt = `Ești expert în citirea tabelelor „Extras de armătură" de pe planurile de rezistență românești (SR EN 1992-1-1 / STAS 438).

CONTEXT: aceste tabele centralizează pozițiile de armătură pentru o categorie de elemente (fundații, centuri, grinzi, stâlpi, placă). Sunt tipărite adesea landscape pe pagină portrait — trebuie să interpretezi TEXT ROTIT LA ORICE UNGHI (0°, 90°, 180°, 270°).

STRUCTURA STANDARD A TABELULUI:
  Antet:  Poz | Ø [mm] | Nr. bare | Lungime bară [m] | Lungime totală [m]
  Rânduri: câte una per poziție (Poz poate fi „1a", „2", „11k")
  Marca oțelului („B 500 C", „PC 52", „OB 37") apare ca antet de secțiune peste
  un grup de rânduri, NU ca o coloană în fiecare rând. Reține marca „activă"
  pe măsură ce parcurgi rândurile de sus în jos.
  Footer:  „LUNGIMEA PE DIAMETRE" (sumă ml/Ø) + „MASA PE DIAMETRU" (sumă kg/Ø) + „TOTAL [kg]".

REGULI STRICTE:
1. Extrage DOAR datele scrise. NU calcula, NU corecta, NU inventa. Aritmetica
   se face în cod, tu doar transcrii ce vezi.
2. Poz = codul exact al poziției (ex „1a", păstrează sufixul alfabetic).
3. Ø = numărul întreg (6, 8, 10, 12, 14, 16, 20 etc.).
4. „Nr. bare" = numărul întreg de bare identice (poate fi mare, ex 548).
5. „Lungime bară" = valoarea din coloană, exact așa cum e tipărită (poate fi 4.45 sau 4,45 — normalizează la punct zecimal).
6. „Lungime totală" = valoarea din coloana finală. **Dacă celula e goală, returnează null** (nu recalcula tu). Asta e vital — există bug-uri reale de proiectant unde celula lipsește, iar noi trebuie să detectăm asta.
7. Marca implicită (marcaImplicita) = marca principală declarată în antetul planșei. Rândurile individuale pot avea marca=null → moștenesc marcaImplicita.
8. tipBara:
   - „etrier" dacă poziția e desenată/adnotată ca etrier sau agrafă închisă (formă dreptunghiulară închisă lângă poziție)
   - „distributie" dacă e bară de repartiție/distribuție (notată `N Ø/pas`)
   - „dreapta" în rest (bare longitudinale drepte)
   Dacă nu poți distinge sigur, alege „dreapta" și menționează în „note".
9. FOOTER: extrage FIECARE Ø din „LUNGIMEA PE DIAMETRE" ca rând separat. Dacă un Ø prezent în rânduri lipsește din footer, NU-l inventa — pur și simplu nu-l pune în footer. Codul va detecta discrepanța.
10. Toate valorile numerice: folosește punct zecimal (nu virgulă). Convertește tu.`;

  const toolSchema = {
    name: "extract_rebar_extras",
    description: "Structured extraction of a rebar 'Extras de armătură' table from an image",
    input_schema: {
      type: "object",
      properties: {
        categorie: { type: ["string", "null"], description: "Titlul categoriei, ex: ARMARE FUNDAȚII" },
        proiect: { type: ["string", "null"], description: "Numele/numărul proiectului din antet" },
        beneficiar: { type: ["string", "null"] },
        marcaImplicita: { type: ["string", "null"], description: "Marca principală declarată în antet (ex 'B 500 C')" },
        randuri: {
          type: "array",
          items: {
            type: "object",
            properties: {
              poz: { type: "string" },
              marca: { type: ["string", "null"], description: "Marca specifică rândului, sau null dacă moștenește marcaImplicita" },
              diametruMm: { type: "number" },
              numarBare: { type: "number" },
              lungimeUnaBara: { type: "number", description: "În metri, cu punct zecimal" },
              lungimeTotalaSursa: { type: ["number", "null"], description: "Valoarea din coloana Lungime totală, sau null dacă celula e goală în tabel" },
              tipBara: { type: "string", enum: ["dreapta", "etrier", "distributie"] },
              note: { type: "string" },
            },
            required: ["poz", "marca", "diametruMm", "numarBare", "lungimeUnaBara", "lungimeTotalaSursa", "tipBara", "note"],
          },
        },
        footer: {
          type: "object",
          properties: {
            perDiametru: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  diametruMm: { type: "number" },
                  totalMl: { type: ["number", "null"] },
                  totalKg: { type: ["number", "null"] },
                },
                required: ["diametruMm", "totalMl", "totalKg"],
              },
            },
            totalKg: { type: ["number", "null"], description: "TOTAL [kg] global din footer" },
          },
          required: ["perDiametru", "totalKg"],
        },
        observatii: { type: "string", description: "Note despre calitatea extracției, celule ambigue, rotație pagină" },
      },
      required: ["categorie", "proiect", "beneficiar", "marcaImplicita", "randuri", "footer", "observatii"],
    },
  };

  return callAnthropicVisionTool(
    systemPrompt,
    "Extrage tabelul „Extras de armătură" din această imagine. Include TOATE rândurile Poz, marca implicită din antet, și footer-ul cu totalurile pe diametre.",
    imageBase64,
    mimeType,
    toolSchema,
    "extract_rebar_extras"
  );
}

// ── (B) PLANȘĂ GRAFICĂ STRUCTURALĂ — fallback / cross-validation ─────────────

export interface ExtractedGraphicRebarResult {
  titlu: string | null;             // titlul planșei din cartuș (ex "PLAN ARMARE PLACĂ PESTE PARTER")
  marcaImplicita: string | null;    // din caseta MATERIALE
  adnotari: Array<{
    poz: string | null;             // poate lipsi pe planșa grafică
    marca: string | null;
    diametruMm: number;
    tipBara: "dreapta" | "etrier" | "distributie";
    numarBare: number;              // câte bare identice la ACEASTĂ ocurență (nu total)
    lungimeUnaBara: number | null;  // pentru bare drepte: L=X,XXm; pentru etrier: perimetrul
    pas: number | null;             // pentru etrier/distributie: pasul în cm sau m
    zonaAcoperitaM: number | null;  // pentru distributie fără N explicit: lungimea zonei
    note: string;
  }>;
  observatii: string;
}

export async function extractStructuralAnnotationsFromImageWithAnthropic(
  imageBase64: string,
  mimeType: string
): Promise<ExtractedGraphicRebarResult> {
  const systemPrompt = `Ești expert în citirea planșelor grafice de rezistență (armare fundații, centuri, grinzi, stâlpi, placă) din România.

CONTEXT: pe planșa grafică barele de armătură sunt adnotate individual, împrăștiate pe desen. Aceeași poziție (ex „1a") apare de mai multe ori — o dată pentru fiecare element care folosește acel tip de bară. Fiecare ocurență se contorizează SEPARAT (agregarea se face în cod).

TREI PATTERN-URI DE ADNOTARE, DE RECUNOSCUT DISTINCT:

1) BARĂ DREAPTĂ:  „(poz) N × Ø D  L=X,XXm"
   Exemplu: „(1a) 3Ø14 L=6,20m" → poz=1a, tipBara=dreapta, numarBare=3, diametruMm=14, lungimeUnaBara=6.20

2) ETRIER / AGRAFĂ:  două adnotări legate una de alta:
   a) „(poz) etr.ØD L=X,XXm" (lungimea/perimetrul UNUI etrier, lângă schița formei lui)
   b) „etr ØD/pas — N buc" (câți etrieri sunt pe elementul respectiv, la pasul dat)
   Exemplu: „(2) etr.Ø8 L=1,15m" + „etr Ø8/20 — 137buc"
      → poz=2, tipBara=etrier, numarBare=137, lungimeUnaBara=1.15, pas=0.20
   Dacă găsești doar N și pas, dar nu perimetrul: lungimeUnaBara=null și menționează în note.

3) BARĂ / PLASĂ DE DISTRIBUȚIE:  „N Ø D / pas  L=X,XXm"
   Exemplu: „4Ø12/8 L=5,70m" → poz=null (dacă nu e etichetat), tipBara=distributie, numarBare=4, diametruMm=12, lungimeUnaBara=5.70, pas=0.08
   Pe suprafață mare: „NØD/m²" — atunci numarBare=N/m² × suprafață (fără cotă explicită NU calcula, lasă zonaAcoperitaM=null, semnalează în note).

REGULI STRICTE:
1. Extrage FIECARE ocurență a fiecărei adnotări. Nu deduplica pe „poz"; agregarea se face în cod.
2. Nu calcula lungimi totale sau kg. Tu doar transcrii N și L pentru ocurență.
3. Interpretează text rotit la orice unghi.
4. Marca implicită vine din caseta MATERIALE („# Oțel armături: ..."). Reține-o și pune-o în marcaImplicita.
5. Dacă nu poți distinge cu certitudine tipBara, alege „dreapta" și menționează ambiguitatea în note.
6. Ignoră cotele de dimensiuni ale elementelor (25×30, 3.50m etc.) — acelea sunt geometrie, nu armătură.`;

  const toolSchema = {
    name: "extract_rebar_annotations",
    description: "Structured extraction of individual rebar annotations from a structural drawing image",
    input_schema: {
      type: "object",
      properties: {
        titlu: { type: ["string", "null"] },
        marcaImplicita: { type: ["string", "null"] },
        adnotari: {
          type: "array",
          items: {
            type: "object",
            properties: {
              poz: { type: ["string", "null"] },
              marca: { type: ["string", "null"] },
              diametruMm: { type: "number" },
              tipBara: { type: "string", enum: ["dreapta", "etrier", "distributie"] },
              numarBare: { type: "number" },
              lungimeUnaBara: { type: ["number", "null"] },
              pas: { type: ["number", "null"] },
              zonaAcoperitaM: { type: ["number", "null"] },
              note: { type: "string" },
            },
            required: ["poz", "marca", "diametruMm", "tipBara", "numarBare", "lungimeUnaBara", "pas", "zonaAcoperitaM", "note"],
          },
        },
        observatii: { type: "string" },
      },
      required: ["titlu", "marcaImplicita", "adnotari", "observatii"],
    },
  };

  return callAnthropicVisionTool(
    systemPrompt,
    "Extrage TOATE adnotările de armătură (bare drepte, etrieri, distribuție) de pe această planșă. Include fiecare ocurență separat — agregarea se face în cod.",
    imageBase64,
    mimeType,
    toolSchema,
    "extract_rebar_annotations"
  );
}

// ── (C) Caseta „MATERIALE:" — metadate de clasă beton / marcă oțel ───────────

export interface ExtractedMaterialsBoxResult {
  gasit: boolean;
  beton: Array<{ element: string; clasa: string; note: string }>;
  otel: Array<{ element: string; marca: string }>;
  lemn: Array<{ specificatie: string }>;
  observatii: string;
}

export async function extractMaterialsBoxFromImageWithAnthropic(
  imageBase64: string,
  mimeType: string
): Promise<ExtractedMaterialsBoxResult> {
  const systemPrompt = `Ești expert în extragerea casetei „MATERIALE:" de pe planurile de rezistență românești.

Caseta e de obicei lângă cartușul de titlu (colț dreapta-jos), și arată așa:

  MATERIALE:
  # Beton:
    -fundatii: C25/30, XC2, Dmax16, Cem II/A-S 32,5R, Cl 0,20;
    -centuri: C20/25, XC1, Dmax16;
  # Oțel armături:
    -plasă pardoseală: PC52;
    -restul elementelor: B500C.
  # Lemn (dacă e planșă șarpantă):
    -lemn masiv clasă rezistență C24;
    -clasa de exploatare 2.

Extrage fiecare linie ca un obiect distinct. Dacă nu găsești caseta pe această pagină, setează gasit=false și returnează liste goale.

REGULI:
1. „element" = ce e înaintea „:" (ex „fundatii", „centuri", „plasă pardoseală", „restul elementelor"). Păstrează exact ce scrie.
2. „clasa" (beton) = doar codul clasei + expunere (ex „C25/30, XC2, Dmax16"). Restul (ciment, cloruri) merge în „note".
3. „marca" (oțel) = doar marca (ex „B500C", „PC52", „OB37"). Normalizează spațiile.
4. Nu inventa. Dacă nu e casetă → gasit=false.`;

  const toolSchema = {
    name: "extract_materials_box",
    description: "Extracts the MATERIALE box (beton class, otel marca, lemn) from a structural plan image",
    input_schema: {
      type: "object",
      properties: {
        gasit: { type: "boolean" },
        beton: {
          type: "array",
          items: {
            type: "object",
            properties: {
              element: { type: "string" },
              clasa: { type: "string" },
              note: { type: "string" },
            },
            required: ["element", "clasa", "note"],
          },
        },
        otel: {
          type: "array",
          items: {
            type: "object",
            properties: {
              element: { type: "string" },
              marca: { type: "string" },
            },
            required: ["element", "marca"],
          },
        },
        lemn: {
          type: "array",
          items: {
            type: "object",
            properties: { specificatie: { type: "string" } },
            required: ["specificatie"],
          },
        },
        observatii: { type: "string" },
      },
      required: ["gasit", "beton", "otel", "lemn", "observatii"],
    },
  };

  return callAnthropicVisionTool(
    systemPrompt,
    "Găsește și extrage caseta „MATERIALE:" de pe această planșă. Dacă nu există, setează gasit=false.",
    imageBase64,
    mimeType,
    toolSchema,
    "extract_materials_box",
    2048
  );
}

// ── (D) Clasificator ușor: ce e planșa? ──────────────────────────────────────

export interface StructuralPlanClassification {
  tipPlansa: "extras_armatura" | "plan_grafic_structural" | "plan_finisaje" | "sarpanta" | "necunoscut";
  titlu: string | null;
  areTabelExtras: boolean;
  areCasetaMateriale: boolean;
  rotatiePagina: 0 | 90 | 180 | 270;
  motivatie: string;
}

export async function classifyStructuralPlanWithAnthropic(
  imageBase64: string,
  mimeType: string
): Promise<StructuralPlanClassification> {
  const systemPrompt = `Ești expert în identificarea tipului de planșă de construcții din România, doar din prima ei imagine.

Trebuie să determini:
1. Ce tip de planșă e (privind cartușul de titlu + conținut general).
2. Dacă e prezent un tabel „Extras de armătură" (rectangular, cu coloane Poz / Ø / Nr. bare / Lungime).
3. Dacă e prezentă caseta „MATERIALE:" (# Beton / # Oțel armături).
4. Cu ce rotație e conținutul pe pagină (0/90/180/270°).

TIPURI DE PLANȘĂ:
- „extras_armatura": planșa este DOAR (sau majoritar) un tabel Extras de armătură. Fără desen grafic important.
- „plan_grafic_structural": planșă cu desen tehnic + adnotări de armare (bare, etrieri, poziții). Poate avea sau nu tabel Extras.
- „plan_finisaje": plan de arhitectură (camere, pardoseală, tavan). NU e structural.
- „sarpanta": planșă de acoperiș / șarpantă (grinzi lemn, tabel materiale lemn C24).
- „necunoscut": nu se poate clasifica cu certitudine.

Fii onest dacă nu ești sigur — pune „necunoscut" și explică în motivatie.`;

  const toolSchema = {
    name: "classify_structural_plan",
    description: "Classify the type of construction drawing from a single image",
    input_schema: {
      type: "object",
      properties: {
        tipPlansa: {
          type: "string",
          enum: ["extras_armatura", "plan_grafic_structural", "plan_finisaje", "sarpanta", "necunoscut"],
        },
        titlu: { type: ["string", "null"], description: "Titlul din cartuș, exact cum scrie" },
        areTabelExtras: { type: "boolean" },
        areCasetaMateriale: { type: "boolean" },
        rotatiePagina: { type: "number", enum: [0, 90, 180, 270] },
        motivatie: { type: "string" },
      },
      required: ["tipPlansa", "titlu", "areTabelExtras", "areCasetaMateriale", "rotatiePagina", "motivatie"],
    },
  };

  return callAnthropicVisionTool(
    systemPrompt,
    "Uită-te la această planșă și clasifică-o. Verifică prezența tabelului „Extras de armătură" și a casetei „MATERIALE:".",
    imageBase64,
    mimeType,
    toolSchema,
    "classify_structural_plan",
    2048
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STRUCTURAL PLAN TEXT-BASED EXTRACTORS (§13 din spec)
// ─────────────────────────────────────────────────────────────────────────────
// Oglindă a extractoarelor Vision de mai sus, dar cu input TEXT (extras nativ
// din PDF via pdfjs.getTextContent). Folosite când PDF-ul are text layer real
// (export CAD nativ) — mult mai ieftin și mai fiabil decât rasterizare + Vision.
//
// Schemele tool_use sunt IDENTICE cu versiunile Vision — datele rezultate
// intră în același `aggregateRebarEntries()` din rebarAggregator.ts, deci
// nicio duplicare de logică de agregare.
// ═══════════════════════════════════════════════════════════════════════════

/** Helper: apel Anthropic pe text cu tool_choice, fără fallback Gemini
 *  (păstrăm politica din §6: extractoarele structurale nu au fallback).
 *  Nu reutilizăm `callAnthropicTool` pentru că acela are fallback Gemini
 *  care ar masca eșecuri silențios. */
async function callAnthropicTextTool(
  systemPrompt: string,
  userText: string,
  toolSchema: any,
  toolName: string,
  maxTokens = ANTHROPIC_MAX_TOKENS_EXTRACT
): Promise<any> {
  const { ok, status, data } = await callAiProxy("anthropic", {
    model: ANTHROPIC_TEXT_MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userText }],
    tools: [toolSchema],
    tool_choice: { type: "tool", name: toolName },
  });

  if (!ok) {
    console.error("Anthropic Text Error:", status, data);
    throw new Error(`Anthropic Text (${status}): ${data?.error ?? "eroare necunoscută"}`);
  }

  const toolCall = data.content?.find(
    (c: any) => c.type === "tool_use" && c.name === toolName
  );
  if (!toolCall?.input) {
    throw new Error("Modelul text nu a returnat date structurate valabile.");
  }
  return toolCall.input;
}

// ── Tool schemas partajate Vision ↔ Text ────────────────────────────────────
// (schema tool_use e identică indiferent dacă input-ul e imagine sau text)

const EXTRAS_TOOL_SCHEMA = {
  name: "extract_rebar_extras",
  description: "Structured extraction of a rebar 'Extras de armătură' table",
  input_schema: {
    type: "object",
    properties: {
      categorie: { type: ["string", "null"], description: "Titlul categoriei, ex: ARMARE FUNDAȚII" },
      proiect: { type: ["string", "null"] },
      beneficiar: { type: ["string", "null"] },
      marcaImplicita: { type: ["string", "null"] },
      randuri: {
        type: "array",
        items: {
          type: "object",
          properties: {
            poz: { type: "string" },
            marca: { type: ["string", "null"] },
            diametruMm: { type: "number" },
            numarBare: { type: "number" },
            lungimeUnaBara: { type: "number" },
            lungimeTotalaSursa: { type: ["number", "null"] },
            tipBara: { type: "string", enum: ["dreapta", "etrier", "distributie"] },
            note: { type: "string" },
          },
          required: ["poz", "marca", "diametruMm", "numarBare", "lungimeUnaBara", "lungimeTotalaSursa", "tipBara", "note"],
        },
      },
      footer: {
        type: "object",
        properties: {
          perDiametru: {
            type: "array",
            items: {
              type: "object",
              properties: {
                diametruMm: { type: "number" },
                totalMl: { type: ["number", "null"] },
                totalKg: { type: ["number", "null"] },
              },
              required: ["diametruMm", "totalMl", "totalKg"],
            },
          },
          totalKg: { type: ["number", "null"] },
        },
        required: ["perDiametru", "totalKg"],
      },
      observatii: { type: "string" },
    },
    required: ["categorie", "proiect", "beneficiar", "marcaImplicita", "randuri", "footer", "observatii"],
  },
};

const ANNOTATIONS_TOOL_SCHEMA = {
  name: "extract_rebar_annotations",
  description: "Structured extraction of individual rebar annotations",
  input_schema: {
    type: "object",
    properties: {
      titlu: { type: ["string", "null"] },
      marcaImplicita: { type: ["string", "null"] },
      adnotari: {
        type: "array",
        items: {
          type: "object",
          properties: {
            poz: { type: ["string", "null"] },
            marca: { type: ["string", "null"] },
            diametruMm: { type: "number" },
            tipBara: { type: "string", enum: ["dreapta", "etrier", "distributie"] },
            numarBare: { type: "number" },
            lungimeUnaBara: { type: ["number", "null"] },
            pas: { type: ["number", "null"] },
            zonaAcoperitaM: { type: ["number", "null"] },
            note: { type: "string" },
          },
          required: ["poz", "marca", "diametruMm", "tipBara", "numarBare", "lungimeUnaBara", "pas", "zonaAcoperitaM", "note"],
        },
      },
      observatii: { type: "string" },
    },
    required: ["titlu", "marcaImplicita", "adnotari", "observatii"],
  },
};

/** Cale text pentru Extras de armătură (§13). Text-ul trebuie să vină cu
 *  poziționare păstrată (grupare rânduri după y, coloane după x) — dat de
 *  layoutTextItemsAsTable() din floorPlanParser.ts. */
export async function extractStructuralExtrasFromTextWithAnthropic(
  text: string
): Promise<ExtractedExtrasResult> {
  const systemPrompt = `Ești expert în citirea tabelelor „Extras de armătură" extrase ca TEXT din PDF-uri românești de rezistență.

CONTEXT: primești textul brut extras cu poziții (x,y) din PDF, grupat pe rânduri. E tabelul „EXTRAS DE ARMĂTURĂ" al unei categorii de elemente (fundații, centuri, grinzi, stâlpi, placă).

STRUCTURA STANDARD A TABELULUI:
  Antet:  Poz | Ø [mm] | Nr. bare | Lungime bară [m] | Lungime totală [m]
  Rânduri: câte una per poziție (Poz poate fi „1a", „2", „11k")
  Marca oțelului („B 500 C", „PC 52", „OB 37") apare ca antet de secțiune peste
  un grup de rânduri, NU ca o coloană în fiecare rând. Reține marca „activă"
  pe măsură ce parcurgi textul de sus în jos.
  Footer:  „LUNGIMEA PE DIAMETRE" (sumă ml/Ø) + „MASA PE DIAMETRU" (sumă kg/Ø) + „TOTAL [kg]".

REGULI STRICTE:
1. Extrage DOAR datele scrise. NU calcula, NU corecta, NU inventa. Aritmetica se face în cod.
2. Poz = codul exact al poziției (păstrează sufixul alfabetic).
3. „Lungime totală" = valoarea din coloana finală. **Dacă celula lipsește / e goală în text, returnează null** (nu recalcula). Există bug-uri reale de proiectant unde celula lipsește — trebuie să detectăm asta.
4. Marca implicită (marcaImplicita) = marca principală declarată în antetul planșei.
5. tipBara: „etrier" / „distributie" / „dreapta" (după context — extras-ul poate marca explicit tipul, altfel „dreapta").
6. FOOTER: extrage FIECARE Ø din „LUNGIMEA PE DIAMETRE" ca rând separat. Dacă un Ø prezent în rânduri lipsește din footer, NU-l inventa — codul va detecta discrepanța.
7. Toate valorile numerice: punct zecimal (nu virgulă).`;

  return callAnthropicTextTool(
    systemPrompt,
    `Text brut extras din PDF (rânduri grupate pe y, coloane pe x):\n\n${text.substring(0, 60000)}`,
    EXTRAS_TOOL_SCHEMA,
    "extract_rebar_extras"
  );
}

/** Cale text pentru adnotări individuale pe planșă grafică (§13). */
export async function extractStructuralAnnotationsFromTextWithAnthropic(
  text: string
): Promise<ExtractedGraphicRebarResult> {
  const systemPrompt = `Ești expert în citirea adnotărilor de armătură extrase ca TEXT dintr-o planșă grafică de rezistență românească.

CONTEXT: primești textul extras cu poziții din PDF. Adnotările de bare sunt împrăștiate pe desen — aceeași poziție (ex „1a") poate apărea de mai multe ori. Fiecare ocurență se contorizează SEPARAT (agregarea se face în cod).

TREI PATTERN-URI DE ADNOTARE:

1) BARĂ DREAPTĂ:  „(poz) N × Ø D  L=X,XXm"
   Exemplu: „(1a) 3Ø14 L=6,20m" → poz=1a, tipBara=dreapta, numarBare=3, diametruMm=14, lungimeUnaBara=6.20

2) ETRIER / AGRAFĂ:  două adnotări legate:
   a) „(poz) etr.ØD L=X,XXm" (perimetrul unui etrier)
   b) „etr ØD/pas — N buc" (câți etrieri la ce pas)
   Exemplu: „(2) etr.Ø8 L=1,15m" + „etr Ø8/20 — 137buc"

3) DISTRIBUȚIE:  „N Ø D / pas  L=X,XXm"
   Exemplu: „4Ø12/8 L=5,70m"

REGULI STRICTE:
1. Extrage FIECARE ocurență. Nu deduplica pe „poz".
2. Nu calcula lungimi totale — doar transcrii N și L per ocurență.
3. Marca implicită din caseta MATERIALE dacă apare.
4. Ignoră cotele de dimensiuni ale elementelor (25×30, 3.50m etc.) — geometrie, nu armătură.`;

  return callAnthropicTextTool(
    systemPrompt,
    `Text brut extras din planșa grafică:\n\n${text.substring(0, 60000)}`,
    ANNOTATIONS_TOOL_SCHEMA,
    "extract_rebar_annotations"
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LUMBER / ȘARPANTĂ (§14 din spec) — MVP conservator
// ─────────────────────────────────────────────────────────────────────────────
// NU există tabel centralizator de lemn (confirmat cu utilizatorul), deci
// NU există sursă de validare încrucișată — orice cantitate calculată aici
// e o estimare, NU un rezultat de încredere echivalent cu cel de armătură.
// Politica: needsManualReview: true necondiționat pe toate cantitățile.
// ═══════════════════════════════════════════════════════════════════════════

export interface ExtractedLumberResult {
  titluPlansa: string | null;
  clasaLemn: string | null;        // ex "C24"
  clasaExploatare: string | null;  // ex "2"
  tratament: string | null;        // ex "ignifugat"
  standardImbinari: string | null; // ex "SR EN 14080"
  sectiuniFolosite: Array<{
    secțiuneCm: string;            // ex "10x14", "12x14"
    tipElement: "caprior" | "pana" | "pop" | "cosoroaba" | "clesti" | "contrafisa" | "coama" | "alt";
    note: string;
  }>;
  imbinari: Array<{
    tip: string;                    // ex "coamă A", "reazem căprior", "bază pop"
    piese_metalice: string;         // ex "holzsurub Ø8 L=20cm"
    note: string;
  }>;
  observatii: string;
}

export async function extractLumberFromImageWithAnthropic(
  imageBase64: string,
  mimeType: string
): Promise<ExtractedLumberResult> {
  const systemPrompt = `Ești expert în citirea planșelor de șarpantă / acoperiș lemn românești.

CONTEXT: pe această planșă cauți DOAR catalogul de secțiuni + specificațiile materialului lemn + tipurile de îmbinări. NU calcula cantități totale — asta se face separat.

CE SĂ EXTRAGI:

1. **Caseta MATERIALE lemn**: clasa (ex C24), clasa exploatare (ex 2), tratamente (ignifugat), standard îmbinări (SR EN 14080).

2. **Catalog secțiuni**: fiecare secțiune de lemn folosită pe planșă (ex „10x14", „12x14", „14x14") și ce tip de element o folosește (căprior/pană/pop/cosoroabă/clești/contrafișă/coamă).

3. **Îmbinări**: tipurile de conexiuni desenate (coamă A, coamă B, reazem căprior, bază pop) și piesele metalice necesare (holzsurub Ø8 L=20cm, cuie striate, etc.).

REGULI STRICTE:
1. NU calcula cantități — doar catalog + specificații.
2. Extrage EXACT ce e tipărit; nu inventa dimensiuni sau tipuri.
3. Dacă un câmp nu apare pe această planșă, returnează null / listă goală.`;

  const toolSchema = {
    name: "extract_lumber",
    description: "Structured extraction of lumber section catalog + materials + joints from a wood-roof drawing",
    input_schema: {
      type: "object",
      properties: {
        titluPlansa: { type: ["string", "null"] },
        clasaLemn: { type: ["string", "null"] },
        clasaExploatare: { type: ["string", "null"] },
        tratament: { type: ["string", "null"] },
        standardImbinari: { type: ["string", "null"] },
        sectiuniFolosite: {
          type: "array",
          items: {
            type: "object",
            properties: {
              secțiuneCm: { type: "string" },
              tipElement: { type: "string", enum: ["caprior", "pana", "pop", "cosoroaba", "clesti", "contrafisa", "coama", "alt"] },
              note: { type: "string" },
            },
            required: ["secțiuneCm", "tipElement", "note"],
          },
        },
        imbinari: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tip: { type: "string" },
              piese_metalice: { type: "string" },
              note: { type: "string" },
            },
            required: ["tip", "piese_metalice", "note"],
          },
        },
        observatii: { type: "string" },
      },
      required: ["titluPlansa", "clasaLemn", "clasaExploatare", "tratament", "standardImbinari", "sectiuniFolosite", "imbinari", "observatii"],
    },
  };

  return callAnthropicVisionTool(
    systemPrompt,
    "Extrage catalogul de secțiuni de lemn, specificațiile materialului și tipurile de îmbinări de pe această planșă. NU calcula cantități.",
    imageBase64,
    mimeType,
    toolSchema,
    "extract_lumber"
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ROOF COVERING (§16) — Plan învelitoare / țiglă
// ─────────────────────────────────────────────────────────────────────────────
// Categorie SEPARATĂ de lemn/șarpantă (§14). Plan de arhitectură DTAC
// (nu structurist), calculează SUPRAFAȚĂ de acoperire (m² țiglă înclinată),
// nu secțiuni lemn. A02 e nativ CAD (text layer real) → folosim callAnthropicTextTool.
//
// Modelul returnează DOAR date brute (lista de cote, unghi, material,
// coame/dolii). Aritmetica (sumă cote, validare împotriva totalului,
// înmulțire cu 1/cos(pantă)) se face determinist în TS — vezi
// computeRoofCovering() din structuralGeometry.ts.
// ═══════════════════════════════════════════════════════════════════════════

export interface ExtractedRoofCoveringRaw {
  /** Titlul planșei din cartuș (ex „PLAN ÎNVELITOARE"). */
  titluPlansa: string | null;
  /** Unghiul de pantă tipărit pe planșă. Dacă apar mai multe valori pe
   *  versante diferite, returnează toate — codul verifică uniformitatea. */
  unghiuriPantaGrade: number[];
  /** Lista de cote pe axa X (orizontală) — segmentele de contur ale conturului
   *  acoperișului. Ex: [0.825, 3.40, 3.20, 2.25, 2.25, 2.85, 1.40, 0.825] */
  coteOrizontalaX: number[];
  /** Totalul tipărit al cotelor X (ex 17.00) — pentru validare împotriva sumei. */
  totalOrizontalaXTiparit: number | null;
  /** Idem pentru axa Y. */
  coteOrizontalaY: number[];
  totalOrizontalaYTiparit: number | null;
  /** Denumirea materialului dacă apare (ex „țiglă ceramică vișinie"). */
  materialInvelitoare: string | null;
  /** Segmente ml pentru coame/dolii/muchii dacă apar cotate pe plan.
   *  Vândute separat la ml, nu la m². Poate fi listă goală. */
  coameDoliiSegmenteMl: number[];
  observatii: string;
}

export async function extractRoofCoveringFromTextWithAnthropic(
  text: string
): Promise<ExtractedRoofCoveringRaw> {
  const systemPrompt = `Ești expert în citirea planșelor de învelitoare / plan țiglă din România (planuri DTAC arhitectură).

CONTEXT: primești textul extras nativ din PDF (cu poziții x,y păstrate). Planul arată conturul acoperișului în proiecție orizontală + cotele de contur + unghiul de pantă tipărit + eventual materialul (țiglă).

CE SĂ EXTRAGI (BRUT, fără calcule):

1. **Titlul planșei** din cartuș — ex „PLAN ÎNVELITOARE", „PLAN ACOPERIȘ".

2. **Unghiul(le) de pantă** tipărit(e) pe planșă — ex „20°", „20,00°". Poate apărea o singură dată sau repetat la fiecare versant. Extrage TOATE valorile găsite ca listă — codul verifică uniformitatea.

3. **Cotele orizontale de contur** — pe X (orizontal) și pe Y (vertical), separat. Sunt lanțuri de cote adunate (ex „0,825+3,40+3,20+2,25+2,25+2,85+1,40+0,825" ← lanț pe X). Fiecare cotă = un segment. Convertește virgula în punct.

4. **Totalul tipărit al lanțului** (ex „17,00") — pentru validare. Dacă lipsește, returnează null.

5. **Denumire material** dacă apare pe planșă — ex „țiglă ceramică vișinie", „țiglă metalică Bramac". Null dacă nu apare.

6. **Coame/dolii cotate** — segmente ml separate pentru muchii înclinate. Listă de lungimi în ml (ex [3.03, 4.50]). Listă goală dacă nu sunt cotate.

REGULI STRICTE:
1. NU calcula. NU suma cotele tu. NU converti orizontală→înclinată. Toate acestea se fac în cod.
2. Extrage exact ce vezi tipărit. Dacă un total lipsește, null.
3. Cotele în METRI (converti dacă apar în cm).
4. Unghiuri în grade zecimale (converti dacă apar cu ',' — 20,00 → 20.00).`;

  const toolSchema = {
    name: "extract_roof_covering",
    description: "Structured extraction of roof covering plan (pitch angle + horizontal cotes + material)",
    input_schema: {
      type: "object",
      properties: {
        titluPlansa: { type: ["string", "null"] },
        unghiuriPantaGrade: { type: "array", items: { type: "number" } },
        coteOrizontalaX: { type: "array", items: { type: "number" } },
        totalOrizontalaXTiparit: { type: ["number", "null"] },
        coteOrizontalaY: { type: "array", items: { type: "number" } },
        totalOrizontalaYTiparit: { type: ["number", "null"] },
        materialInvelitoare: { type: ["string", "null"] },
        coameDoliiSegmenteMl: { type: "array", items: { type: "number" } },
        observatii: { type: "string" },
      },
      required: ["titluPlansa", "unghiuriPantaGrade", "coteOrizontalaX", "totalOrizontalaXTiparit", "coteOrizontalaY", "totalOrizontalaYTiparit", "materialInvelitoare", "coameDoliiSegmenteMl", "observatii"],
    },
  };

  return callAnthropicTextTool(
    systemPrompt,
    `Text brut extras din planul de învelitoare (poziții păstrate):\n\n${text.substring(0, 60000)}`,
    toolSchema,
    "extract_roof_covering",
    ANTHROPIC_MAX_TOKENS_CLASSIFY
  );
}

// ── Equivalent Finder (replacing ai-find-equivalent) ────────────────────────
export async function findEquivalentWithAnthropic(cerereClient: string) {
  if (cerereClient.trim().length < 3) throw new Error("Cererea este prea scurtă.");

  // Check cache locally
  const cerereLower = cerereClient.toLowerCase().trim();
  const { data: cachedRows } = await supabase
    .from("echivalente_produse")
    .select("product_id, scor_relevanta, nota_echivalenta, products(id, cod_intern, denumire_completa, pret_lista, unit)")
    .ilike("cerere_text", cerereLower)
    .order("scor_relevanta", { ascending: false })
    .limit(3);

  if (cachedRows && cachedRows.length > 0) {
    const echivalente = cachedRows
      .filter((r) => r.products)
      .map((r: any) => {
        const p = r.products;
        return {
          product_id: p.id,
          cod_intern: p.cod_intern,
          denumire_completa: p.denumire_completa,
          pret_lista: p.pret_lista,
          unit: p.unit,
          justificare: r.nota_echivalenta || "",
          scor: r.scor_relevanta,
        };
      });
    if (echivalente.length > 0) {
      return { success: true, from_cache: true, category: null, echivalente };
    }
  }

  // Fetch categories
  const { data: categories } = await supabase.from("categories").select("id, name, parent_id");
  if (!categories) throw new Error("Eroare la obținerea categoriilor.");

  const catMap = new Map(categories.map((c) => [c.id, c]));
  function getCategoryPath(id: string): string {
    const cat = catMap.get(id);
    if (!cat) return "Necunoscut";
    if (!cat.parent_id) return cat.name;
    return `${getCategoryPath(cat.parent_id)} > ${cat.name}`;
  }

  const categoryList = categories.map((c) => ({ id: c.id, path: getCategoryPath(c.id) }));
  const categoryText = categoryList.map((c, i) => `${i + 1}. [${c.id}] ${c.path}`).join("\n");

  // Step 1: Classify
  const classSchema = {
    name: "classify_category",
    description: "Clasifică cererea în categoria potrivită",
    input_schema: {
      type: "object",
      properties: {
        category_id: { type: "string" },
        category_path: { type: "string" },
        confidence: { type: "number" },
        reasoning: { type: "string" },
      },
      required: ["category_id", "category_path", "confidence", "reasoning"],
    }
  };

  const classification = await callAnthropicTool(
    "Ești expert în materiale de construcții din România. Clasifică produsul cerut în categoria cea mai specifică din catalog.",
    `Cerere client: "${cerereClient}"\n\nCategorii disponibile:\n${categoryText}\n\nIdentifică categoria cea mai potrivită. Dacă nu ești sigur, alege o categorie părinte.`,
    classSchema,
    "classify_category"
  );

  // Get descendants
  const children = new Map<string, string[]>();
  categories.forEach((c) => {
    if (c.parent_id) {
      const arr = children.get(c.parent_id) || [];
      arr.push(c.id);
      children.set(c.parent_id, arr);
    }
  });
  const descendantIds: string[] = [classification.category_id];
  const queue = [classification.category_id];
  while (queue.length) {
    const id = queue.shift()!;
    const kids = children.get(id) || [];
    descendantIds.push(...kids);
    queue.push(...kids);
  }

  // Fetch products by category
  const { data: categoryProducts } = await supabase
    .from("products")
    .select("id, cod_intern, denumire_completa, pret_lista, unit, brand, specifications")
    .in("category_id", descendantIds)
    .limit(1000);

  // Fetch products by text search fallback
  const keywords = cerereLower.split(/[^a-z0-9ăâîșț]+/).filter(w => w.length > 2).slice(0, 5);
  let textQuery = supabase.from("products").select("id, cod_intern, denumire_completa, pret_lista, unit, brand, specifications");
  if (keywords.length > 0) {
    const ilikeConditions = keywords.map(kw => `denumire_completa.ilike.%${makeIlikePattern(kw)}%,brand.ilike.%${makeIlikePattern(kw)}%`).join(",");
    textQuery = textQuery.or(ilikeConditions);
  }
  const { data: textProducts } = await textQuery.limit(500);

  const mergedMap = new Map();
  [...(categoryProducts || []), ...(textProducts || [])].forEach(p => {
    mergedMap.set(p.id, p);
  });
  let products = Array.from(mergedMap.values());

  if (products.length === 0) {
    return { success: true, from_cache: false, category: classification, echivalente: [] };
  }

  // Pre-filter: rank by simple local text overlap to ensure the best items are sent to Anthropic
  if (products.length > 100) {
    const searchTokens = removeDiacritics(cerereLower).split(/[^a-z0-9]+/).filter(w => w.length > 2);
    products.forEach(p => {
      const pName = removeDiacritics((p.denumire_completa || "").toLowerCase());
      let score = 0;
      for (const t of searchTokens) {
        if (pName.includes(t)) score++;
      }
      (p as any)._matchScore = score;
    });
    products.sort((a, b) => ((b as any)._matchScore || 0) - ((a as any)._matchScore || 0));
    products = products.slice(0, 100);
  }

  const productListText = products
    .map((p) => {
      const specs = (p.specifications as any) || {};
      const ft = specs.fisa_tehnica_specs || {};
      const ai = specs.ai_info || {};

      const parts = [
        `Cod: ${p.cod_intern}`,
        `Denumire: ${p.denumire_completa}`,
        `Brand: ${p.brand || "-"}`,
        `Pret: ${p.pret_lista} ${p.unit || "buc"}`
      ];

      const tech: string[] = [];
      if (ft.conductivitate_termica) tech.push(`Conductivitate: ${ft.conductivitate_termica}`);
      if (ft.densitate) tech.push(`Densitate: ${ft.densitate}`);
      if (ft.rezistenta_compresiune) tech.push(`Compresiune: ${ft.rezistenta_compresiune}`);
      if (ft.rezistenta_tractiune) tech.push(`Tractiune: ${ft.rezistenta_tractiune}`);
      if (ft.clasa_reactie_foc) tech.push(`Reactie foc: ${ft.clasa_reactie_foc}`);
      if (ai.consum && ai.consum !== "N/A") tech.push(`Consum: ${ai.consum}`);
      if (ai.compatibilitati && ai.compatibilitati !== "N/A") tech.push(`Compatibil: ${ai.compatibilitati}`);
      if (ai.utilizare && ai.utilizare !== "N/A") tech.push(`Utilizare: ${ai.utilizare}`);

      if (tech.length > 0) {
        parts.push(`Date tehnice: ${tech.join(", ")}`);
      }

      return parts.join(" | ");
    })
    .join("\n");

  // Step 2: Rank
  const rankSchema = {
    name: "rank_equivalents",
    description: "Clasifică cele mai bune 10 produse echivalente",
    input_schema: {
      type: "object",
      properties: {
        echivalente: {
          type: "array",
          items: {
            type: "object",
            properties: {
              cod_intern: { type: "string" },
              justificare: { type: "string" },
              scor: { type: "number" },
            },
            required: ["cod_intern", "justificare", "scor"],
          },
        },
      },
      required: ["echivalente"],
    }
  };

  const ranking = await callAnthropicTool(
    "Ești expert în materiale de construcții. Primești o cerere de produs și o listă de produse din catalog. Alege top 10 produse echivalente, ignorând brandul, concentrându-te pe specificații tehnice și utilizare. Scorul e de la 0 la 100.",
    `Cerere client: "${cerereClient}"\n\nProduse disponibile:\ncod_intern | denumire | brand | preț unitate\n${productListText}`,
    rankSchema,
    "rank_equivalents"
  );

  const productMap = new Map(products.map((p) => [p.cod_intern, p]));
  // Also build a lowercase-trimmed map for fuzzy fallback (Gemini sometimes returns slightly different casing/spacing)
  const productMapLower = new Map(
    products.map((p) => [(p.cod_intern || "").toLowerCase().trim(), p])
  );

  let applyMandatoryAttributePenaltyFn: any = null;
  try {
    const parser = await import("./floorPlanParser");
    applyMandatoryAttributePenaltyFn = parser.applyMandatoryAttributePenalty;
  } catch (_) {
    // Ignore import failure
  }

  const echivalente = (ranking.echivalente || [])
    .map((r: any) => {
      // 1. Exact match
      let p = productMap.get(r.cod_intern);
      // 2. Case-insensitive / trimmed fallback
      if (!p) {
        p = productMapLower.get((r.cod_intern || "").toLowerCase().trim());
      }
      // 3. Partial-match fallback: find the product whose cod_intern best overlaps
      if (!p) {
        const rCode = (r.cod_intern || "").toLowerCase().trim();
        p = products.find(
          (prod) =>
            (prod.cod_intern || "").toLowerCase().includes(rCode) ||
            rCode.includes((prod.cod_intern || "").toLowerCase())
        );
      }
      if (!p) return null;

      // Aplică penalizare scor dacă cererea conține atribute tehnice obligatorii
      // pe care produsul candidat nu le menționează explicit.
      let finalScor = r.scor;
      let penaltyReason: string | undefined;
      if (applyMandatoryAttributePenaltyFn) {
        try {
          const penalty = applyMandatoryAttributePenaltyFn(
            cerereClient,
            p.denumire_completa ?? "",
            r.scor
          );
          finalScor = penalty.score;
          penaltyReason = penalty.reason;
        } catch (_) {
          // Dacă apelul eșuează, continuăm cu scorul original
        }
      }

      return {
        product_id: p.id,
        cod_intern: p.cod_intern,
        denumire_completa: p.denumire_completa,
        pret_lista: p.pret_lista,
        unit: p.unit,
        justificare: penaltyReason
          ? `${r.justificare} ⚠️ ${penaltyReason}`
          : r.justificare,
        scor: finalScor,
        scorPenalized: finalScor < r.scor,
      };
    })
    .filter(Boolean);

  // Try caching
  if (echivalente.length > 0) {
    const { data: userData } = await supabase.auth.getUser();
    if (userData?.user) {
      const rowsToInsert = echivalente.map((e: any) => ({
        cerere_text: cerereLower,
        product_id: e.product_id,
        cod_intern: e.cod_intern,
        denumire_completa: e.denumire_completa,
        pret_lista: e.pret_lista,
        unit: e.unit,
        scor_relevanta: Math.min(100, Math.max(1, e.scor)),
        nota_echivalenta: e.justificare,
        category_id: classification.category_id,
        category_path: classification.category_path,
        creat_de: userData.user.id,
      }));
      await supabase.from("echivalente_produse").insert(rowsToInsert);
    }
  }

  return { success: true, from_cache: false, category: classification, echivalente };
}

// ── Technical Info Extractor (replacing ai-product-info) ────────────────────
export async function fetchTechInfoWithAnthropic(
  productIds: string[],
  clientRequest: string = "",
  onlyFromCache: boolean = false
): Promise<{ success: boolean; data: any; cached_ids: string[]; fresh_ids: string[] }> {
  if (!productIds.length) return { success: true, data: {}, cached_ids: [], fresh_ids: [] };

  const { data: products } = await supabase
    .from("products")
    .select("id, cod_intern, denumire_completa, unit, pret_lista, specifications, brand, category_id")
    .in("id", productIds);

  if (!products) throw new Error("Eroare la preluarea produselor.");

  const cached: any = {};
  const needsAi: any[] = [];
  const now = Date.now();
  const CACHE_TTL_DAYS = 30;

  for (const p of products) {
    const specs = (p.specifications as any) || {};
    
    // 1. Daca avem fisa_tehnica_specs (extrase din PDF), mapam instantaneu datele
    const ftSpecs = specs.fisa_tehnica_specs;
    if (ftSpecs) {
      let compat = "";
      if (Array.isArray(ftSpecs.compatibil_cu)) {
        compat = ftSpecs.compatibil_cu.join(", ");
      } else {
        compat = ftSpecs.compatibil_cu || "N/A";
      }

      let util = "";
      if (Array.isArray(ftSpecs.utilizare)) {
        util = ftSpecs.utilizare.join(", ");
      } else {
        util = ftSpecs.utilizare || "N/A";
      }

      const mappedAiInfo = {
        consum: ftSpecs.consum || "N/A",
        ambalaj: ftSpecs.ambalaj || "N/A",
        alternative: ftSpecs.alternative || [],
        compatibilitati: compat,
        utilizare: util,
        updated_at: ftSpecs._extracted_at || new Date().toISOString(),
        source: "fisa_tehnica_specs"
      };

      cached[p.id] = mappedAiInfo;

      // Actualizam baza de date in fundal daca ai_info nu exista sau e diferit
      const aiInfo = specs.ai_info;
      if (!aiInfo || aiInfo.source !== "fisa_tehnica_specs") {
        void supabase
          .from("products")
          .update({ specifications: { ...specs, ai_info: mappedAiInfo } })
          .eq("id", p.id);
      }
      continue;
    }

    // 2. Daca avem deja ai_info generat in cache-ul de 30 de zile
    const aiInfo = specs.ai_info;
    if (aiInfo?.updated_at) {
      const age = now - new Date(aiInfo.updated_at).getTime();
      if (age < CACHE_TTL_DAYS * 24 * 60 * 60 * 1000) {
        cached[p.id] = aiInfo;
        continue;
      }
    }
    needsAi.push(p);
  }

  const aiResults: any = {};

  if (needsAi.length > 0 && !onlyFromCache) {
    const productList = needsAi.map((p, i) =>
      `${i + 1}. [${p.cod_intern}] ${p.denumire_completa} (brand: ${p.brand || "necunoscut"}, UM: ${p.unit || "buc"}, preț: ${p.pret_lista} lei)`
    ).join("\n");

    const techSchema = {
      name: "product_tech_info",
      description: "Return technical info for each product",
      input_schema: {
        type: "object",
        properties: {
          products: {
            type: "array",
            items: {
              type: "object",
              properties: {
                cod_intern: { type: "string" },
                consum: { type: "string", description: "Consumption per sqm or unit" },
                ambalaj: { type: "string", description: "Packaging type and weight" },
                alternative: { type: "array", items: { type: "string" }, description: "Up to 3 equivalent alternative products" },
                compatibilitati: { type: "string" },
                utilizare: { type: "string" },
              },
              required: ["cod_intern", "consum", "ambalaj", "alternative", "compatibilitati", "utilizare"],
            },
          },
        },
        required: ["products"],
      }
    };

    const parsed = await callAnthropicTool(
      `Ești expert în materiale de construcții din România (Baumit, Weber, Ceresit, Knauf, Leier, Bramac, etc.).
Răspunde DOAR cu informații pe care le cunoști cu certitudine. Dacă nu ești sigur, spune "necunoscut". Toate prețurile sunt FĂRĂ TVA.`,
      `Pentru următoarele produse, furnizează date tehnice:
${productList}
${clientRequest ? `Context cerere client: "${clientRequest}"` : ""}
Pentru FIECARE produs returnează:
- consum: consum estimat per mp sau per unitate (ex: "4-6 kg/mp") sau "N/A"
- ambalaj: tip și greutate ambalaj (ex: "sac 25 kg")
- alternative: lista de maxim 3 produse alternative echivalente (brand + denumire)
- compatibilitati: cu ce materiale/suporturi e compatibil
- utilizare: interior/exterior/ambele + aplicații specifice`,
      techSchema,
      "product_tech_info"
    );

    for (const aiProd of (parsed.products || [])) {
      const matchingProduct = needsAi.find((p) => p.cod_intern === aiProd.cod_intern);
      if (!matchingProduct) continue;

      const aiInfo = {
        consum: aiProd.consum || "N/A",
        ambalaj: aiProd.ambalaj || "N/A",
        alternative: aiProd.alternative || [],
        compatibilitati: aiProd.compatibilitati || "",
        utilizare: aiProd.utilizare || "",
        updated_at: new Date().toISOString(),
      };

      aiResults[matchingProduct.id] = aiInfo;

      // Try caching to DB
      const existingSpecs = matchingProduct.specifications || {};
      await supabase.from("products").update({ specifications: { ...existingSpecs, ai_info: aiInfo } }).eq("id", matchingProduct.id);
    }
  }

  const allData = { ...cached, ...aiResults };
  return {
    success: true,
    data: allData,
    cached_ids: Object.keys(cached),
    fresh_ids: Object.keys(aiResults),
  };
}

export interface StructuredPackagingInfo {
  brand: string;
  grosime_mm: number;
  lungime_mm: number;
  latime_mm: number;
  placi_bax: number;
  acoperire_bax_mp: number;
  baxuri_palet: number;
  acoperire_palet_mp: number;
  greutate_bax_kg: number;
  utilizare_recomandata: string;
}

export async function enrichProductPackagingWithAI(
  productId: string,
  denumireCompleta: string
): Promise<StructuredPackagingInfo | null> {
  // Query product to see if it already has this in specifications.packaging_details
  const { data: product } = await supabase
    .from("products")
    .select("specifications")
    .eq("id", productId)
    .single();

  if (product) {
    const specs = (product.specifications as any) || {};
    if (specs.packaging_details) {
      return specs.packaging_details as StructuredPackagingInfo;
    }
  }

  const systemPrompt = `Ești expert în ambalaje și specificații logistice pentru materiale de construcții din România (producători ca Rockwool, Fibran/FIBRANgeo, Knauf Insulation, Isover, Ursa etc.).
Analizează denumirea produsului și extrage sau estimează prin cunoștințele tale tehnice detaliate specificațiile exacte de ambalare.
Returnează DOAR date structurate și valide conform standardelor reale ale producătorilor.
Dacă produsul este vată minerală/bazaltică, lungimea standard este de obicei 1000 sau 1200 mm, lățimea 600 mm.
Grosimea poate fi 50mm, 100mm, 150mm, 200mm.
De exemplu:
- FIBRANgeo BP-70 de 10 cm are 4 plăci/bax de 1200x600mm = 2.88 mp. Un palet are 32 baxuri = 92.16 mp.
- Rockwool Frontrock Max E 100mm are 3 plăci/bax de 1000x600mm = 1.80 mp. Un palet are 28 baxuri = 50.40 mp.
Dacă nu poți aproxima, folosește valori standard de piață rezonabile.`;

  const toolSchema = {
    name: "extract_packaging_info",
    description: "Extract structured packaging and pallet specifications for a product",
    input_schema: {
      type: "object",
      properties: {
        brand: { type: "string", description: "Producătorul (ex: Rockwool, Fibran, Knauf Insulation)" },
        grosime_mm: { type: "number", description: "Grosimea în mm (ex: 100)" },
        lungime_mm: { type: "number", description: "Lungimea plăcii/rolei în mm (ex: 1200)" },
        latime_mm: { type: "number", description: "Lățimea plăcii/rolei în mm (ex: 600)" },
        placi_bax: { type: "number", description: "Numărul de plăci într-un bax/pachet" },
        acoperire_bax_mp: { type: "number", description: "Suprafața acoperită de un bax/pachet în metri pătrați (mp)" },
        baxuri_palet: { type: "number", description: "Numărul de baxuri/pachete pe un palet complet" },
        acoperire_palet_mp: { type: "number", description: "Suprafața totală a unui palet complet în metri pătrați (mp)" },
        greutate_bax_kg: { type: "number", description: "Greutatea aproximativă a unui bax în kg" },
        utilizare_recomandata: { type: "string", description: "Aplicație recomandată: 'fatada exterior' sau 'interior mansarda pereți'" }
      },
      required: [
        "brand", "grosime_mm", "lungime_mm", "latime_mm", "placi_bax",
        "acoperire_bax_mp", "baxuri_palet", "acoperire_palet_mp", "greutate_bax_kg", "utilizare_recomandata"
      ]
    }
  };

  try {
    const result = await callAnthropicTool(
      systemPrompt,
      `Te rog să extragi datele logistice de ambalare pentru produsul: "${denumireCompleta}"`,
      toolSchema,
      "extract_packaging_info"
    );

    if (result) {
      // Normalize numeric fields — Gemini can return numbers as strings
      const normalized: StructuredPackagingInfo = {
        brand:               String(result.brand || ""),
        grosime_mm:          Number(result.grosime_mm)         || 100,
        lungime_mm:          Number(result.lungime_mm)         || 1200,
        latime_mm:           Number(result.latime_mm)          || 600,
        placi_bax:           Number(result.placi_bax)          || 4,
        acoperire_bax_mp:    Number(result.acoperire_bax_mp)   || 2.88,
        baxuri_palet:        Number(result.baxuri_palet)        || 32,
        acoperire_palet_mp:  Number(result.acoperire_palet_mp) || 92.16,
        greutate_bax_kg:     Number(result.greutate_bax_kg)    || 24,
        utilizare_recomandata: String(result.utilizare_recomandata || ""),
      };

      // Save it back to products table
      const { data: currentProduct } = await supabase
        .from("products")
        .select("specifications")
        .eq("id", productId)
        .single();
      const existingSpecs = (currentProduct?.specifications as any) || {};
      await supabase
        .from("products")
        .update({
          specifications: {
            ...existingSpecs,
            packaging_details: normalized
          },
          packaging: `Bax ${normalized.acoperire_bax_mp} mp (${normalized.placi_bax} placi)`,
          pack_quantity: String(normalized.acoperire_bax_mp)
        })
        .eq("id", productId);

      return normalized;
    }
  } catch (error) {
    console.error("Error enriching packaging info:", error);
  }

  return null;
}

export async function parseClientRequestWithAI(rawText: string): Promise<{ material: string; quantity: string }[]> {
  if (rawText.trim().length < 3) throw new Error("Textul cererii este prea scurt.");

  const parserSchema = {
    name: "parse_quote_request",
    description: "Analizează cererea brută a unui client de materiale și extrage materialele și cantitățile solicitate.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              material: { 
                type: "string", 
                description: "Numele simplificat în limba română al materialului solicitat (ex: vata minerala, adeziv glet, dibluri, plasa)" 
              },
              quantity: { 
                type: "string", 
                description: "Cantitatea solicitată cu tot cu unitate (ex: 400 mp, 15 saci, 10 bucati, auto)" 
              }
            },
            required: ["material", "quantity"]
          }
        }
      },
      required: ["items"]
    }
  };

  const response = await callGeminiTool(
    "Ești un asistent AI expert în materiale de construcții din România. Rolul tău este să analizezi un mesaj brut trimis de un client (e-mail, WhatsApp sau notă de pe șantier) și să extragi o listă curată de materiale de construcție și cantitățile menționate. Dacă pentru un material nu se specifică o cantitate clară, folosește valoarea 'auto'.",
    `Cererea brută a clientului:\n"""\n${rawText}\n"""\n\nExtrage materialele solicitate sub formă de listă JSON.`,
    parserSchema
  );

  return response.items || [];
}

