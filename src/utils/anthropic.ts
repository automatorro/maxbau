import { supabase } from "@/integrations/supabase/client";
import { callAiProxy } from "@/utils/aiProxy";

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
      model: "claude-3-5-sonnet-20241022",
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
): Promise<{ headers: string[]; rows: string[][] }> {
  
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
        note: { type: "string", description: "Optional: observation about image quality" },
      },
      required: ["headers", "rows"]
    }
  };

  try {
    const { ok, status, data } = await callAiProxy("anthropic", {
      model: "claude-3-5-sonnet-20241022",
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

    return { headers: extracted.headers, rows: normalizedRows };
  } catch (error) {
    console.warn("Vision Anthropic call failed, trying Gemini fallback...", error);
    try {
      const extracted = await callGeminiTool(
        systemPrompt,
        "Extrage tabelul complet din această imagine. Include rândul de antet și toate rândurile de date.",
        toolSchema,
        { mimeType, base64: imageBase64 }
      );
      const colCount = (extracted.headers || []).length;
      const normalizedRows = (extracted.rows || []).map((row: string[]) => {
        const padded = [...row];
        while (padded.length < colCount) padded.push("");
        return padded.slice(0, colCount);
      });
      return { headers: extracted.headers, rows: normalizedRows };
    } catch (geminiError: any) {
      console.error("Gemini Vision fallback also failed:", geminiError);
      throw new Error(`Eroare extragere imagine (Vision). Anthropic: ${error instanceof Error ? error.message : error}. Gemini: ${geminiError?.message || geminiError}`);
    }
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
      model: "claude-3-5-sonnet-20241022",
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
    .select("id, cod_intern, denumire_completa, pret_lista, unit, brand")
    .in("category_id", descendantIds)
    .limit(1000);

  // Fetch products by text search fallback
  const keywords = cerereLower.split(/[^a-z0-9ăâîșț]+/).filter(w => w.length > 2).slice(0, 5);
  let textQuery = supabase.from("products").select("id, cod_intern, denumire_completa, pret_lista, unit, brand");
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
    .map((p) => `${p.cod_intern} | ${p.denumire_completa} | ${p.brand || "-"} | ${p.pret_lista} ${p.unit}`)
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
      return {
        product_id: p.id,
        cod_intern: p.cod_intern,
        denumire_completa: p.denumire_completa,
        pret_lista: p.pret_lista,
        unit: p.unit,
        justificare: r.justificare,
        scor: r.scor,
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
  clientRequest: string = ""
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

  if (needsAi.length > 0) {
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

