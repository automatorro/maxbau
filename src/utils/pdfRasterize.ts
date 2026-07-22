/**
 * pdfRasterize.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Utilitar provider-agnostic pentru randare pagini PDF → JPEG base64.
 * Folosit de fluxul Vision (Anthropic) pentru planuri structurale scanate,
 * care nu au text layer extractibil via pdfjs.getTextContent().
 *
 * Scale-ul recomandat e 2.5-3.0 pentru planuri de rezistență (cote cu 2-3
 * zecimale, adnotări mici Ø8/25 etc.). Scale=2.0 riscă să piardă cifre.
 */

import * as pdfjsLib from "pdfjs-dist";

/**
 * Randează o pagină PDF la un canvas și returnează JPEG base64 (fără prefix
 * `data:image/jpeg;base64,`). Calitatea 0.90 e suficientă pentru text și
 * păstrează dimensiunea rezonabilă pentru upload.
 */
export async function renderPdfPageToJpegBase64(
  page: any,
  scale = 2.5
): Promise<string> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.90).split(",")[1];
}

/**
 * Randează TOATE paginile unui PDF ArrayBuffer la JPEG base64.
 * Callback `onProgress` primește (currentPage, totalPages) pentru progres UI.
 */
export async function rasterizePdfPages(
  pdfBuf: ArrayBuffer,
  scale = 2.5,
  onProgress?: (current: number, total: number) => void
): Promise<string[]> {
  const pdf = await pdfjsLib.getDocument({ data: pdfBuf }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    pages.push(await renderPdfPageToJpegBase64(page, scale));
    onProgress?.(p, pdf.numPages);
  }
  return pages;
}
