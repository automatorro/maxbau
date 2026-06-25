import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BASE_URL = "https://maxbau.ro";

// Browser-like headers to avoid 403 anti-bot blocks
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ro-RO,ro;q=0.9,en;q=0.8",
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function parseNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s+/g, "").replace(",", ".");
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
  const paragraphs = tail.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  for (const p of paragraphs) {
    if (p.startsWith("#")) continue;
    if (/lei/i.test(p)) continue;
    if (/(^\d+\.)\s+/.test(p)) continue;
    const plain = p.replace(/\s+/g, " ").trim();
    if (plain.length >= 60) return plain.slice(0, 2000);
  }
  return null;
}

function normalizeForSearch(input: string): string {
  return input.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function extractFirstMatch(markdown: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const m = markdown.match(pattern);
    const value = m?.[1]?.trim();
    if (value) return value.slice(0, 200);
  }
  return null;
}

function extractBrandFromHtml(html: string): string | null {
  if (!html) return null;
  const imgTags = html.match(/]*>/gi) || [];
  for (const tag of imgTags) {
    if (!/cs-photos\/brands/i.test(tag)) continue;
    const alt = tag.match(/\balt\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
    if (alt && alt.length <= 60) return alt.slice(0, 200);
    const title = tag.match(/\btitle\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
    if (title && title.length <= 60) return title.slice(0, 200);
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
    if (!src) continue;
    const base = src.split("?")[0]?.split("#")[0]?.split("/").pop() || "";
    const decoded = decodeURIComponent(base);
    const token = decoded.split(".")[0]?.split("_")[0]?.trim();
    if (!token) continue;
    const normalized = token.replace(/[-]+/g, " ").trim();
    if (!normalized) continue;
    return normalized.slice(0, 200);
  }
  return null;
}

function extractLabeledValue(markdown: string, labels: string[]): string | null {
  const normalizedLabels = labels.map((l) => normalizeForSearch(l));
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const cleaned = raw.replace(/^[-*+\s]+/, "").replace(/<[^>]+>/g, "").replace(/[*_`]+/g, "").trim();
    const normLine = normalizeForSearch(cleaned);
    for (const label of normalizedLabels) {
      if (!normLine.includes(label)) continue;
      if (cleaned.includes("|")) {
        const parts = cleaned.split("|").map((p) => p.trim()).filter(Boolean);
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
      const dashMatch = cleaned.match(/^(.*?)\s*[-=]\s*(.+)$/);
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
          const candidate = lines[j].trim().replace(/^[-*+\s]+/, "").replace(/<[^>]+>/g, "").replace(/[*_`]+/g, "").trim();
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

// ─── Brand page listing parser ────────────────────────────────────────────────

/**
 * Extrage URL-urile produselor dintr-o pagină de brand (listing HTML).
 * Returnează URL-urile complete și numărul total de pagini.
 */
function parseBrandListingPage(html: string, brandSlug: string): {
  productUrls: string[];
  totalPages: number;
} {
  const productUrls: string[] = [];

  // Extrage URL-uri produse din href-urile cu pattern -NNNNN.html (fără domeniu)
  const hrefPattern = /href="([^"]*-\d{5,}\.html)"/gi;
  let m: RegExpExecArray | null;
  const seen = new Set();
  while ((m = hrefPattern.exec(html)) !== null) {
    const href = m[1];
    // Exclude link-uri de wishlist sau coș
    if (href.includes("wishlists") || href.includes("cart") || href.includes("index.php")) continue;
    const fullUrl = href.startsWith("http") ? href : `${BASE_URL}/${href.replace(/^\//, "")}`;
    if (!seen.has(fullUrl)) {
      seen.add(fullUrl);
      productUrls.push(fullUrl);
    }
  }

  // Extrage numărul de pagini din paginatorul HTML
  // Ex: 8
  let totalPages = 1;
  const pagPattern = new RegExp(`marci/${brandSlug}/pag-(\\d+)`, "g");
  let pagMatch: RegExpExecArray | null;
  while ((pagMatch = pagPattern.exec(html)) !== null) {
    const pageNum = parseInt(pagMatch[1], 10);
    if (pageNum > totalPages) totalPages = pageNum;
  }

  return { productUrls, totalPages };
}

/**
 * Extrage slug-urile tuturor brandurilor de pe pagina /marci.
 */
