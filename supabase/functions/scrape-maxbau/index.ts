import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "FIRECRAWL_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { action, urls } = await req.json();

    // STEP 1: MAP - discover all product URLs
    if (action === "map") {
      console.log("Mapping maxbau.ro for product URLs...");
      const response = await fetch("https://api.firecrawl.dev/v1/map", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: "https://maxbau.ro",
          limit: 5000,
          includeSubdomains: false,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        return new Response(
          JSON.stringify({ success: false, error: data.error || "Map failed" }),
          { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Filter only product URLs (ending with code-number.html pattern)
      const productUrls = (data.links || []).filter((url: string) =>
        /\-\d{5,}\.html$/.test(url)
      );

      console.log(`Found ${productUrls.length} product URLs out of ${(data.links || []).length} total`);

      return new Response(
        JSON.stringify({ success: true, productUrls, total: productUrls.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // STEP 2: SCRAPE - scrape a batch of product URLs and save to DB
    if (action === "scrape") {
      if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: "urls array is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const results: any[] = [];
      const errors: string[] = [];

      for (const url of urls) {
        try {
          console.log(`Scraping: ${url}`);
          const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              url,
              formats: [
                {
                  type: "json",
                  schema: {
                    type: "object",
                    properties: {
                      product_name: { type: "string", description: "Full product name from the H1 title" },
                      cod_produs: { type: "string", description: "Product code shown after 'Cod produs:'" },
                      price: { type: "string", description: "Price value in LEI (without TVA)" },
                      unit: { type: "string", description: "Unit of measure (BUC, MP, ML, KG, CUT, etc.)" },
                      breadcrumb: {
                        type: "array",
                        items: { type: "string" },
                        description: "Breadcrumb path categories (exclude Acasa and product name itself)",
                      },
                      image_url: { type: "string", description: "Main product image URL" },
                      description: { type: "string", description: "Short product description" },
                    },
                    required: ["product_name", "cod_produs", "price", "unit", "breadcrumb"],
                  },
                },
              ],
              onlyMainContent: true,
            }),
          });

          const data = await response.json();
          if (!response.ok) {
            errors.push(`${url}: API error ${response.status}`);
            continue;
          }

          const extracted = data.data?.json || data.json;
          if (!extracted || !extracted.cod_produs) {
            errors.push(`${url}: Could not extract product data`);
            continue;
          }

          // Parse price - remove dots as thousand separators, handle comma as decimal
          let priceStr = String(extracted.price || "0")
            .replace(/[^\d.,]/g, "")
            .replace(/\./g, "")
            .replace(",", ".");
          const price = parseFloat(priceStr) || 0;

          // Build category hierarchy from breadcrumb
          const breadcrumb: string[] = (extracted.breadcrumb || []).filter(
            (b: string) => b !== "Acasa" && b !== extracted.product_name
          );

          // Upsert categories
          let categoryId: string | null = null;
          let parentId: string | null = null;

          for (const catName of breadcrumb) {
            const slug = catName
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "");

            // Check if category exists
            const { data: existing } = await supabase
              .from("categories")
              .select("id")
              .eq("slug", slug)
              .eq(parentId ? "parent_id" : "parent_id", parentId)
              .maybeSingle();

            if (existing) {
              categoryId = existing.id;
              parentId = existing.id;
            } else {
              const { data: newCat, error: catError } = await supabase
                .from("categories")
                .insert({ name: catName, slug, parent_id: parentId })
                .select("id")
                .single();

              if (catError) {
                console.error(`Category insert error for ${catName}:`, catError);
              } else {
                categoryId = newCat.id;
                parentId = newCat.id;
              }
            }
          }

          // Upsert product
          const productData = {
            cod_intern: String(extracted.cod_produs).trim(),
            denumire_completa: extracted.product_name.trim(),
            pret_lista: price,
            unit: (extracted.unit || "BUC").toUpperCase(),
            category_id: categoryId,
            image_url: extracted.image_url || null,
            description: extracted.description || null,
            source_url: url,
            updated_at: new Date().toISOString(),
          };

          // Check if product exists by cod_intern
          const { data: existingProduct } = await supabase
            .from("products")
            .select("id")
            .eq("cod_intern", productData.cod_intern)
            .maybeSingle();

          if (existingProduct) {
            await supabase
              .from("products")
              .update(productData)
              .eq("id", existingProduct.id);
          } else {
            await supabase.from("products").insert(productData);
          }

          results.push({
            cod_intern: productData.cod_intern,
            name: productData.denumire_completa,
            price: productData.pret_lista,
          });
        } catch (err) {
          errors.push(`${url}: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
      }

      console.log(`Scraped ${results.length} products, ${errors.length} errors`);

      return new Response(
        JSON.stringify({
          success: true,
          imported: results.length,
          errors: errors.length,
          errorDetails: errors,
          results,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: "Invalid action. Use 'map' or 'scrape'" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
