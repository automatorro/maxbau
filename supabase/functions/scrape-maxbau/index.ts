import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function parseProduct(markdown: string, url: string) {
  // Extract cod produs from URL (pattern: -XXXXXXXX.html)
  const codMatch = url.match(/-(\d{5,})\.html$/);
  const codIntern = codMatch ? codMatch[1] : null;

  if (!codIntern) return null;

  // Extract product name from H1 (# Title)
  const h1Match = markdown.match(/^# (.+)$/m);
  const productName = h1Match ? h1Match[1].trim() : null;

  if (!productName) return null;

  // Extract price - look for pattern like "XXXX LEI" near "Pret fara TVA" or "Pret / "
  // Prices on maxbau.ro appear as e.g. "6247 LEI" or "2.08999 LEI"
  let price = 0;
  // Try to find price near "Pret fara TVA" or standalone price
  const pricePatterns = [
    /(\d[\d.]*)\s*LEI\s*\n\s*\n\s*Pret\s*\/\s*(\w+)/im,
    /(\d[\d.]*)\s*LEI\s*\n\s*\n\s*Pret fara TVA/im,
    /^(\d[\d.]*)\s*LEI$/m,
  ];
  
  let unit = "BUC";
  for (const pattern of pricePatterns) {
    const m = markdown.match(pattern);
    if (m) {
      // Parse price: "6247" or "2.08999" - these are formatted with dots as thousands sometimes
      let priceStr = m[1];
      // If it looks like a decimal (e.g. "2.08999" = 2089.99), check context
      // maxbau.ro uses dots oddly: "6247" means 62.47, "2765" means 27.65
      // Actually from the site: prices shown are in format where last 2 digits are decimals
      // "6247 LEI" = 62.47 LEI, "2765 LEI" = 27.65 LEI
      // But "2.08999 LEI" = 2,089.99 LEI (dot as thousands separator)
      
      if (priceStr.includes('.')) {
        // Dot used as thousands separator: "2.08999" -> 208999 -> need to figure out
        // Actually "2.08999" means 2089.99 (the site uses dots for thousands)
        priceStr = priceStr.replace(/\./g, '');
      }
      
      // Last 2 digits are decimals (site shows prices * 100)
      const rawNum = parseInt(priceStr, 10);
      price = rawNum / 100;
      
      if (m[2]) {
        unit = m[2].toUpperCase();
      }
      break;
    }
  }

  // Extract unit from "Pret / BUC" or "Se vinde la:" pattern
  const unitMatch = markdown.match(/Pret\s*\/\s*(\w+)/i) || markdown.match(/UM\s*\|\s*(\w+)/i);
  if (unitMatch) {
    unit = unitMatch[1].toUpperCase();
  }

  // Extract breadcrumb (numbered list at top)
  const breadcrumbs: string[] = [];
  const bcMatches = markdown.matchAll(/^\d+\.\s+\[([^\]]+)\]/gm);
  for (const bc of bcMatches) {
    const name = bc[1].trim();
    if (name !== "Acasa" && name !== productName) {
      breadcrumbs.push(name);
    }
  }

  // Extract image URL
  const imgMatch = markdown.match(/\(https:\/\/cdn\.contentspeed\.ro[^)]+products\/original[^)]+\)/);
  const imageUrl = imgMatch ? imgMatch[0].slice(1, -1) : null;

  // Extract "Cod produs:" value as fallback
  const codProdusMatch = markdown.match(/Cod produs:\s*(\S+)/i);
  const codFromPage = codProdusMatch ? codProdusMatch[1].trim() : codIntern;

  return {
    cod_intern: codFromPage || codIntern,
    denumire_completa: productName,
    pret_lista: price,
    unit,
    breadcrumbs,
    image_url: imageUrl,
    source_url: url,
  };
}

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
        console.error("Map error:", JSON.stringify(data));
        return new Response(
          JSON.stringify({ success: false, error: data.error || "Map failed" }),
          { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const productUrls = (data.links || []).filter((url: string) =>
        /\-\d{5,}\.html$/.test(url)
      );

      console.log(`Found ${productUrls.length} product URLs out of ${(data.links || []).length} total`);

      return new Response(
        JSON.stringify({ success: true, productUrls, total: productUrls.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "scrape") {
      if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: "urls array is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const results: any[] = [];
      const errors: string[] = [];

      // Process URLs sequentially to avoid rate limits
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
              formats: ["markdown"],
              onlyMainContent: false,
            }),
          });

          const data = await response.json();
          if (!response.ok) {
            const errMsg = `${url}: Firecrawl API error ${response.status} - ${JSON.stringify(data.error || data)}`;
            console.error(errMsg);
            errors.push(errMsg);
            continue;
          }

          const markdown = data.data?.markdown || data.markdown || "";
          if (!markdown) {
            const errMsg = `${url}: No markdown content returned`;
            console.error(errMsg);
            errors.push(errMsg);
            continue;
          }

          const parsed = parseProduct(markdown, url);
          if (!parsed || !parsed.cod_intern) {
            const errMsg = `${url}: Could not parse product data from markdown`;
            console.error(errMsg);
            console.error("First 500 chars:", markdown.substring(0, 500));
            errors.push(errMsg);
            continue;
          }

          // Upsert categories from breadcrumbs
          let categoryId: string | null = null;
          let parentId: string | null = null;

          for (const catName of parsed.breadcrumbs) {
            const slug = catName
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "");

            const { data: existing } = await supabase
              .from("categories")
              .select("id")
              .eq("slug", slug)
              .maybeSingle();

            if (existing) {
              categoryId = existing.id;
              parentId = existing.id;
            } else {
              const { data: newCat, error: catError }: { data: any; error: any } = await supabase
                .from("categories")
                .insert({ name: catName, slug, parent_id: parentId })
                .select("id")
                .single();

              if (catError) {
                console.error(`Category error for ${catName}:`, catError.message);
                // Try to find it again (race condition)
                const { data: retry } = await supabase
                  .from("categories")
                  .select("id")
                  .eq("slug", slug)
                  .maybeSingle();
                if (retry) {
                  categoryId = retry.id;
                  parentId = retry.id;
                }
              } else {
                categoryId = newCat.id;
                parentId = newCat.id;
              }
            }
          }

          const productData = {
            cod_intern: parsed.cod_intern,
            denumire_completa: parsed.denumire_completa,
            pret_lista: parsed.pret_lista,
            unit: parsed.unit,
            category_id: categoryId,
            image_url: parsed.image_url,
            source_url: url,
            updated_at: new Date().toISOString(),
          };

          // Upsert product by cod_intern
          const { data: existingProduct } = await supabase
            .from("products")
            .select("id")
            .eq("cod_intern", productData.cod_intern)
            .maybeSingle();

          let dbError;
          if (existingProduct) {
            const { error } = await supabase
              .from("products")
              .update(productData)
              .eq("id", existingProduct.id);
            dbError = error;
          } else {
            const { error } = await supabase.from("products").insert(productData);
            dbError = error;
          }

          if (dbError) {
            const errMsg = `${url}: DB error - ${dbError.message}`;
            console.error(errMsg);
            errors.push(errMsg);
            continue;
          }

          console.log(`OK: ${parsed.cod_intern} - ${parsed.denumire_completa} - ${parsed.pret_lista} ${parsed.unit}`);
          results.push({
            cod_intern: productData.cod_intern,
            name: productData.denumire_completa,
            price: productData.pret_lista,
          });
        } catch (err) {
          const errMsg = `${url}: ${err instanceof Error ? err.message : "Unknown error"}`;
          console.error(errMsg);
          errors.push(errMsg);
        }
      }

      console.log(`Scraped ${results.length} products, ${errors.length} errors`);

      return new Response(
        JSON.stringify({
          success: true,
          imported: results.length,
          errors: errors.length,
          errorDetails: errors.slice(0, 20),
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
