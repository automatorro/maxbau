import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

interface Category {
  id: string;
  name: string;
  parent_id: string | null;
}

function buildCategoryPaths(cats: Category[]): Map<string, string> {
  const map = new Map<string, Category>();
  cats.forEach((c) => map.set(c.id, c));
  const paths = new Map<string, string>();
  for (const c of cats) {
    const parts: string[] = [];
    let cur: Category | undefined = c;
    while (cur) {
      parts.unshift(cur.name);
      cur = cur.parent_id ? map.get(cur.parent_id) : undefined;
    }
    paths.set(c.id, parts.join(" > "));
  }
  return paths;
}

function getDescendantIds(cats: Category[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  cats.forEach((c) => {
    if (c.parent_id) {
      const arr = children.get(c.parent_id) || [];
      arr.push(c.id);
      children.set(c.parent_id, arr);
    }
  });
  const result: string[] = [rootId];
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    const kids = children.get(id) || [];
    result.push(...kids);
    queue.push(...kids);
  }
  return result;
}

async function callAI(
  apiKey: string,
  messages: { role: string; content: string }[],
  tools: any[],
  toolChoice: any
) {
  const resp = await fetch(AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, messages, tools, tool_choice: toolChoice }),
  });

  if (!resp.ok) {
    if (resp.status === 429 || resp.status === 402) {
      return { error: resp.status, body: await resp.text() };
    }
    throw new Error(`AI gateway ${resp.status}: ${await resp.text()}`);
  }

  const data = await resp.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("No tool call in AI response");
  return { result: JSON.parse(toolCall.function.arguments) };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY") || "";

    // Validate JWT
    const supabaseAuth = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub;

    const { cerere_client } = await req.json();
    if (!cerere_client || typeof cerere_client !== "string" || cerere_client.trim().length < 3) {
      return new Response(JSON.stringify({ error: "cerere_client is required (min 3 chars)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const db = createClient(supabaseUrl, serviceKey);

    // Check cache
    const { data: cached } = await db
      .from("echivalente_produse")
      .select("*")
      .ilike("cerere_text", cerere_client.trim())
      .limit(10);

    if (cached && cached.length > 0) {
      return new Response(
        JSON.stringify({
          success: true,
          from_cache: true,
          category: {
            id: cached[0].category_id,
            path: cached[0].category_path,
            confidence: null,
            reasoning: "din cache",
          },
          echivalente: cached.map((r: any) => ({
            product_id: r.product_id,
            cod_intern: r.cod_intern,
            denumire_completa: r.denumire_completa,
            pret_lista: r.pret_lista,
            unit: r.unit,
            justificare: r.nota_echivalenta,
            scor: r.scor_relevanta,
          })),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 1: Fetch categories
    const { data: categories, error: catErr } = await db
      .from("categories")
      .select("id, name, parent_id");
    if (catErr || !categories?.length) {
      throw new Error("Failed to fetch categories");
    }

    const paths = buildCategoryPaths(categories);
    const categoryList = categories.map((c) => `${c.id} :: ${paths.get(c.id)}`).join("\n");

    const classifyResult = await callAI(
      apiKey,
      [
        {
          role: "system",
          content:
            "Ești expert în materiale de construcții. Primești o cerere de produs și o listă de categorii. Alege categoria cea mai potrivită.",
        },
        {
          role: "user",
          content: `Cerere client: "${cerere_client}"\n\nCategorii disponibile:\n${categoryList}`,
        },
      ],
      [
        {
          type: "function",
          function: {
            name: "classify_category",
            description: "Clasifică cererea în categoria potrivită",
            parameters: {
              type: "object",
              properties: {
                category_id: { type: "string" },
                category_path: { type: "string" },
                confidence: { type: "number" },
                reasoning: { type: "string" },
              },
              required: ["category_id", "category_path", "confidence", "reasoning"],
              additionalProperties: false,
            },
          },
        },
      ],
      { type: "function", function: { name: "classify_category" } }
    );

    if ("error" in classifyResult) {
      return new Response(
        JSON.stringify({
          error: classifyResult.error === 429 ? "Rate limit exceeded" : "Payment required",
        }),
        {
          status: classifyResult.error as number,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const classification = classifyResult.result;

    // Step 2: Get products in category tree
    const descendantIds = getDescendantIds(categories, classification.category_id);

    const { data: products, error: prodErr } = await db
      .from("products")
      .select("id, cod_intern, denumire_completa, pret_lista, unit, brand")
      .in("category_id", descendantIds)
      .limit(60);

    if (prodErr) throw new Error("Failed to fetch products");

    if (!products || products.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          from_cache: false,
          category: classification,
          echivalente: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const productList = products
      .map((p) => `${p.cod_intern} | ${p.denumire_completa} | ${p.brand || "-"} | ${p.pret_lista} ${p.unit}`)
      .join("\n");

    const rankResult = await callAI(
      apiKey,
      [
        {
          role: "system",
          content:
            "Ești expert în materiale de construcții. Primești o cerere de produs și o listă de produse din catalog. Alege top 10 produse echivalente, ignorând brandul, concentrându-te pe specificații tehnice și utilizare. Scorul e de la 0 la 100.",
        },
        {
          role: "user",
          content: `Cerere client: "${cerere_client}"\n\nProduse disponibile:\ncod_intern | denumire | brand | preț unitate\n${productList}`,
        },
      ],
      [
        {
          type: "function",
          function: {
            name: "rank_equivalents",
            description: "Clasifică cele mai bune 10 produse echivalente",
            parameters: {
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
      { type: "function", function: { name: "rank_equivalents" } }
    );

    if ("error" in rankResult) {
      return new Response(
        JSON.stringify({
          error: rankResult.error === 429 ? "Rate limit exceeded" : "Payment required",
        }),
        {
          status: rankResult.error as number,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const ranked = rankResult.result.echivalente || [];

    // Enrich with product details
    const productMap = new Map(products.map((p) => [p.cod_intern, p]));
    const echivalente = ranked
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

    // Cache results
    if (echivalente.length > 0) {
      const rows = echivalente.map((e: any) => ({
        cerere_text: cerere_client.trim(),
        product_id: e.product_id,
        cod_intern: e.cod_intern,
        denumire_completa: e.denumire_completa,
        pret_lista: e.pret_lista,
        unit: e.unit,
        scor_relevanta: e.scor,
        nota_echivalenta: e.justificare,
        category_id: classification.category_id,
        category_path: classification.category_path,
        creat_de: userId,
      }));
      await db.from("echivalente_produse").insert(rows);
    }

    return new Response(
      JSON.stringify({
        success: true,
        from_cache: false,
        category: classification,
        echivalente,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("ai-find-equivalent error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
