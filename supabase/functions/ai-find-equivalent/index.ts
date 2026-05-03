import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
    const cerereClient: string = (body.cerere_client || "").trim();
    if (cerereClient.length < 3) {
      return new Response(JSON.stringify({ error: "cerere_client must be at least 3 characters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Check cache — same cerere text saved previously by AI
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

    // 2. Fetch all categories
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

    const categoryList = categories.map((c) => ({
      id: c.id,
      path: getCategoryPath(c.id),
    }));

    // 3. Phase 1 — AI classifies into a category
    const classifyResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: "Ești expert în materiale de construcții din România. Clasifică produsul cerut în categoria cea mai specifică din catalog.",
          },
          {
            role: "user",
            content: `Cerere client: "${cerereClient}"\n\nCategorii disponibile:\n${categoryList.map((c, i) => `${i + 1}. [${c.id}] ${c.path}`).join("\n")}\n\nIdentifică categoria cea mai potrivită. Dacă nu ești sigur de subcategorie, alege categoria părinte mai generală.`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "classify_category",
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
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "classify_category" } },
      }),
    });

    if (!classifyResp.ok) {
      const status = classifyResp.status;
      if (status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds at Settings > Workspace > Usage" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error("AI classification request failed");
    }

    const classifyData = await classifyResp.json();
    const classifyTool = classifyData.choices?.[0]?.message?.tool_calls?.[0];
    let classification: { category_id: string; category_path: string; confidence: number; reasoning: string } | null = null;
    try {
      classification = JSON.parse(classifyTool?.function?.arguments || "null");
    } catch {
      classification = null;
    }

    if (!classification?.category_id || !catMap.has(classification.category_id)) {
      return new Response(
        JSON.stringify({ success: false, error: "Nu am putut identifica categoria produsului cerut", category: null, echivalente: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Collect all descendant category IDs
    function getDescendantIds(rootId: string): string[] {
      const ids = [rootId];
      for (const cat of categories) {
        if (cat.parent_id === rootId) ids.push(...getDescendantIds(cat.id));
      }
      return ids;
    }
    const categoryIds = getDescendantIds(classification.category_id);

    // 5. Fetch products in those categories
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

    // 6. Phase 2 — AI ranks products by equivalence
    const productList = products
      .map((p, i) => `${i + 1}. [${p.cod_intern}] ${p.denumire_completa} (${p.brand || "-"}, ${p.pret_lista} lei/${p.unit || "buc"})`)
      .join("\n");

    const rankResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: "Ești expert în materiale de construcții din România. Selectezi cele mai bune echivalente din catalog pentru cererea unui client.",
          },
          {
            role: "user",
            content: `Clientul a cerut: "${cerereClient}"\n\nCategorie identificată: "${classification.category_path}"\n\nProduse disponibile în catalog MaxBau:\n${productList}\n\nIdentifică TOP 3 produse echivalente sau substituibile pentru cererea clientului. Ignoră brandul cerut și concentrează-te pe caracteristicile tehnice și aplicația produsului. Dacă mai puțin de 3 produse sunt potrivite, returnează doar cele relevante.`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "rank_equivalents",
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
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "rank_equivalents" } },
      }),
    });

    if (!rankResp.ok) {
      const status = rankResp.status;
      if (status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds at Settings > Workspace > Usage" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error("AI ranking request failed");
    }

    const rankData = await rankResp.json();
    const rankTool = rankData.choices?.[0]?.message?.tool_calls?.[0];
    let ranking: { echivalente: { cod_intern: string; justificare: string; scor: number }[] } = { echivalente: [] };
    try {
      ranking = JSON.parse(rankTool?.function?.arguments || "{}");
    } catch {
      ranking = { echivalente: [] };
    }

    // Map cod_intern back to full product data
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

    // 7. Cache top results in echivalente_produse
    for (const equiv of echivalente) {
      await supabaseAdmin.from("echivalente_produse").insert({
        cerere_text: cerareLower,
        product_id: equiv.product_id,
        scor_relevanta: Math.min(100, Math.max(1, equiv.scor)),
        nota_echivalenta: equiv.justificare,
        creat_de: user.id,
      }).then(() => {/* ignore duplicate errors */});
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
  } catch (e) {
    console.error("ai-find-equivalent error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
