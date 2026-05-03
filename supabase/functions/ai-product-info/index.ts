import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CACHE_TTL_DAYS = 30;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Validate JWT from authorization header
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
    const productIds: string[] = body.product_ids;
    const clientRequest: string = body.client_request || "";

    if (!Array.isArray(productIds) || productIds.length === 0 || productIds.length > 5) {
      return new Response(JSON.stringify({ error: "product_ids must be 1-5 items" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch products
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

    // Check cache
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

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "product_tech_info",
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
                          alternative: {
                            type: "array",
                            items: { type: "string" },
                            description: "Up to 3 equivalent alternative products",
                          },
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
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "product_tech_info" } },
        }),
      });

      if (!aiResponse.ok) {
        const status = aiResponse.status;
        if (status === 429) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later" }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (status === 402) {
          return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds at Settings > Workspace > Usage" }), {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const errText = await aiResponse.text();
        console.error("AI gateway error:", status, errText);
        throw new Error("AI gateway error");
      }

      const aiData = await aiResponse.json();
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      
      if (toolCall?.function?.arguments) {
        let parsed;
        try {
          parsed = JSON.parse(toolCall.function.arguments);
        } catch {
          console.error("Failed to parse AI response");
          parsed = { products: [] };
        }

        const aiProducts = parsed.products || [];
        
        for (const aiProd of aiProducts) {
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

          // Cache in DB
          const existingSpecs = (matchingProduct.specifications as Record<string, unknown>) || {};
          await supabaseAdmin
            .from("products")
            .update({
              specifications: { ...existingSpecs, ai_info: aiInfo },
            })
            .eq("id", matchingProduct.id);
        }
      }
    }

    // Merge cached + new results
    const allResults: Record<string, unknown> = { ...cached, ...aiResults };

    const cachedIds = Object.keys(cached);
    const freshIds = Object.keys(aiResults);

    return new Response(JSON.stringify({ success: true, data: allResults, cached_ids: cachedIds, fresh_ids: freshIds }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-product-info error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
