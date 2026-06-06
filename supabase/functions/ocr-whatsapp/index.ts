import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Ești un expert în extragerea datelor din liste de prețuri pentru materiale de construcții din România.
Analizezi imagini trimise pe WhatsApp de furnizori (Baumit, Weber, Ceresit, Knauf, Mapei, Leier, etc.).
Extrage TOATE rândurile din tabelul din imagine, inclusiv antetul (header).

Reguli stricte:
- Păstrează denumirile produselor exact cum apar în imagine
- Prețurile sunt numerice, fără simbolul monedei (ex: 47.50 nu "47,50 lei")
- UM = unitate de măsură: sac, kg, m2, ml, buc, l, t, etc.
- Ignoră logo-uri, anteturi de companie, numere de pagină
- Dacă o celulă e goală, folosește string gol ""
- Toate rândurile trebuie să aibă același număr de celule ca header-ul`;

interface ExtractedTable {
  headers: string[];
  rows: string[][];
  note?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const body = await req.json();
    const imageBase64: string = body.image_base64;
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
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: dataUrl },
              },
              {
                type: "text",
                text: "Extrage tabelul din această imagine de listă prețuri. Returnează headers și toate rândurile de date.",
              },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_price_table",
              description: "Extract structured table data from a price list image",
              parameters: {
                type: "object",
                properties: {
                  headers: {
                    type: "array",
                    items: { type: "string" },
                    description: "Column names from the table header row (in Romanian if possible)",
                  },
                  rows: {
                    type: "array",
                    items: {
                      type: "array",
                      items: { type: "string" },
                      description: "Cell values for one data row, same count as headers",
                    },
                    description: "All data rows (excluding header)",
                  },
                  note: {
                    type: "string",
                    description: "Optional: any observation about image quality or unclear content",
                  },
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
      if (status === 402) throw Object.assign(new Error("Credit AI epuizat. Adaugă fonduri în Settings > Workspace > Usage"), { status: 402 });
      const errText = await resp.text();
      console.error("AI gateway error:", status, errText);
      throw new Error(`AI gateway error: ${status}`);
    }

    const data = await resp.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return new Response(JSON.stringify({ error: "Modelul nu a returnat date structurate" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let extracted: ExtractedTable;
    try {
      extracted = JSON.parse(toolCall.function.arguments) as ExtractedTable;
    } catch {
      return new Response(JSON.stringify({ error: "Răspuns invalid de la model" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const colCount = extracted.headers.length;
    const normalizedRows = (extracted.rows || []).map((row) => {
      if (row.length === colCount) return row;
      const padded = [...row];
      while (padded.length < colCount) padded.push("");
      return padded.slice(0, colCount);
    });

    return new Response(
      JSON.stringify({
        success: true,
        headers: extracted.headers,
        rows: normalizedRows,
        note: extracted.note || null,
        model: "google/gemini-2.5-flash",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    const err = e as { status?: number; message?: string };
    console.error("ocr-whatsapp error:", e);
    return new Response(
      JSON.stringify({ error: err.message || "Eroare internă" }),
      {
        status: err.status || 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
