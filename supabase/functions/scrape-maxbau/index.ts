import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function parseNumber(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toMillimeters(value: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u === "mm") return value;
  if (u === "cm") return value * 10;
  if (u === "m") return value * 1000;
  return value;
}

function extractFirstPdfUrl(markdown: string): string | null {
  const m = markdown.match(/https?:\/\/[^\s)]+\.pdf(\?[^\s)]+)?/i);
  return m ? m[0] : null;
}

function extractSection(markdown: string, titles: string[]): string | null {
  for (const title of titles) {
    const re = new RegExp(`^##\\s*${title}\\s*$([\\s\\S]*?)(?=^##\\s+|\\Z)`, "im");
    const m = markdown.match(re);
    if (m?.[1]) {
      const text = m[1].trim().replace(/\n{3,}/g, "\n\n");
      if (text.length >= 30) return text.slice(0, 5000);
    }
  }

  const h1Index = markdown.search(/^#\s+/m);
  const tail = h1Index >= 0 ? markdown.slice(h1Index) : markdown;
  const paragraphs = tail
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const p of paragraphs) {
    if (p.startsWith("#")) continue;
    if (/lei/i.test(p)) continue;
    if (/^(\d+\.)\s+/.test(p)) continue;
    const plain = p.replace(/\s+/g, " ").trim();
    if (plain.length >= 60) return plain.slice(0, 2000);
  }
  return null;
}

function normalizeForSearch(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function extractFirstMatch(markdown: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const m = markdown.match(pattern);
    const value = m?.[1]?.trim();
    if (value) return value.slice(0, 200);
  }
  return null;
}