function parseBrandsPage(html: string): string[] {
  const slugs: string[] = [];
  const seen = new Set();
  // Pattern: href="marci/SLUG" sau href="/marci/SLUG"
  const pattern = /href=["'](?:https?:\/\/maxbau\.ro)?\/?marci\/([a-z0-9-]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(html)) !== null) {
    const slug = m[1];
    if (!seen.has(slug)) {
      seen.add(slug);
      slugs.push(slug);
    }
  }
  return slugs;
}

// ─── Product page parser (neschimbat față de versiunea anterioară) ────────────

function parseProduct(markdown: string, url: string, html?: string, knownBrandSlug?: string) {
  const codMatch = url.match(/-(\d{5,})\.html$/);
  const codIntern = codMatch ? codMatch[1] : null;
  if (!codIntern) return null;

  const h1Match = markdown.match(/^# (.+)$/m);
  const productName = h1Match ? h1Match[1].trim() : null;
  if (!productName) return null;

  // Preț — format ContentSpeed: <span>2355</span><sup>00</sup> LEI
  // În markdown apare ca ceva de tipul: "23\n55\n LEI" sau "2355 LEI"
  let price = 0;
  let unit = "BUC";

  // Încearcă formatul nou cu sup (din HTML direct)
  if (html) {
    const priceHtmlMatch = html.match(/]*class="[^"]*price[^"]*"[^>]*>\s*(\d+)\s*(\d+)<\/sup>\s*LEI/i);
    if (priceHtmlMatch) {
      price = parseInt(priceHtmlMatch[1], 10) + parseInt(priceHtmlMatch[2], 10) / 100;
    }
  }

  // Fallback — formatul vechi din markdown
  if (price === 0) {
    const pricePatterns = [
      /(\d[\d.]*)\\s*LEI\s*\n\s*\n\s*Pret\s*\/\s*(\w+)/im,
      /(\d[\d.]*)\\s*LEI\s*\n\s*\n\s*Pret fara TVA/im,
      /^(\d[\d.]*)\s*LEI$/m,
    ];
    for (const pattern of pricePatterns) {
      const pm = markdown.match(pattern);
      if (pm) {
        let priceStr = pm[1];
        if (priceStr.includes(".")) priceStr = priceStr.replace(/\./g, "");
        const rawNum = parseInt(priceStr, 10);
        price = rawNum / 100;
        if (pm[2]) unit = pm[2].toUpperCase();
        break;
      }
    }
  }

  const unitMatch = markdown.match(/Pret\s*\/\s*(\w+)/i) || markdown.match(/UM\s*\|\s*(\w+)/i);
  if (unitMatch) unit = unitMatch[1].toUpperCase();

  // Breadcrumb → categorii
  const breadcrumbs: string[] = [];
  const bcMatches = markdown.matchAll(/^\d+\.\s+\[([^\]]+)\]/gm);
  for (const bc of bcMatches) {
    const name = bc[1].trim();
    if (name !== "Acasa" && name !== productName) breadcrumbs.push(name);
  }

  // Imagine
  const imgMatch = markdown.match(/\(https:\/\/cdn\.contentspeed\.ro[^)]+products\/original[^)]+\)/);
  let imageUrl = imgMatch ? imgMatch[0].slice(1, -1) : null;

  // Fallback imagine din HTML
  if (!imageUrl && html) {
    const imgHtmlMatch = html.match(/src="(https:\/\/cdn\.contentspeed\.ro[^"]+products\/original[^"]+)"/i);
    if (imgHtmlMatch) imageUrl = imgHtmlMatch[1];
  }

  const codProdusMatch = markdown.match(/Cod produs:\s*(\S+)/i);
  const codFromPage = codProdusMatch ? codProdusMatch[1].trim() : codIntern;

  const thicknessMatch = productName.match(/(\d+(?:[.,]\d+)?)\s*(mm|cm)\s*(?:grosime|grosimea)/i);
  const thicknessValue = thicknessMatch ? parseNumber(thicknessMatch[1]) : null;
  const thicknessUnit = thicknessMatch ? thicknessMatch[2] : null;
  const thicknessMm = thicknessValue !== null && thicknessUnit ? Math.round(toMillimeters(thicknessValue, thicknessUnit)) : null;

  const dimMatch = productName.match(/(\d+(?:[.,]\d+)?)\s*(?:[xX]|\u00D7)\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)\b/i);
  const dimA = dimMatch ? parseNumber(dimMatch[1]) : null;
  const dimB = dimMatch ? parseNumber(dimMatch[2]) : null;
  const dimUnit = dimMatch ? dimMatch[3] : null;
  const lengthMm = dimA !== null && dimUnit ? Math.round(toMillimeters(dimA, dimUnit)) : null;
  const widthMm = dimB !== null && dimUnit ? Math.round(toMillimeters(dimB, dimUnit)) : null;

  const kpaMatch = productName.match(/(\d+(?:[.,]\d+)?)\s*kpa\b/i) || markdown.match(/(\d+(?:[.,]\d+)?)\s*kpa\b/i);
  const kpa = kpaMatch ? parseNumber(kpaMatch[1]) : null;

  const lambdaMatch = markdown.match(/(?:lambda|\u03BB)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
  const lambda = lambdaMatch ? parseNumber(lambdaMatch[1]) : null;

  const datasheetUrl = extractFirstPdfUrl(markdown);
  const description = extractSection(markdown, ["Descriere produs", "Descriere", "Caracteristici", "Utilizare", "Avantaje", "Detalii", "Informatii"]);

  const specifications: Record<string, unknown> = {};
  if (thicknessMm !== null) specifications.thickness_mm = thicknessMm;
  if (lengthMm !== null) specifications.length_mm = lengthMm;
  if (widthMm !== null) specifications.width_mm = widthMm;
  if (kpa !== null) specifications.compressive_strength_kpa = kpa;
  if (lambda !== null) specifications.lambda_w_mk = lambda;
  if (datasheetUrl) specifications.datasheet_url = datasheetUrl;

  // Brand: dacă îl cunoaștem din contextul brandului (ex: "baumit") → folosim numele curat
  // altfel extragem din pagina produsului
  const brandFromHtml = html ? extractBrandFromHtml(html) : null;
  const brandFromPage =
    extractFirstMatch(markdown, [
      /Marca\s*[:：]\s*([^\n;|]+?)(?:\s*Cod produs\b|$)/i,
      /\bBrand\s*[:：]\s*([^\n;|]+?)(?:\s*Cod produs\b|$)/i,
    ]) ??
    extractLabeledValue(markdown, ["brand", "marca"]) ??
    brandFromHtml;

  const manufacturer =
    extractFirstMatch(markdown, [
      /Produc[aă]tor\s*[:：]\s*([^\n;|]+?)(?:\s*Cod produs\b|$)/i,
      /\bManufacturer\s*[:：]\s*([^\n;|]+?)(?:\s*Cod produs\b|$)/i,
      /\bFabricant\s*[:：]\s*([^\n;|]+?)(?:\s*Cod produs\b|$)/i,
    ]) ??
    extractLabeledValue(markdown, ["producator", "manufacturer", "fabricant"]) ??
    brandFromHtml;

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
      /Cantitate\/UM\s*[:：]?\s*([^\n;|]+)/i,
      /Mp\/pachet\s*[:：]?\s*([^\n;|]+)/i,
      /Buc(?:a|ă)ti pe palet\s*[:：]?\s*([^\n;|]+)/i,
      /Buc\s*\/\s*pachet\s*[:：]?\s*([^\n;|]+)/i,
    ]) ??
    extractLabeledValue(markdown, ["cantitate/pachet", "cantitate per pachet", "cantitate pachet", "cantitate/um", "buc/pachet", "mp/pachet", "bucati pe palet", "cantitate/ambalaj colectiv"]);

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
    brand: brandFromPage,         // din pagina produsului
    manufacturer,
    packaging,
    pack_quantity: packQuantity,
  };
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────

