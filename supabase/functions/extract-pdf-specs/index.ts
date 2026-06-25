import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BUCKET = "fise-tehnice";
const GEMINI_MODEL = "gemini-2.5-flash";

const SPECS_SCHEMA = {
  type: "OBJECT",
  properties: {
    densitate:                { type: "STRING", description: 'ex: "15-20 kg/m³" sau null' },
    conductivitate_termica:   { type: "STRING", description: 'λ în W/(m·K), ex: "0.032 W/mK" sau null' },
    rezistenta_compresiune:   { type: "STRING", description: 'ex: "100 kPa" sau "CS(10)100" sau null' },
    rezistenta_tractiune:     { type: "STRING", description: 'ex: "≥0.08 N/mm²" sau null' },
    clasa_reactie_foc:        { type: "STRING", description: 'ex: "E", "B1", "A1" sau null' },
    temperatura_aplicare_min: { type: "STRING", description: 'ex: "+5°C" sau null' },
    temperatura_aplicare_max: { type: "STRING", description: 'ex: "+30°C" sau null' },
    timp_uscare:              { type: "STRING", description: 'ex: "24h", "48h la 20°C" sau null' },
    timp_maturare:            { type: "STRING", description: 'ex: "28 zile" sau null' },
    consum:                   { type: "STRING", description: 'ex: "4-6 kg/m²" sau "1.5 L/m²" sau null' },
    ambalaj:                  { type: "STRING", description: 'ex: "sac 25 kg", "bidon 5L" sau null' },
    grosime_strat:            { type: "STRING", description: 'ex: "8-20 mm" sau null' },
    rezistenta_la_apa:        { type: "STRING", description: 'ex: "W1", "impermeabil", "hidrofug" sau null' },
    utilizare:                {
      type: "ARRAY",
      items: { type: "STRING" },
      description: 'ex: ["exterior", "termosistem EPS", "interior"]'
    },
    compatibil_cu:            {
      type: "ARRAY",
      items: { type: "STRING" },
      description: 'materiale/suporturi compatibile, ex: ["BCA", "beton", "cărămidă"]'
    },
    incompatibil_cu:          {
      type: "ARRAY",
      items: { type: "STRING" },
      description: 'materiale/suporturi incompatibile sau restricții'
    },
    norma_standard:           {
      type: "ARRAY",
      items: { type: "STRING" },
      description: 'ex: ["EN 998-1", "SR EN 13163"]'
    },
    clasa_utilizare:          { type: "STRING", description: 'ex: "C1", "C2T", "W1" sau null' },
    continut_co2:             { type: "STRING", description: 'amprenta de carbon dacă e specificată, sau null' },
    producator:               { type: "STRING", description: 'ex: "Adeplast", "Baumit" sau null' },
    serie_produs:             { type: "STRING", description: 'ex: "Optim Dekor Rinoterm" sau null' },
    garantie:                 { type: "STRING", description: 'ex: "10 ani" sau null' },
    rezumat_tehnic:           { type: "STRING", description: 'Rezumat de 2-3 fraze cu principalele caracteristici și utilizare' },
  },
  required: ["rezumat_tehnic", "utilizare", "compatibil_cu"],
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Authenticate caller (verify session token)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, // service role bypasses RLS to update product
      { auth: { persistSession: false } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: authError } = await supabaseAdmin.auth.getClaims(token);
    if (authError || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if user is admin
    const userId = claims.claims.sub;
    const { data: userRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    if (!userRole) {
      return new Response(JSON.stringify({ error: "Access denied: Admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Parse request parameters
    const { productId } = await req.json();
    if (!productId) {
      return new Response(JSON.stringify({ error: "productId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Fetch product details
    const { data: product, error: prodError } = await supabaseAdmin
      .from("products")
      .select("id, cod_intern, denumire_completa, specifications, fisa_tehnica_url, fisa_tehnica_storage_path")
      .eq("id", productId)
      .single();

    if (prodError || !product) {
      return new Response(JSON.stringify({ error: "Product not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { fisa_tehnica_url, fisa_tehnica_storage_path, denumire_completa, cod_intern } = product;
    if (!fisa_tehnica_url && !fisa_tehnica_storage_path) {
      return new Response(JSON.stringify({ error: "Product does not have a PDF datasheet configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Download PDF
    let pdfBuffer: ArrayBuffer | null = null;

    if (fisa_tehnica_storage_path) {
      try {
        const { data, error } = await supabaseAdmin.storage
          .from(BUCKET)
          .download(fisa_tehnica_storage_path);
        if (!error && data) {
          pdfBuffer = await data.arrayBuffer();
        }
      } catch (err) {
        console.error("Storage download failed:", err);
      }
    }

    if (!pdfBuffer && fisa_tehnica_url) {
      try {
        const resp = await fetch(fisa_tehnica_url);
        if (resp.ok) {
          pdfBuffer = await resp.arrayBuffer();
        } else {
          throw new Error(`HTTP status ${resp.status}`);
        }
      } catch (err) {
        return new Response(JSON.stringify({ error: `Could not download PDF from URL: ${err.message}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (!pdfBuffer) {
      return new Response(JSON.stringify({ error: "Failed to download PDF file" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Convert to Base64
    const uint8Array = new Uint8Array(pdfBuffer);
    let binary = "";
    const len = uint8Array.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64Pdf = btoa(binary);

    // 6. Call Gemini Multimodal API
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY is not configured on the server" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `Ești expert în materiale de construcții. Analizează EXCLUSIV documentul PDF atașat (fișa tehnică oficială) și extrage caracteristicile tehnice în formatul JSON cerut.

PRODUS: ${denumire_completa} (cod: ${cod_intern})

INSTRUCȚIUNI:
- Extrage DOAR date explicite din document, NU inventa nimic.
- Dacă o caracteristică nu apare în document, pune null (pentru string) sau [] (pentru array).
- Pentru "utilizare": include tipul aplicației (interior/exterior) și suportul/sistemul recomandat.
- Pentru "compatibil_cu": listează materialele de suport sau produsele din sistem cu care e compatibil.
- "rezumat_tehnic": 2-3 fraze clare despre ce este produsul, unde se folosește și principalele avantaje.`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiApiKey}`;
    
    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: "application/pdf",
                  data: base64Pdf
                }
              },
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: SPECS_SCHEMA,
          temperature: 0.1,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return new Response(JSON.stringify({ error: `Gemini API error: ${errText.slice(0, 300)}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const geminiData = await response.json();
    const resultText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!resultText) {
      return new Response(JSON.stringify({ error: "Gemini did not return structured text content" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const specs = JSON.parse(resultText);
    specs._extracted_at = new Date().toISOString();
    specs._source = "edge_function_multimodal";

    // 7. Update specifications inside DB
    const currentSpecs = (product.specifications as Record<string, unknown>) || {};
    const newSpecs = {
      ...currentSpecs,
      fisa_tehnica_specs: specs,
    };

    // Also populate direct fields
    const { error: updateError } = await supabaseAdmin
      .from("products")
      .update({
        specifications: newSpecs,
        fisa_tehnica_processed: true,
      })
      .eq("id", productId);

    if (updateError) {
      throw updateError;
    }

    // 8. Trigger local database function to update ai_info instantly
    // (So it gets mapped right away to standard format)
    await supabaseAdmin.rpc("get_ai_product_info", { p_product_id: productId });

    return new Response(JSON.stringify({ success: true, data: specs }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("extract-pdf-specs error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
