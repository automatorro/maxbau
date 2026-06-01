export const CORS_PROXY = "https://corsproxy.io/?";

export async function fetchWithProxy(url: string): Promise<string> {
  const res = await fetch(CORS_PROXY + encodeURIComponent(url));
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

export function parseBrandsPage(html: string): string[] {
  const slugs: string[] = [];
  const seen = new Set<string>();
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

export function parseBrandListingPage(html: string, brandSlug: string): { productUrls: string[]; totalPages: number } {
  const productUrls: string[] = [];
  const BASE_URL = "https://maxbau.ro";

  const hrefPattern = /href="([^"]*-\d{5,}\.html)"/gi;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = hrefPattern.exec(html)) !== null) {
    const href = m[1];
    if (href.includes("wishlists") || href.includes("cart") || href.includes("index.php")) continue;
    const fullUrl = href.startsWith("http") ? href : `${BASE_URL}/${href.replace(/^\//, "")}`;
    if (!seen.has(fullUrl)) {
      seen.add(fullUrl);
      productUrls.push(fullUrl);
    }
  }

  let totalPages = 1;
  const pagPattern = new RegExp(`marci/${brandSlug}/pag-(\\d+)`, "g");
  let pagMatch: RegExpExecArray | null;
  while ((pagMatch = pagPattern.exec(html)) !== null) {
    const pageNum = parseInt(pagMatch[1], 10);
    if (pageNum > totalPages) totalPages = pageNum;
  }

  return { productUrls, totalPages };
}
