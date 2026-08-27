import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GEMINI_MODEL = "gemini-2.5-flash";

// 1. Definim System Prompt-ul complet
const SYSTEM_PROMPT = `IDENTITATE
Ești un inginer constructor cu 20 de ani de experiență practică pe șantier și 10 ani ca inginer de vânzări-ofertare la un distribuitor național de materiale de construcții.
Ajuți clienții consultativ să identifice materialele ideale și să calculeze cantitățile de materiale necesare pe baza fișelor tehnice și a rețetelor reale de construcție.

REGULI CRITICE DE OFERTARE (MANDATORII):
- Pentru a recomanda produse exacte, folosește întotdeauna tool-urile de căutare din baza de date pentru a obține prețurile, ambalajele și consumurile reale. NU inventa coduri, prețuri sau caracteristici!
- Când clientul cere un deviz sau o ofertă de sistem (ex: termosistem fațadă, tencuială etc.):
  1. Caută rețeta tehnică corespunzătoare folosind \`get_recipe\` pentru a vedea toate componentele necesare (adeziv, plasă, dibluri, amorsă, tencuială decorativă etc.) și consumurile specifice per mp.
  2. Căută produsele reale pentru fiecare element din rețetă folosind \`search_products\`.
  3. Calculează cantitățile totale de materiale înmulțind suprafața cerută (mp) cu consumul per mp din rețetă.
  4. Adaugă o marjă de pierderi standard de 10% la cantitățile calculate.
  5. Calculează numărul de ambalaje întregi (saci, bidoane, role) rotunjind în sus (ex: dacă rezultă 4.2 saci, propune 5 saci).
  6. Afișează o ofertă detaliată, structurată, linie cu linie: Nume produs, Cod intern, Cantitate calculată (saci/role/buc), Preț unitar și Preț total (inclusiv calculul total al ofertei).
- Menționează că paleții europeni au o taxă de garanție de 85 lei returnabilă.
- Adresare respectuoasă: "Dumneavoastră" la primul contact. Limba română cu diacritice obligatorii.
- Fii extrem de precis la calculele matematice!

REGULI SPECIFICAȚII TEHNICE ȘI SURSE DE DATE (M1):
- Când oferi specificații tehnice sau recomanzi produse, specifică clar sursa datelor pentru fiecare produs recomandat folosind etichete textuale explicite:
  - 🟢 **Fișă tehnică verificată**: pentru produsele care au \`source: "verified"\` (date extrase direct din documentul oficial).
  - 🟡 **Date generate de AI (orientative)**: pentru produsele care au \`source: "ai_generated"\` sau \`source: "ai"\` (date generate de modelul AI, neverificate, care pot conține erori).
  - 🔴 **Fără fișă tehnică**: dacă un produs nu are fișă tehnică procesată (\`source: "none"\`), atenționează clientul și recomandă-i să o încarce.

REGULI ECHIVALENTE REALE (M2):
- NICIODATĂ nu inventa branduri sau produse de echivalare care nu există în baza noastră de date!
- Dacă un client cere un brand concurent sau solicită alternative/echivalente pentru un produs, folosește OBLIGATORIU tool-ul \`get_equivalents\` cu codul intern al produsului curent.
- Oferă doar echivalente reale din baza de date returnate de acest tool, menționând dacă au specificații verificate (🟢) sau generate de AI (🟡).`;

