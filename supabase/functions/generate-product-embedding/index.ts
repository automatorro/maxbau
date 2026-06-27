import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const { productId } = await req.json();
    if (!productId) {
      return new Response(JSON.stringify({ error: "productId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Fetch product specs
    const { data: product, error: prodError } = await supabaseAdmin
      .from("products")
      .select("id, cod_intern, denumire_completa, brand, specifications")
      .eq("id", productId)
      .single();

    if (prodError || !product) {
      return new Response(JSON.stringify({ error: "Product not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const specifications = product.specifications || {};
    const specs = (specifications.fisa_tehnica_specs || specifications.ai_info || {}) as Record<string, any>;

    // Support root specifications fallback/supplementary fields
    const thickness = specifications.thickness_mm !== undefined ? `${specifications.thickness_mm} mm` : specs.grosime_strat;
    const conductivitate = specifications.lambda_w_mk !== undefined ? `${specifications.lambda_w_mk} W/mK` : specs.conductivitate_termica;
    const rezistentaCompresiune = specifications.compressive_strength_kpa !== undefined ? `${specifications.compressive_strength_kpa} kPa` : specs.rezistenta_compresiune;
    const width = specifications.width_mm !== undefined ? `${specifications.width_mm} mm` : null;
    const length = specifications.length_mm !== undefined ? `${specifications.length_mm} mm` : null;

    // 2. Build descriptive text for embedding
    const textParts = [
      `Denumire produs: ${product.denumire_completa}`,
      `Cod intern: ${product.cod_intern}`,
      product.brand ? `Brand: ${product.brand}` : "",
      specs.rezumat_tehnic ? `Rezumat: ${specs.rezumat_tehnic}` : "",
      specs.densitate ? `Densitate: ${specs.densitate}` : "",
      conductivitate ? `Conductivitate termică (lambda): ${conductivitate}` : "",
      rezistentaCompresiune ? `Rezistență la compresiune: ${rezistentaCompresiune}` : "",
      specs.rezistenta_tractiune ? `Rezistență la tracțiune: ${specs.rezistenta_tractiune}` : "",
      specs.clasa_reactie_foc ? `Reacție la foc: ${specs.clasa_reactie_foc}` : "",
      specs.consum ? `Consum: ${specs.consum}` : "",
      specs.ambalaj ? `Ambalaj: ${specs.ambalaj}` : "",
      thickness ? `Grosime / Grosime strat: ${thickness}` : "",
      width ? `Lățime: ${width}` : "",
      length ? `Lungime: ${length}` : "",
      specs.utilizare ? `Utilizare: ${Array.isArray(specs.utilizare) ? specs.utilizare.join(", ") : specs.utilizare}` : "",
      specs.compatibil_cu ? `Compatibil cu: ${Array.isArray(specs.compatibil_cu) ? specs.compatibil_cu.join(", ") : specs.compatibil_cu}` : "",
      specs.incompatibil_cu ? `Incompatibil cu / Restricții: ${Array.isArray(specs.incompatibil_cu) ? specs.incompatibil_cu.join(", ") : specs.incompatibil_cu}` : "",
      specs.norma_standard ? `Standarde: ${Array.isArray(specs.norma_standard) ? specs.norma_standard.join(", ") : specs.norma_standard}` : "",
    ].filter(Boolean);

    const specsText = textParts.join("\n");

    // 3. Generate Embedding using Gemini Embedding API
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) {
      throw new Error("GEMINI_API_KEY environment variable is missing");
    }

    const embedUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${geminiApiKey}`;
    const embedResp = await fetch(embedUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/gemini-embedding-2",
        content: { parts: [{ text: specsText }] },
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: 768
      }),
    });

    if (!embedResp.ok) {
      const errText = await embedResp.text();
      throw new Error(`Gemini Embedding API error: ${errText}`);
    }

    const embedData = await embedResp.json();
    const embeddingVector = embedData.embedding?.values;

    if (!embeddingVector) {
      throw new Error("Gemini returned an empty embedding vector");
    }

    // 4. Save embedding inside DB (Upsert)
    const { error: upsertError } = await supabaseAdmin
      .from("product_embeddings")
      .upsert(
        {
          product_id: productId,
          embedding: embeddingVector,
          specs_text: specsText,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "product_id" }
      );

    if (upsertError) {
      throw upsertError;
    }

    return new Response(JSON.stringify({ success: true, specsText }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("generate-product-embedding error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
