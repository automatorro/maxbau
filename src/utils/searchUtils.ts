/**
 * Generează variante ale unui token de căutare cu și fără diacritice românești.
 *
 * Problema: produsele în DB au diacritice ("Vată bazaltică"), dar utilizatorii
 * tastează fără ("vata bazaltica"). ilike în PostgreSQL NU ignoră accentele.
 *
 * Soluție: pentru fiecare token, generăm 2-3 variante (cu/fără diacritice) și
 * le căutăm cu OR, astfel încât ambele forme să dea rezultate corecte.
 */
export function getRomanianSearchVariants(raw: string): string[] {
  const t = raw.toLowerCase();
  const variants = new Set<string>([t]);

  // 1. Versiune fără diacritice (normalizată) — pentru că poate userul a tastat cu diacritice
  //    dar unele produse sunt stocate fără
  const stripped = t
    .replace(/[ăâ]/g, "a")
    .replace(/î/g, "i")
    .replace(/[șş]/g, "s")
    .replace(/[țţ]/g, "t");
  variants.add(stripped);

  // 2. Versiune cu diacritice generate din forma fără — sufixe românești comune
  const withDiacritics = stripped
    .replace(/atie$/, "ație")
    .replace(/utie$/, "uție")
    .replace(/itie$/, "iție")
    .replace(/ntie$/, "nție")
    .replace(/stie$/, "știe")
    .replace(/ctie$/, "cție")
    .replace(/tie$/, "ție")
    .replace(/ica$/, "ică")
    .replace(/uca$/, "ucă")
    .replace(/ata$/, "ată")
    .replace(/eta$/, "etă")
    .replace(/ita$/, "ită")
    .replace(/uta$/, "ută")
    .replace(/ura$/, "ură")
    .replace(/ina$/, "ină")
    .replace(/ana$/, "ană")
    .replace(/ena$/, "ână")   // e.g. "termoizolena" rar, dar acoperă
    .replace(/anta$/, "antă")
    .replace(/enta$/, "entă")
    .replace(/arca$/, "arcă")
    .replace(/arma$/, "armă")
    .replace(/orma$/, "ormă")
    .replace(/ulsa$/, "ulsă")
    .replace(/izola/, "izola"); // izolatie/izolatii raman la fel

  if (withDiacritics !== stripped) {
    variants.add(withDiacritics);
  }

  // 3. Prefixe îm-/în- (ex: "invelitoare" → "învelitoare")
  if (stripped.startsWith("in") && stripped.length > 4) {
    variants.add("în" + stripped.slice(2));
  }
  if (stripped.startsWith("im") && stripped.length > 4) {
    variants.add("îm" + stripped.slice(2));
  }

  // Escape virgule pentru PostgREST
  return Array.from(variants).map((v) => v.replace(/,/g, "\\,"));
}

/**
 * Construiește lista de condiții OR pentru o căutare accent-insensitivă
 * pe coloanele: denumire_completa, cod_intern, brand, brand_slug.
 *
 * Returnează un string gata de folosit în `.or(...)` din supabase-js.
 */
export function buildSearchOrConditions(raw: string): string {
  const variants = getRomanianSearchVariants(raw);
  return variants
    .flatMap((v) => [
      `denumire_completa.ilike.%${v}%`,
      `cod_intern.ilike.%${v}%`,
      `brand.ilike.%${v}%`,
      `brand_slug.ilike.%${v}%`,
    ])
    .join(",");
}
