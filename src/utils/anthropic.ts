import { supabase } from "@/integrations/supabase/client";

// Re-use same Anthropic API key logic
let cachedApiKey: string | null = null;
export async function getApiKey(): Promise<string> {
  if (cachedApiKey) return cachedApiKey;
  const { data, error } = await supabase.from("app_config").select("value").eq("key", "anthropic_api_key").single();
  if (error || !data?.value) throw new Error("Cheia API Anthropic nu a fost găsită în configurație.");
  cachedApiKey = data.value.trim();
  return cachedApiKey;
}

// ── Generic Tool Caller for Anthropic ───────────────────────────────────────
async function callAnthropicTool(
  systemPrompt: string,
  userPrompt: string,
  toolSchema: any,
  toolName: string
): Promise<any> {
  const apiKey = await getApiKey();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6", // Folosim versiunea stabilă
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      tools: [toolSchema],
      tool_choice: { type: "tool", name: toolName }
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Anthropic API Error:", response.status, errText);
    throw new Error(`Eroare API Anthropic (${response.status})`);
  }

  const data = await response.json();
  const toolCall = data.content?.find((c: any) => c.type === "tool_use" && c.name === toolName);
  
  if (!toolCall?.input) {
    throw new Error("Modelul nu a returnat date structurate valabile.");
  }

  return toolCall.input;
}

// ── Vision Table Extractor (replacing ocr-whatsapp) ─────────────────────────
export async function extractTableFromImageWithAnthropic(
  imageBase64: string,
  mimeType: string,
  contextType: "price_list" | "antemasuratoare" = "price_list"
): Promise<{ headers: string[]; rows: string[][] }> {
  const apiKey = await getApiKey();
  
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

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
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
    }),
  });

  if (!response.ok) throw new Error(`Eroare API Anthropic (${response.status})`);
  
  const data = await response.json();
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
}

// ── Text Table Extractor (for PDFs and manual paste) ─────────────────────────
export async function extractAntemasuratoareFromTextWithAnthropic(
  text: string
): Promise<{ headers: string[]; rows: string[][] }> {
  const apiKey = await getApiKey();
  
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

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: `Text brut extras din antemăsurătoare:\n\n${text.substring(0, 50000)}` }],
      tools: [toolSchema],
      tool_choice: { type: "tool", name: "extract_price_table" }
    }),
  });

  if (!response.ok) throw new Error(`Eroare API Anthropic (${response.status})`);
  const data = await response.json();
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
    const ilikeConditions = keywords.map(kw => `denumire_completa.ilike.%${kw}%`).join(",");
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
    const searchTokens = cerereLower.split(/[^a-z0-9ăâîșț]+/).filter(w => w.length > 2);
    products.forEach(p => {
      const pName = (p.denumire_completa || "").toLowerCase();
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
  const echivalente = (ranking.echivalente || [])
    .map((r: any) => {
      const p = productMap.get(r.cod_intern);
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
