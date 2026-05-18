import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

const SYSTEM_PROMPT = `Ești expert în analiza antemasurătorilor pentru lucrări de construcții și reabilitare din România.

Extrage TOATE pozițiile de materiale din documentul primit.
Pentru fiecare poziție returnează:
- nr: numărul poziției din document (string, opțional)
- sectiune: categoria sau secțiunea materialului (ex: "Termosistem Fațadă", "Soclu", "Învelitoare Terasă", "Accesorii")
- descriere_client: denumirea completă a materialului, exact cum apare în document
- cantitate: cantitatea numerică (număr, fără unitate)
- unitate: unitatea de măsură (pac, sac, rolă, buc, ml, mp, mc, găl, kg, cutie, etc.)

Reguli importante:
- Extrage DOAR materiale/produse cu cantități concrete, nu suprafețe sau dimensiuni generale ale clădirii
- NU include manopera, servicii (ex: săpătură, transport, montaj)
- NU include date de calcul (ex: "Arie anvelopă 1662 mp") - acestea sunt date de referință, nu produse
- Dacă același produs apare în secțiuni diferite (ex: plasă de armare la fațadă și la soclu), include-l de câte ori apare, cu secțiunea corespunzătoare
- Menține descrierile exacte din document, nu le traduce sau modifica`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const body = await req.json();
    const { text, file_base64, mime_type } = body;

    if (!text && !file_base64) {
      return new Response(
        JSON.stringify({ error: "Provide 'text' or 'file_base64' + 'mime_type'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let userContent: any;

    if (file_base64 && mime_type) {
      const dataUrl = `data:${mime_type};base64,${file_base64}`;
      userContent = [
        {
          type: "image_url",
          image_url: { url: dataUrl },
        },
        {
          type: "text",
          text: "Extrage toate pozițiile de materiale din acest document (antemasurătoare / listă de cantități). Returnează rezultatul folosind funcția extract_materials.",
        },
      ];
    } else {
      userContent = `Extrage toate pozițiile de materiale din această antemasurătoare:\n\n${text}\n\nReturnează rezultatul folosind funcția extract_materials.`;
    }

    const resp = await fetch(AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_materials",
              description: "Extrage lista structurată de materiale din antemasurătoare",
              parameters: {
                type: "object",
                properties: {
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        nr: { type: "string", description: "Numărul poziției din document" },
                        sectiune: { type: "string", description: "Secțiunea/categoria materialului" },
                        descriere_client: {
                          type: "string",
                          description: "Denumirea materialului exact cum apare în document",
                        },
                        cantitate: { type: "number", description: "Cantitatea numerică" },
                        unitate: { type: "string", description: "Unitatea de măsură" },
                      },
                      required: ["descriere_client", "cantitate", "unitate"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["items"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_materials" } },
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`AI gateway ${resp.status}: ${errText}`);
    }

    const data = await resp.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call returned by AI");

    const result = JSON.parse(toolCall.function.arguments);

    return new Response(
      JSON.stringify({ success: true, items: result.items ?? [] }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("parse-antemasuratori error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
