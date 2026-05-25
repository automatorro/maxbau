import * as XLSX from "xlsx";
import { TVA_PERCENT } from "./utils";

export interface ExcelQuoteItem {
  cod_intern: string;
  denumire: string;
  cerere_initiala?: string | null;
  nota_echivalenta?: string | null;
  consum?: string | null;
  ambalare?: string | null;
  similar_cu?: string | null;
  quantity: number;
  unit: string;
  pret_unitar: number;
  discount_percent: number;
  pret_final: number;
  subtotal: number;
}

export interface ExcelQuoteMeta {
  nr_oferta?: string;
  data: string;
  client_name?: string | null;
  client_phone?: string | null;
  client_email?: string | null;
  project_description?: string | null;
  total_net: number;
  total_tva: number;
  total_gross: number;
}

export function exportQuoteToExcel(meta: ExcelQuoteMeta, items: ExcelQuoteItem[]) {
  const wb = XLSX.utils.book_new();

  // ── Tab 1: Produse ────────────────────────────────────────────────────────
  const hasSmartCols = items.some(
    (i) => i.cerere_initiala || i.nota_echivalenta || i.consum || i.ambalare || i.similar_cu
  );

  const headers = [
    "#",
    "Cod intern",
    "Denumire produs MaxBau",
    ...(hasSmartCols
      ? ["Cerere client", "Similar cu", "Consum orientativ", "Ambalare", "Notă echivalență"]
      : []),
    "Cantitate",
    "UM",
    "Preț/UM (lei)",
    "Disc. %",
    "Preț final/UM (lei)",
    "Subtotal (lei)",
  ];

  const rows = items.map((item, i) => [
    i + 1,
    item.cod_intern,
    item.denumire,
    ...(hasSmartCols
      ? [
          item.cerere_initiala || "",
          item.similar_cu || "",
          item.consum || "",
          item.ambalare || "",
          item.nota_echivalenta || "",
        ]
      : []),
    item.quantity,
    item.unit,
    item.pret_unitar,
    item.discount_percent,
    item.pret_final,
    item.subtotal,
  ]);

  const wsData = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Lățimi coloane
  const colWidths = [
    { wch: 4 },   // #
    { wch: 12 },  // Cod intern
    { wch: 38 },  // Denumire
    ...(hasSmartCols
      ? [
          { wch: 28 }, // Cerere client
          { wch: 28 }, // Similar cu
          { wch: 18 }, // Consum
          { wch: 16 }, // Ambalare
          { wch: 32 }, // Notă echivalență
        ]
      : []),
    { wch: 10 }, // Cantitate
    { wch: 6 },  // UM
    { wch: 14 }, // Preț/UM
    { wch: 8 },  // Disc
    { wch: 16 }, // Preț final
    { wch: 14 }, // Subtotal
  ];
  ws["!cols"] = colWidths;

  // Stil header (bold prin formatare specială — xlsx open-source nu suportă stiluri,
  // dar setăm freeze pe primul rând)
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  XLSX.utils.book_append_sheet(wb, ws, "Produse ofertă");

  // ── Tab 2: Sumar ──────────────────────────────────────────────────────────
  const sumarData = [
    ["OFERTĂ MAXBAU", ""],
    ["", ""],
    ["Nr. ofertă", meta.nr_oferta || "—"],
    ["Data", meta.data],
    ["", ""],
    ["CLIENT", ""],
    ["Nume / Firmă", meta.client_name || "—"],
    ["Telefon", meta.client_phone || "—"],
    ["Email", meta.client_email || "—"],
    ["Proiect / Descriere", meta.project_description || "—"],
    ["", ""],
    ["TOTAL", ""],
    ["Total fără TVA (lei)", meta.total_net],
    [`TVA ${TVA_PERCENT}% (lei)`, meta.total_tva],
    ["TOTAL CU TVA (lei)", meta.total_gross],
    ["", ""],
    ["Prețurile sunt exprimate în lei și includ TVA conform rândului de mai sus.", ""],
    ["Oferta este valabilă 30 de zile de la data emiterii.", ""],
  ];

  const wsSumar = XLSX.utils.aoa_to_sheet(sumarData);
  wsSumar["!cols"] = [{ wch: 30 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsSumar, "Sumar");

  // Generare și descărcare
  const fileName = `oferta_maxbau_${(meta.client_name || "client").replace(/\s+/g, "_").toLowerCase()}_${meta.data.replace(/\./g, "-")}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