// 2. Schema de tool-uri (Gemini Function Declarations)
const TOOL_DEFINITIONS = [
  {
    functionDeclarations: [
      {
        name: "search_products",
        description: "Caută produse în baza de date folosind căutare semantică bazată pe embeddings. Returnează codul, denumirea și prețul produselor similare.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: {
              type: "STRING",
              description: "Termenul sau descrierea căutată (ex: 'adeziv polistiren expandat', 'vată bazaltică 10cm', 'Baumit ProContact')"
            },
            category_filter: {
              type: "STRING",
              description: "Slug categorie opțional (ex: 'vata-sistem')"
            },
            limit: {
              type: "INTEGER",
              description: "Număr maxim de rezultate (implicit 5, max 10)"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "get_product_details",
        description: "Returnează specificațiile tehnice detaliate extrase direct din PDF și datele complete pentru o listă de produse pe baza codurilor lor interne.",
        parameters: {
          type: "OBJECT",
          properties: {
            coduri_interne: {
              type: "ARRAY",
              items: { type: "STRING" },
              description: "Lista de coduri interne de produse (ex: ['BAU-1002', 'CER-2041'])"
            }
          },
          required: ["coduri_interne"]
        }
      },
      {
        name: "get_recipe",
        description: "Returnează componentele și coeficienții de consum per mp dintr-o rețetă de construcții standard de șantier (ex: termosistem vată, tencuială CD60).",
        parameters: {
          type: "OBJECT",
          properties: {
            recipe_name_query: {
              type: "STRING",
              description: "Numele sau cuvântul cheie pentru rețeta căutată (ex: 'fațadă', 'vată', 'mansardă')"
            }
          },
          required: ["recipe_name_query"]
        }
      },
      {
        name: "get_equivalents",
        description: "Caută produse similare/echivalente reale din baza de date pentru un produs specific, pe baza codului său intern (folosește categoria pentru potrivire).",
        parameters: {
          type: "OBJECT",
          properties: {
            cod_intern: {
              type: "STRING",
              description: "Codul intern al produsului de referință (ex: 'BAU-1002')"
            }
          },
          required: ["cod_intern"]
        }
      }
    ]
  }
];

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
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY")!;

    if (!supabaseUrl || !supabaseServiceKey || !geminiApiKey) {
      throw new Error("Missing server environment variables");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { messages, systemPrompt: clientSystemPrompt } = await req.json();
    if (!Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages array is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const activeSystemPrompt = clientSystemPrompt || SYSTEM_PROMPT;

    // 3. Formatăm istoricul conversației în structura Gemini
    // Rolul "assistant" devine "model". Gemini nu acceptă "system" în istoric direct, ci prin systemInstruction
    const geminiContents = messages.map((m: any) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    // 4. Apelăm modelul Gemini (Prima rundă - poate decide să folosească tool-uri)
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiApiKey}`;

    let payload = {
      contents: geminiContents,
      systemInstruction: { parts: [{ text: activeSystemPrompt }] },
      tools: TOOL_DEFINITIONS,
      generationConfig: { temperature: 0.2 }
    };

    let response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Gemini API Error: ${await response.text()}`);
    }

    let geminiData = await response.json();
    let candidate = geminiData.candidates?.[0];
    let parts = candidate?.content?.parts || [];
    let functionCalls = parts.filter((p: any) => p.functionCall);

    // 5. Agentic loop: dacă modelul vrea să cheme o funcție, o executăm local
    if (functionCalls.length > 0) {
      console.log(`🤖 AI triggered Tool Call: ${JSON.stringify(functionCalls)}`);
      
      const toolResults = [];

      for (const call of functionCalls) {
        const { name, args } = call.functionCall;
        let functionResult: any = null;

        try {
          if (name === "search_products") {
            const { query, category_filter, limit } = args as any;
            const searchLimit = limit || 5;

            // 5a. Generăm embedding pentru query-ul de căutare
            const embedUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${geminiApiKey}`;
            const embedResp = await fetch(embedUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "models/gemini-embedding-2",
                content: { parts: [{ text: query.slice(0, 1000) }] },
                taskType: "RETRIEVAL_QUERY",
                outputDimensionality: 768
              }),
            });

            if (!embedResp.ok) throw new Error("Could not generate embedding for query");
            const embedData = await embedResp.json();
            const embeddingVector = embedData.embedding?.values;

            // 5b. Rulăm căutarea semantică RPC în Postgres
            const { data: searchResults, error: rpcError } = await supabase.rpc(
              "search_products_by_embedding",
              {
                query_embedding: embeddingVector,
                match_threshold: 0.6, // prag relaxat
                match_count: searchLimit,
                category_filter: category_filter || null
              }
            );

            if (rpcError) throw rpcError;

            // Map search results to include metadata flags for the LLM
            const mappedResults = (searchResults || []).map((r: any) => {
              const specifications = r.specifications || {};
              const ftSpecs = specifications.fisa_tehnica_specs || null;
              const aiInfo = specifications.ai_info || null;
              const source = ftSpecs ? "verified" : (aiInfo ? "ai" : "none");
              return {
                id: r.product_id,
                cod_intern: r.cod_intern,
                denumire_completa: r.denumire_completa,
                brand: r.brand,
                fisa_tehnica_url: r.fisa_tehnica_url,
                has_verified_specs: !!ftSpecs,
                source,
                specifications: ftSpecs || aiInfo || null
              };
            });
            functionResult = mappedResults;

          } else if (name === "get_product_details") {
            const { coduri_interne } = args as any;

            const { data: products, error: dbError } = await supabase
              .from("products")
              .select("id, cod_intern, denumire_completa, pret_lista, unit, brand, manufacturer, specifications")
              .in("cod_intern", coduri_interne);

            if (dbError) throw dbError;

            // Map specifications and source details
            const mappedProducts = (products || []).map((p: any) => {
              const specs = p.specifications || {};
              const ftSpecs = specs.fisa_tehnica_specs || null;
              const aiInfo = specs.ai_info || null;
              const source = ftSpecs ? "verified" : (aiInfo ? "ai_generated" : "none");
              return {
                id: p.id,
                cod_intern: p.cod_intern,
                denumire_completa: p.denumire_completa,
                pret_lista: p.pret_lista,
                unit: p.unit,
                brand: p.brand,
                manufacturer: p.manufacturer,
                source,
                fisa_tehnica_specs: ftSpecs,
                ai_info: aiInfo
              };
            });
            functionResult = mappedProducts;

          } else if (name === "get_recipe") {
            const { recipe_name_query } = args as any;

            const { data: recipes, error: dbError } = await supabase
              .from("retete_constructii")
              .select("id, recipe_name, category, unit, materials")
              .ilike("recipe_name", `%${recipe_name_query}%`)
              .eq("status", "active");

            if (dbError) throw dbError;
            functionResult = recipes;

          } else if (name === "get_equivalents") {
            const { cod_intern } = args as any;

            // Find reference product's category
            const { data: refProduct, error: refError } = await supabase
              .from("products")
              .select("id, category_id, brand")
              .eq("cod_intern", cod_intern)
              .single();

            if (refError || !refProduct) {
              functionResult = { error: `Produsul cu codul ${cod_intern} nu a fost găsit.` };
            } else if (!refProduct.category_id) {
              functionResult = { error: `Produsul ${cod_intern} nu are o categorie asociată.` };
            } else {
              // Find active products in same category
              const { data: equivalents, error: eqError } = await supabase
                .from("products")
                .select("id, cod_intern, denumire_completa, pret_lista, unit, brand, specifications")
                .eq("category_id", refProduct.category_id)
                .eq("is_active", true)
                .neq("id", refProduct.id)
                .limit(6);

              if (eqError) throw eqError;

              const mapped = (equivalents || []).map((e: any) => {
                const specs = e.specifications || {};
                const ftSpecs = specs.fisa_tehnica_specs || null;
                const aiInfo = specs.ai_info || null;
                const source = ftSpecs ? "verified" : (aiInfo ? "ai_generated" : "none");
                return {
                  id: e.id,
                  cod_intern: e.cod_intern,
                  denumire_completa: e.denumire_completa,
                  pret_lista: e.pret_lista,
                  unit: e.unit,
                  brand: e.brand,
                  source,
                  fisa_tehnica_specs: ftSpecs,
                  ai_info: aiInfo
                };
              });

              functionResult = {
                product: { cod_intern, brand: refProduct.brand },
                equivalents: mapped
              };
            }
          }

        } catch (err: any) {
          console.error(`Error executing tool ${name}:`, err);
          functionResult = { error: err.message };
        }

        toolResults.push({
          name,
          response: { result: functionResult }
        });
      }

      // 6. Runda a 2-a: Trimitem înapoi rezultatele la Gemini pentru a formula răspunsul final
      // Structura Gemini cere să trimitem în contents:
      // - Toate mesajele anterioare
      // - Răspunsul modelului care conține functionCall-ul
      // - Mesajul utilizatorului de tip functionResponse care conține rezultatul executării
      const finalContents = [
        ...geminiContents,
        {
          role: "model",
          parts: parts // conține functionCall-urile
        },
        {
          role: "user",
          parts: toolResults.map((tr) => ({
            functionResponse: {
              name: tr.name,
              response: tr.response
            }
          }))
        }
      ];

      payload.contents = finalContents;

      response = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Gemini API Error R2: ${await response.text()}`);
      }

      geminiData = await response.json();
      candidate = geminiData.candidates?.[0];
    }

    const responseText = candidate?.content?.parts?.[0]?.text || "Ne cerem scuze, am întâmpinat o eroare la procesare.";

    return new Response(JSON.stringify({ response: responseText }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("ai-consultant Edge Function error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
