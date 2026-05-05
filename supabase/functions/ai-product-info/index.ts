import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CACHE_TTL_DAYS = 30;

async function callAI(
  apiKey: string,
  messages: { role: string; content: string }[],
  toolName: string,
  toolSchema: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages,
      tools: [{ type: "function", function: { name: toolName, ...toolSchema } }],
      tool_choice: { type: "function", function: { name: toolName } },
    }),
  });

  if (!resp.ok) {
    const status = resp.status;
    if (status === 429) throw Object.assign(new Error("Rate limit exceeded, please try again later"), { status: 429 });
    if (status === 402) throw Object.assign(new Error("AI credits exhausted. Add funds at Settings > Workspace > Usage"), { status: 402 });
    const errText = await resp.text();
    console.error("AI gateway error:", status, errText);
    throw new Error("AI gateway error");
  }

  const data = await resp.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) return null;
  try {
    return JSON.parse(toolCall.function.arguments);
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const action: string = body.action || "tech-info";

    // ── Action: ocr-image (& legacy ocr-whatsapp) ──────────────────────────
    if (action === "ocr-image" || action === "ocr-whatsapp") {
      const imageBase64: string = body.image_base64 || "";
      const mimeType: string = body.mime_type || "image/jpeg";

      if (!imageBase64) {
        return new Response(JSON.stringify({ error: "image_base64 is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const dataUrl = `data:${mimeType};base64,${imageBase64}`;

      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `Ești expert în extragerea tabelelor din liste de prețuri pentru materiale de construcții din România (Baumit, Weber, Ceresit, Knauf, Mapei, Leier, Bramac etc.), trimise pe WhatsApp de furnizori.
Extrage TOATE rândurile din tabel, inclusiv rândul de antet (header).
Reguli stricte:
- Păstrează denumirile produselor exact cum apar în imagine
- Prețurile sunt valori numerice pure, fără simbol de monedă (ex: 47.50 nu "47,50 lei")
- UM = unitate de măsură: sac, kg, m2, ml, buc, l, t, set etc.
- Ignoră logo-uri, anteturi de companie, numere de pagină, ștampile
- Toate rândurile returnate trebuie să aibă același număr de celule ca header-ul
- Celulele goale se returnează ca string gol ""`,
            },
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: dataUrl } },
                { type: "text", text: "Extrage tabelul complet din această imagine de listă prețuri. Include rândul de antet și toate rândurile de date." },
              ],
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "extract_price_table",
                description: "Structured extraction of a price list table",
                parameters: {
                  type: "object",
                  properties: {
                    headers: { type: "array", items: { type: "string" }, description: "Column names from the header row, in Romanian if possible" },
                    rows: {
                      type: "array",
                      items: { type: "array", items: { type: "string" } },
                      description: "All data rows (excluding header). Each inner array has same length as headers.",
                    },
                    note: { type: "string", description: "Optional: observation about image quality or ambiguous content" },
                  },
                  required: ["headers", "rows"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "extract_price_table" } },
        }),
      });

      if (!resp.ok) {
        const status = resp.status;
        if (status === 429) throw Object.assign(new Error("Rate limit depășit, încearcă mai târziu"), { status: 429 });
        if (status === 402) throw Object.assign(new Error("Credit AI epuizat"), { status: 402 });
        const errText = await resp.text();
        console.error("ocr-image AI error:", status, errText);
        throw new Error(`AI gateway error: ${status}`);
      }

      const aiData = await resp.json();
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall?.function?.arguments) {
        return new Response(JSON.stringify({ error: "Modelul nu a returnat date structurate" }), {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let extracted: { headers: string[]; rows: string[][]; note?: string };
      try {
        extracted = JSON.parse(toolCall.function.arguments);
      } catch {
        return new Response(JSON.stringify({ error: "Răspuns invalid de la model" }), {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const colCount = extracted.headers.length;
      const normalizedRows = (extracted.rows || []).map((row) => {
        const padded = [...row];
        while (padded.length < colCount) padded.push("");
        return padded.slice(0, colCount);
      });

      return new Response(
        JSON.stringify({ success: true, headers: extracted.headers, rows: normalizedRows, note: extracted.note || null }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Action: ocr-excel ─────────────────────────────────────────────────────
    if (action === "ocr-excel") {
      const rawRows: string[][] = body.rows || [];
      const filename: string = body.filename || "unknown.xlsx";
      const supplierProfile: Record<string, string> | null = body.supplier_column_map || null;

      if (!Array.isArray(rawRows) || rawRows.length === 0) {
        return new Response(JSON.stringify({ error: "rows array is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const truncated = rawRows.slice(0, 300);

      let supplierHint = "";
      if (supplierProfile && Object.keys(supplierProfile).length > 0) {
        supplierHint = `\n\nProfil furnizor cunoscut (mapping coloane din importuri anterioare): ${JSON.stringify(supplierProfile)}. Folosește acest profil ca referință pentru a identifica coloanele, dar verifică dacă se potrivește cu datele actuale.`;
      }

      const result = await callAI(
        LOVABLE_API_KEY,
        [
          {
            role: "system",
            content: `Ești expert în structurarea datelor din fișiere Excel de liste de prețuri pentru materiale de construcții din România.
Primești o matrice 2D de strings extrasă dintr-un fișier Excel.
Sarcina ta: identifică rândul de antet corect (poate să nu fie primul rând), curăță rândurile goale sau de separare, normalizează prețurile (format european: virgulă ca separator zecimal → punct), returnează datele curate.
IMPORTANT: Identifică și returnează un column_map care specifică ce coloană corespunde fiecărui tip de informație (denumire, preț, um, cod_furnizor, cantitate_palet, consum, etc.).
Dacă tabelul conține rânduri de categorie/grupă (bold, fără preț, text mai mare), marchează-le în câmpul category_rows.`,
          },
          {
            role: "user",
            content: `Fișier: ${filename}\nDate brute (primele ${truncated.length} rânduri):\n${JSON.stringify(truncated)}\n\nIdentifică structura, curăță și returnează tabelul normalizat cu headers, rows, column_map și category_rows.${supplierHint}`,
          },
        ],
        "extract_price_table",
        {
          description: "Structured extraction of a price list table from Excel data with column mapping",
          parameters: {
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
                  cod_furnizor: { type: "number", description: "Index of the supplier product code column, or -1 if not present" },
                  cantitate_palet: { type: "number", description: "Index of pallet quantity column, or -1 if not present" },
                  consum: { type: "number", description: "Index of consumption column, or -1 if not present" },
                },
                description: "Mapping of semantic columns to their 0-based index in headers. Use -1 if column not found.",
              },
              category_rows: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    row_index: { type: "number", description: "0-based index in the rows array" },
                    category_name: { type: "string", description: "Category/group name extracted" },
                  },
                },
                description: "Rows that represent category/group headers, not actual products",
              },
              note: { type: "string", description: "Optional: observation about data quality" },
            },
            required: ["headers", "rows", "column_map"],
            additionalProperties: false,
          },
        }
      );

      if (!result || !result.headers) {
        return new Response(JSON.stringify({ error: "Modelul nu a returnat date structurate" }), {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const headers = result.headers as string[];
      const colCount = headers.length;
      const normalizedRows = ((result.rows as string[][]) || []).map((row) => {
        const padded = [...row];
        while (padded.length < colCount) padded.push("");
        return padded.slice(0, colCount);
      });

      return new Response(
        JSON.stringify({
          success: true,
          headers,
          rows: normalizedRows,
          column_map: result.column_map || null,
          category_rows: result.category_rows || [],
          note: (result.note as string) || null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Action: find-equivalent ───────────────────────────────────────────────
    if (action === "find-equivalent") {
      const cerereClient: string = (body.cerere_client || "").trim();
      if (cerereClient.length < 3) {
        return new Response(JSON.stringify({ error: "cerere_client must be at least 3 characters" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check cache in echivalente_produse
      const cerareLower = cerereClient.toLowerCase();
      const { data: cachedRows } = await supabaseAdmin
        .from("echivalente_produse")
        .select("product_id, scor_relevanta, nota_echivalenta, products(id, cod_intern, denumire_completa, pret_lista, unit)")
        .ilike("cerere_text", cerareLower)
        .order("scor_relevanta", { ascending: false })
        .limit(3);

      if (cachedRows && cachedRows.length > 0) {
        const echivalente = cachedRows
          .filter((r) => r.products)
          .map((r) => {
            const p = r.products as { id: string; cod_intern: string; denumire_completa: string; pret_lista: number; unit: string };
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
          return new Response(JSON.stringify({ success: true, from_cache: true, category: null, echivalente }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // Fetch all categories
      const { data: categories, error: catErr } = await supabaseAdmin
        .from("categories")
        .select("id, name, parent_id");
      if (catErr || !categories) throw new Error("Failed to fetch categories");

      const catMap = new Map(categories.map((c) => [c.id, c]));

      function getCategoryPath(id: string): string {
        const cat = catMap.get(id);
        if (!cat) return "Necunoscut";
        if (!cat.parent_id) return cat.name;
        return `${getCategoryPath(cat.parent_id)} > ${cat.name}`;
      }

      const categoryList = categories.map((c) => ({ id: c.id, path: getCategoryPath(c.id) }));

      // Phase 1 — classify category
      let classification: { category_id: string; category_path: string; confidence: number; reasoning: string } | null = null;
      try {
        const result = await callAI(
          LOVABLE_API_KEY,
          [
            {
              role: "system",
              content: "Ești expert în materiale de construcții din România. Clasifică produsul cerut în categoria cea mai specifică din catalog.",
            },
            {
              role: "user",
              content: `Cerere client: "${cerereClient}"\n\nCategorii disponibile:\n${categoryList.map((c, i) => `${i + 1}. [${c.id}] ${c.path}`).join("\n")}\n\nIdentifică categoria cea mai potrivită. Dacă nu ești sigur de subcategorie, alege categoria părintе mai generală.`,
            },
          ],
          "classify_category",
          {
            description: "Identify the product category",
            parameters: {
              type: "object",
              properties: {
                category_id: { type: "string", description: "UUID of the best matching category" },
                category_path: { type: "string", description: "Full path of the selected category" },
                confidence: { type: "number", description: "Confidence score 0-1" },
                reasoning: { type: "string", description: "Short explanation in Romanian" },
              },
              required: ["category_id", "category_path", "confidence", "reasoning"],
              additionalProperties: false,
            },
          }
        );
        if (result?.category_id && catMap.has(result.category_id as string)) {
          classification = result as typeof classification;
        }
      } catch (e: unknown) {
        const err = e as { status?: number; message?: string };
        if (err.status === 429 || err.status === 402) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: err.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw e;
      }

      if (!classification) {
        return new Response(
          JSON.stringify({ success: false, error: "Nu am putut identifica categoria produsului cerut", category: null, echivalente: [] }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Collect descendant category IDs
      function getDescendantIds(rootId: string): string[] {
        const ids = [rootId];
        for (const cat of categories) {
          if (cat.parent_id === rootId) ids.push(...getDescendantIds(cat.id));
        }
        return ids;
      }
      const categoryIds = getDescendantIds(classification.category_id);

      // Fetch products in those categories
      const { data: products, error: prodErr } = await supabaseAdmin
        .from("products")
        .select("id, cod_intern, denumire_completa, pret_lista, unit, brand")
        .in("category_id", categoryIds)
        .limit(60);

      if (prodErr) throw new Error("Failed to fetch products");

      if (!products || products.length === 0) {
        return new Response(
          JSON.stringify({
            success: true,
            category: { id: classification.category_id, path: classification.category_path, confidence: classification.confidence, reasoning: classification.reasoning },
            echivalente: [],
            message: "Categoria a fost identificată dar nu există produse în catalog pentru această categorie",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Phase 2 — rank equivalents
      const productList = products
        .map((p, i) => `${i + 1}. [${p.cod_intern}] ${p.denumire_completa} (${p.brand || "-"}, ${p.pret_lista} lei/${p.unit || "buc"})`)
        .join("\n");

      let ranking: { echivalente: { cod_intern: string; justificare: string; scor: number }[] } = { echivalente: [] };
      try {
        const result = await callAI(
          LOVABLE_API_KEY,
          [
            {
              role: "system",
              content: "Ești expert în materiale de construcții din România. Selectezi cele mai bune echivalente din catalog pentru cererea unui client.",
            },
            {
              role: "user",
              content: `Clientul a cerut: "${cerereClient}"\n\nCategorie identificată: "${classification.category_path}"\n\nProduse disponibile în catalog MaxBau:\n${productList}\n\nIdentifică TOP 3 produse echivalente sau substituibile pentru cererea clientului. Ignoră brandul cerut și concentrează-te pe caracteristicile tehnice și aplicația produsului. Dacă mai puțin de 3 produse sunt potrivite, returnează doar cele relevante.`,
            },
          ],
          "rank_equivalents",
          {
            description: "Return top equivalent products from the catalog",
            parameters: {
              type: "object",
              properties: {
                echivalente: {
                  type: "array",
                  maxItems: 3,
                  items: {
                    type: "object",
                    properties: {
                      cod_intern: { type: "string", description: "Product code from the list above" },
                      justificare: { type: "string", description: "1-2 sentences in Romanian explaining why this product is equivalent" },
                      scor: { type: "integer", description: "Relevance score 1-100" },
                    },
                    required: ["cod_intern", "justificare", "scor"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["echivalente"],
              additionalProperties: false,
            },
          }
        );
        if (result?.echivalente) ranking = result as typeof ranking;
      } catch (e: unknown) {
        const err = e as { status?: number; message?: string };
        if (err.status === 429 || err.status === 402) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: err.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw e;
      }

      const echivalente = (ranking.echivalente || [])
        .map((e) => {
          const product = products.find((p) => p.cod_intern === e.cod_intern);
          if (!product) return null;
          return {
            product_id: product.id,
            cod_intern: product.cod_intern,
            denumire_completa: product.denumire_completa,
            pret_lista: product.pret_lista,
            unit: product.unit,
            justificare: e.justificare,
            scor: e.scor,
          };
        })
        .filter(Boolean) as { product_id: string; cod_intern: string; denumire_completa: string; pret_lista: number; unit: string; justificare: string; scor: number }[];

      // Cache results in echivalente_produse
      for (const equiv of echivalente) {
        await supabaseAdmin.from("echivalente_produse").insert({
          cerere_text: cerareLower,
          product_id: equiv.product_id,
          scor_relevanta: Math.min(100, Math.max(1, equiv.scor)),
          nota_echivalenta: equiv.justificare,
          creat_de: user.id,
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          from_cache: false,
          category: {
            id: classification.category_id,
            path: classification.category_path,
            confidence: classification.confidence,
            reasoning: classification.reasoning,
          },
          echivalente,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Action: tech-info (default) ───────────────────────────────────────────
    const productIds: string[] = body.product_ids;
    const clientRequest: string = body.client_request || "";

    if (!Array.isArray(productIds) || productIds.length === 0 || productIds.length > 5) {
      return new Response(JSON.stringify({ error: "product_ids must be 1-5 items" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: products, error: pErr } = await supabaseAdmin
      .from("products")
      .select("id, cod_intern, denumire_completa, unit, pret_lista, specifications, brand, category_id")
      .in("id", productIds);

    if (pErr || !products) {
      return new Response(JSON.stringify({ error: "Failed to fetch products" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = Date.now();
    const cached: Record<string, unknown> = {};
    const needsAi: typeof products = [];

    for (const p of products) {
      const specs = (p.specifications as Record<string, unknown>) || {};
      const aiInfo = specs.ai_info as Record<string, unknown> | undefined;
      if (aiInfo?.updated_at) {
        const age = now - new Date(aiInfo.updated_at as string).getTime();
        if (age < CACHE_TTL_DAYS * 24 * 60 * 60 * 1000) {
          cached[p.id] = aiInfo;
          continue;
        }
      }
      needsAi.push(p);
    }

    let aiResults: Record<string, unknown> = {};

    if (needsAi.length > 0) {
      const productList = needsAi.map((p, i) =>
        `${i + 1}. [${p.cod_intern}] ${p.denumire_completa} (brand: ${p.brand || "necunoscut"}, UM: ${p.unit || "buc"}, preț: ${p.pret_lista} lei)`
      ).join("\n");

      const systemPrompt = `Ești expert în materiale de construcții din România (Baumit, Weber, Ceresit, Knauf, Leier, Bramac, etc.).
Răspunde DOAR cu informații pe care le cunoști cu certitudine. Dacă nu ești sigur, spune "necunoscut".
Toate prețurile sunt FĂRĂ TVA.`;

      const userPrompt = `Pentru următoarele produse, furnizează date tehnice:

${productList}

${clientRequest ? `Context cerere client: "${clientRequest}"` : ""}

Pentru FIECARE produs returnează:
- consum: consum estimat per mp sau per unitate (ex: "4-6 kg/mp", "1.5 buc/mp") sau "N/A" dacă nu se aplică
- ambalaj: tip și greutate ambalaj (ex: "sac 25 kg", "galeata 20 kg")
- alternative: lista de maxim 3 produse alternative echivalente (brand + denumire), doar produse reale
- compatibilitati: cu ce materiale/suporturi e compatibil
- utilizare: interior/exterior/ambele + aplicații specifice`;

      let parsed: { products?: { cod_intern: string; consum: string; ambalaj: string; alternative: string[]; compatibilitati: string; utilizare: string }[] } = { products: [] };
      try {
        const result = await callAI(
          LOVABLE_API_KEY,
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          "product_tech_info",
          {
            description: "Return technical info for each product",
            parameters: {
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
                    additionalProperties: false,
                  },
                },
              },
              required: ["products"],
              additionalProperties: false,
            },
          }
        );
        if (result) parsed = result as typeof parsed;
      } catch (e: unknown) {
        const err = e as { status?: number; message?: string };
        if (err.status === 429 || err.status === 402) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: err.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw e;
      }

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

        const existingSpecs = (matchingProduct.specifications as Record<string, unknown>) || {};
        await supabaseAdmin
          .from("products")
          .update({ specifications: { ...existingSpecs, ai_info: aiInfo } })
          .eq("id", matchingProduct.id);
      }
    }

    const allResults: Record<string, unknown> = { ...cached, ...aiResults };
    const cachedIds = Object.keys(cached);
    const freshIds = Object.keys(aiResults);

    return new Response(
      JSON.stringify({ success: true, data: allResults, cached_ids: cachedIds, fresh_ids: freshIds }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("ai-product-info error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