async function upsertCategories(
  supabase: ReturnType<typeof createClient>,
  breadcrumbs: string[]
): Promise<string | null> {
  let categoryId: string | null = null;
  let parentId: string | null = null;

  for (const catName of breadcrumbs) {
    const slug = catName
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const { data: existing } = await supabase.from("categories").select("id").eq("slug", slug).maybeSingle();

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
        const { data: retry } = await supabase.from("categories").select("id").eq("slug", slug).maybeSingle();
        if (retry) { categoryId = retry.id; parentId = retry.id; }
      } else {
        categoryId = newCat.id;
        parentId = newCat.id;
      }
    }
  }
  return categoryId;
}

async function upsertProduct(
  supabase: ReturnType<typeof createClient>,
  parsed: NonNullable<ReturnType<typeof parseProduct>>,
  categoryId: string | null,
  brandSlug: string,
  knownBrandName?: string
): Promise<{ ok: boolean; error?: string }> {
  const brand = knownBrandName || parsed.brand || null;

  const productData: Record<string, unknown> = {
    cod_intern: parsed.cod_intern,
    denumire_completa: parsed.denumire_completa,
    description: parsed.description || null,
    pret_lista: parsed.pret_lista,
    unit: parsed.unit,
    category_id: categoryId,
    image_url: parsed.image_url,
    specifications: parsed.specifications || {},
    source_url: parsed.source_url,
    brand,
    brand_slug: brandSlug,
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  if (parsed.manufacturer) productData.manufacturer = parsed.manufacturer;
  if (parsed.packaging) productData.packaging = parsed.packaging;
  if (parsed.pack_quantity) productData.pack_quantity = parsed.pack_quantity;

  const { data: existing } = await supabase
    .from("products")
    .select("id, specifications")
    .eq("cod_intern", productData.cod_intern)
    .maybeSingle();

  let dbError;
  if (existing) {
    const existingSpecs = (existing.specifications as Record<string, unknown>) || {};
    const newSpecs = {
      ...existingSpecs,
      ...(parsed.specifications || {}),
    };
    productData.specifications = newSpecs;

    const { error } = await supabase.from("products").update(productData).eq("id", existing.id);
    dbError = error;
  } else {
    const { error } = await supabase.from("products").insert(productData);
    dbError = error;
  }

  if (dbError) return { ok: false, error: dbError.message };
  return { ok: true };
}

// ─── Edge function entry point ─────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ── Authenticate caller and require admin role ──────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (!isAdmin) {
      return new Response(JSON.stringify({ success: false, error: "Forbidden: admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    const { action, urls, brandSlug, page } = await req.json();

    // ── action: "list-brands" ───────────────────────────────────────────────
    // Returnează toți slug-urile de branduri de pe /marci
    if (action === "list-brands") {
      const res = await fetch(`${BASE_URL}/marci`, {
        headers: BROWSER_HEADERS,
      });
      if (!res.ok) throw new Error(`Failed to fetch /marci: ${res.status}`);
      const html = await res.text();
      const slugs = parseBrandsPage(html);
      console.log(`Found ${slugs.length} brand slugs`);
      return new Response(JSON.stringify({ success: true, slugs }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── action: "list-brand-products" ──────────────────────────────────────
    // Returnează URL-urile produselor dintr-o pagină de brand (cu paginare)
    if (action === "list-brand-products") {
      if (!brandSlug) {
        return new Response(JSON.stringify({ success: false, error: "brandSlug required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const pageNum = page || 1;
      const pageUrl = pageNum === 1
        ? `${BASE_URL}/marci/${brandSlug}`
        : `${BASE_URL}/marci/${brandSlug}/pag-${pageNum}`;

      const res = await fetch(pageUrl, {
        headers: BROWSER_HEADERS,
      });
      if (!res.ok) throw new Error(`Failed to fetch ${pageUrl}: ${res.status}`);
      const html = await res.text();
      const { productUrls, totalPages } = parseBrandListingPage(html, brandSlug);

      console.log(`Brand ${brandSlug} page ${pageNum}/${totalPages}: ${productUrls.length} products`);
      return new Response(JSON.stringify({ success: true, productUrls, totalPages, page: pageNum }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── action: "scrape" ────────────────────────────────────────────────────
    // Scrape produse individuale (via Firecrawl) — neschimbat ca API, îmbunătățit parsarea
    if (action === "scrape") {
      const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
      if (!apiKey) {
        return new Response(JSON.stringify({ success: false, error: "FIRECRAWL_API_KEY not configured" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return new Response(JSON.stringify({ success: false, error: "urls array is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // brandSlug opțional — dacă e trimis, îl folosim pentru brand_slug și ca hint pentru brand name
      const contextBrandSlug: string | undefined = brandSlug;
      // Derivăm un brand name "curat" din slug (ex: "baumit" → "Baumit", "alte-branduri" → null)
      const knownBrandName =
        contextBrandSlug && contextBrandSlug !== "alte-branduri"
          ? contextBrandSlug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
          : undefined;

      const results: unknown[] = [];
      const errors: string[] = [];

      for (const url of urls) {
        try {
          console.log(`Scraping: ${url}`);
          const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ url, formats: ["markdown", "html"], onlyMainContent: false }),
          });

          const data = await response.json();
          if (!response.ok) {
            errors.push(`${url}: Firecrawl ${response.status} - ${JSON.stringify(data.error || data)}`);
            continue;
          }

          const markdown = data.data?.markdown || data.markdown || "";
          if (!markdown) { errors.push(`${url}: No markdown`); continue; }

          const html = data.data?.html || data.html || "";

          const head = markdown.slice(0, 2500).toLowerCase();
          if (
            (head.includes("403") && (head.includes("forbidden") || head.includes("access denied"))) ||
            head.includes("captcha") || head.includes("cloudflare")
          ) {
            errors.push(`${url}: Blocked`);
            continue;
          }

          const parsed = parseProduct(markdown, url, html, contextBrandSlug);
          if (!parsed || !parsed.cod_intern) { errors.push(`${url}: Parse failed`); continue; }
          if (!Number.isFinite(parsed.pret_lista) || parsed.pret_lista <= 0) {
            errors.push(`${url}: Price not parsed (${parsed.pret_lista})`);
            continue;
          }

          const categoryId = await upsertCategories(supabase, parsed.breadcrumbs);
          const result = await upsertProduct(supabase, parsed, categoryId, contextBrandSlug || "unknown", knownBrandName);

          if (!result.ok) { errors.push(`${url}: DB error - ${result.error}`); continue; }

          console.log(`OK: ${parsed.cod_intern} - ${parsed.denumire_completa} [${contextBrandSlug || "?"}]`);
          results.push({ cod_intern: parsed.cod_intern, name: parsed.denumire_completa, price: parsed.pret_lista });
        } catch (err) {
          errors.push(`${url}: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
      }

      return new Response(JSON.stringify({
        success: true, imported: results.length, errors: errors.length,
        errorDetails: errors.slice(0, 20), results,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── action: "deactivate-missing" ────────────────────────────────────────
    // Marchează ca is_active=false produsele cu brand_slug-ul dat care nu mai apar pe site
    if (action === "deactivate-missing") {
      if (!brandSlug || !urls || !Array.isArray(urls)) {
        return new Response(JSON.stringify({ success: false, error: "brandSlug and urls required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Extragem cod_intern-urile din URL-urile găsite pe site
      const foundCods = new Set(
        urls.map((u: string) => u.match(/-(\d{5,})\.html$/)?.[1]).filter(Boolean)
      );

      // Căutăm produse cu brand_slug-ul acesta care nu sunt în lista găsită
      const { data: allBrandProducts } = await supabase
        .from("products")
        .select("id, cod_intern")
        .eq("brand_slug", brandSlug)
        .eq("is_active", true);

      const toDeactivate = (allBrandProducts || []).filter((p) => !foundCods.has(p.cod_intern));

      let deactivated = 0;
      if (toDeactivate.length > 0) {
        const ids = toDeactivate.map((p) => p.id);
        const { error } = await supabase.from("products").update({ is_active: false }).in("id", ids);
        if (!error) deactivated = toDeactivate.length;
        console.log(`Deactivated ${deactivated} products for brand ${brandSlug}`);
      }

      return new Response(JSON.stringify({ success: true, deactivated }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── action: "map" (legacy — păstrat pentru compatibilitate) ────────────
    if (action === "map") {
      const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
      if (!apiKey) {
        return new Response(JSON.stringify({ success: false, error: "FIRECRAWL_API_KEY not configured" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const response = await fetch("https://api.firecrawl.dev/v1/map", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://maxbau.ro", limit: 5000, includeSubdomains: false }),
      });
      const data = await response.json();
      if (!response.ok) {
        return new Response(JSON.stringify({ success: false, error: data.error || "Map failed" }), {
          status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const productUrls = (data.links || []).filter((url: string) => /\-\d{5,}\.html$/.test(url));
      return new Response(JSON.stringify({ success: true, productUrls, total: productUrls.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: false, error: "Invalid action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});