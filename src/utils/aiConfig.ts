/**
 * aiConfig.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Configurare centralizată a modelelor Anthropic folosite în aplicație.
 *
 * ⚠️ NU HARDCODEA MODELE ÎN ALTĂ PARTE. Toate apelurile către callAiProxy(...)
 * trebuie să importe una dintre constantele de mai jos.
 *
 * De ce: modelul `claude-3-5-sonnet-20241022` a fost RETRAS din API pe
 * 28 octombrie 2025 (deprecare din august 2025). Deoarece fusese hardcodat în
 * 5 locații diferite, retragerea a produs eșecuri silențioase în producție
 * timp de luni de zile — mascate de fallback-ul pe Gemini pe unele fluxuri,
 * dar vizibile ca 500-uri directe pe fluxurile Vision noi (fără fallback).
 *
 * Regula: alegerea de model pentru fiecare flux se face EXPLICIT aici,
 * documentat, nu accidental prin copy-paste între fișiere.
 */

/**
 * Model pentru extractoare Vision (imagini planuri structurale scanate,
 * imagini liste prețuri WhatsApp). Calitate critică — o eroare de citire
 * pe cifre mici sau text rotit poate produce comandă greșită de materiale.
 * Sonnet 5 acceptă imagini high-res (până la 2576px long edge) și e
 * substantial mai bun la text rotit decât sonnet 3.5.
 */
export const ANTHROPIC_VISION_MODEL = "claude-sonnet-5";

/**
 * Model pentru extragere de tabel/structură din text (deviz tabular, plan
 * finisaje cu text layer, Extras de armătură cu text layer nativ). Aceeași
 * cerință de acuratețe ca la Vision — sunt aceleași cantități în joc, doar
 * sursa datelor diferă. Ține-le identice ca să nu ai discrepanțe surprinzătoare
 * între „PDF cu text" și „PDF scanat" pe același proiect.
 */
export const ANTHROPIC_TEXT_MODEL = "claude-sonnet-5";

/**
 * Buget de tokens pentru extractoare (răspuns AI). Extras-urile mari pot
 * genera JSON de 3-5k tokens; lăsăm loc generos.
 */
export const ANTHROPIC_MAX_TOKENS_EXTRACT = 8192;

/**
 * Buget mai mic pentru task-uri de clasificare/casetă materiale (răspuns scurt).
 */
export const ANTHROPIC_MAX_TOKENS_CLASSIFY = 2048;