function extractLabeledValue(markdown: string, labels: string[]): string | null {
  const normalizedLabels = labels.map((l) => normalizeForSearch(l));
  const lines = markdown.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;

    const cleaned = raw
      .replace(/^[-*+\s]+/, "")
      .replace(/<[^>]+>/g, "")
      .replace(/[*_`]+/g, "")
      .trim();
    const normLine = normalizeForSearch(cleaned);

    for (const label of normalizedLabels) {
      if (!normLine.includes(label)) continue;

      if (cleaned.includes("|")) {
        const parts = cleaned
          .split("|")
          .map((p) => p.trim())
          .filter(Boolean);

        const idx = parts.findIndex((p) => {
          const np = normalizeForSearch(p).replace(/:$/, "");
          return np === label || np.startsWith(`${label} `);
        });
        if (idx >= 0 && parts[idx + 1]) return parts[idx + 1].trim().slice(0, 200);
      }

      const colonIndex = cleaned.indexOf(":");
      if (colonIndex !== -1) {
        const key = cleaned.slice(0, colonIndex).trim();
        if (normalizeForSearch(key).includes(label)) {
          const value = cleaned.slice(colonIndex + 1).trim();
          if (value) return value.slice(0, 200);
        }
      }

      const dashMatch = cleaned.match(/^(.+?)\s*[-=]\s*(.+)$/);
      if (dashMatch) {
        const key = dashMatch[1].trim();
        if (normalizeForSearch(key).includes(label)) {
          const value = dashMatch[2].trim();
          if (value) return value.slice(0, 200);
        }
      }

      const cleanedKey = cleaned.replace(/:$/, "").trim();
      if (normalizeForSearch(cleanedKey) === label) {
        for (let j = i + 1; j < lines.length; j++) {
          const candidate = lines[j]
            .trim()
            .replace(/^[-*+\s]+/, "")
            .replace(/<[^>]+>/g, "")
            .replace(/[*_`]+/g, "")
            .trim();
          if (!candidate) continue;
          if (candidate.startsWith("#")) break;
          if (candidate.includes("|") && candidate.replace(/\|/g, "").trim().length === 0) continue;
          return candidate.slice(0, 200);
        }
      }
    }
  }

  return null;
}

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

  const thicknessMatch = productName.match(/(\d+(?:[.,]\d+)?)\s*(mm|cm)\s*(?:grosime|grosimea)/i);
  const thicknessValue = thicknessMatch ? parseNumber(thicknessMatch[1]) : null;
  const thicknessUnit = thicknessMatch ? thicknessMatch[2] : null;
  const thicknessMm =
    thicknessValue !== null && thicknessUnit ? Math.round(toMillimeters(thicknessValue, thicknessUnit)) : null;

  const dimMatch = productName.match(/(\d+(?:[.,]\d+)?)\s*(?:[xX]|\u00D7)\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)\b/i);
  const dimA = dimMatch ? parseNumber(dimMatch[1]) : null;
  const dimB = dimMatch ? parseNumber(dimMatch[2]) : null;
  const dimUnit = dimMatch ? dimMatch[3] : null;
  const lengthMm =
    dimA !== null && dimUnit ? Math.round(toMillimeters(dimA, dimUnit)) : null;
  const widthMm =
    dimB !== null && dimUnit ? Math.round(toMillimeters(dimB, dimUnit)) : null;

  const kpaMatch = productName.match(/(\d+(?:[.,]\d+)?)\s*kpa\b/i) || markdown.match(/(\d+(?:[.,]\d+)?)\s*kpa\b/i);
  const kpa = kpaMatch ? parseNumber(kpaMatch[1]) : null;

  const lambdaMatch = markdown.match(/(?:lambda|\u03BB)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
  const lambda = lambdaMatch ? parseNumber(lambdaMatch[1]) : null;

  const datasheetUrl = extractFirstPdfUrl(markdown);
  const description = extractSection(markdown, [
    "Descriere produs",
    "Descriere",
    "Caracteristici",
    "Utilizare",
    "Avantaje",
    "Detalii",
    "Informatii",
  ]);

  const specifications: Record<string, unknown> = {};
  if (thicknessMm !== null) specifications.thickness_mm = thicknessMm;
  if (lengthMm !== null) specifications.length_mm = lengthMm;
  if (widthMm !== null) specifications.width_mm = widthMm;
  if (kpa !== null) specifications.compressive_strength_kpa = kpa;
  if (lambda !== null) specifications.lambda_w_mk = lambda;
  if (datasheetUrl) specifications.datasheet_url = datasheetUrl;

  const brand =
    extractFirstMatch(markdown, [
      /Marca\s*[:：]\s*([^\n;|]+?)(?:\s*Cod produs\b|$)/i,
      /\bBrand\s*[:：]\s*([^\n;|]+?)(?:\s*Cod produs\b|$)/i,
    ]) ?? extractLabeledValue(markdown, ["brand", "marca"]);

  const manufacturer =
    extractFirstMatch(markdown, [
      /Produc[aă]tor\s*[:：]\s*([^\n;|]+?)(?:\s*Cod produs\b|$)/i,
      /\bManufacturer\s*[:：]\s*([^\n;|]+?)(?:\s*Cod produs\b|$)/i,
      /\bFabricant\s*[:：]\s*([^\n;|]+?)(?:\s*Cod produs\b|$)/i,
    ]) ?? extractLabeledValue(markdown, ["producator", "manufacturer", "fabricant"]);

  let packaging =
    extractFirstMatch(markdown, [
      /Ambalare\s*[:：]\s*([^\n;|]+)/i,
      /Mod de ambalare\s*[:：]\s*([^\n;|]+)/i,
      /Se vinde la\s*[:：]\s*([^\n;|]+)/i,
      /Cantitate\/ambalaj colectiv\s*[:：]?\s*([^\n;|]+)/i,
    ]) ?? extractLabeledValue(markdown, ["ambalare", "ambalaj", "mod de ambalare", "cantitate/ambalaj colectiv", "se vinde la"]);

  let packQuantity =
    extractFirstMatch(markdown, [
      /Cantitate\/pachet\s*[:：]\s*([^\n;|]+)/i,
      /Mp\/pachet\s*[:：]?\s*([^\n;|]+)/i,
      /Buc(?:a|ă)ti pe palet\s*[:：]?\s*([^\n;|]+)/i,
      /Buc\s*\/\s*pachet\s*[:：]?\s*([^\n;|]+)/i,
    ]) ??
    extractLabeledValue(markdown, [
      "cantitate/pachet",
      "cantitate per pachet",
      "cantitate pachet",
      "buc/pachet",
      "mp/pachet",
      "mp/pachet ",
      "bucati pe palet",
      "cantitate/ambalaj colectiv",
    ]);

  const qtyPackMatch =
    markdown.match(/(?:Ambalare|Mod de ambalare|Cantitate\/ambalaj colectiv)\s*[:：]?\s*(\d+(?:[.,]\d+)?)\s*([a-zA-ZăâîșțĂÂÎȘȚ.]+)?\s*\/\s*([a-zA-ZăâîșțĂÂÎȘȚ]+)/i) ??
    markdown.match(/(\d+(?:[.,]\d+)?)\s*([a-zA-ZăâîșțĂÂÎȘȚ.]+)?\s*\/\s*(pachet|bax|palet|cutie|sac)\b/i);
  if (qtyPackMatch) {
    const qty = qtyPackMatch[1]?.trim();
    const qtyUnit = qtyPackMatch[2]?.trim() || "";
    const pack = qtyPackMatch[3]?.trim();
    if (pack && !packaging) packaging = pack;
    if (!packQuantity && qty) packQuantity = `${qty}${qtyUnit ? ` ${qtyUnit.replace(/\.$/, "")}` : ""}`;
  }

  if (packaging) packaging = packaging.replace(/\(.*?\)/g, "").trim() || null;

  return {
    cod_intern: codFromPage || codIntern,
    denumire_completa: productName,
    pret_lista: price,
    unit,
    breadcrumbs,
    image_url: imageUrl,
    source_url: url,
    description,
    specifications,
    brand,
    manufacturer,
    packaging,
    pack_quantity: packQuantity,
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

          const head = markdown.slice(0, 2500).toLowerCase();
          if (
            (head.includes("403") && (head.includes("forbidden") || head.includes("access denied"))) ||
            head.includes("captcha") ||
            head.includes("cloudflare")
          ) {
            const errMsg = `${url}: Access blocked (403/captcha)`;
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

          if (!Number.isFinite(parsed.pret_lista) || parsed.pret_lista <= 0) {
            const errMsg = `${url}: Price not parsed (pret_lista=${parsed.pret_lista})`;
            console.error(errMsg);
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

          const productData: Record<string, unknown> = {
            cod_intern: parsed.cod_intern,
            denumire_completa: parsed.denumire_completa,
            description: parsed.description || null,
            pret_lista: parsed.pret_lista,
            unit: parsed.unit,
            category_id: categoryId,
            image_url: parsed.image_url,
            specifications: parsed.specifications || {},
            source_url: url,
            updated_at: new Date().toISOString(),
          };

          if (parsed.brand) productData.brand = parsed.brand;
          if (parsed.manufacturer) productData.manufacturer = parsed.manufacturer;
          if (parsed.packaging) productData.packaging = parsed.packaging;
          if (parsed.pack_quantity) productData.pack_quantity = parsed.pack_quantity;

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
