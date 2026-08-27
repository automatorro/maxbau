import * as XLSX from "xlsx";
import { TVA_PERCENT, TVA_RATE } from "./utils";

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
  variant_name?: string | null;
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

function createProductsSheet(items: ExcelQuoteItem[]) {
  const hasSmartCols = items.some(
    (i) => i.cerere_initiala || i.nota_echivalenta || i.consum || i.ambalare || i.similar_cu
  );

  const headers = [
    "#",
    "Cod intern",
    "Denumire produs",
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
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  return ws;
}

export function exportQuoteToExcel(meta: ExcelQuoteMeta, items: ExcelQuoteItem[]) {
  const wb = XLSX.utils.book_new();

  // Group items by variant
  const itemsByVariant: Record<string, ExcelQuoteItem[]> = {};
  items.forEach((item) => {
    const vName = item.variant_name || "Varianta Standard";
    if (!itemsByVariant[vName]) {
      itemsByVariant[vName] = [];
    }
    itemsByVariant[vName].push(item);
  });

  const variantNames = Object.keys(itemsByVariant).filter(
    (name) => itemsByVariant[name] && itemsByVariant[name].length > 0
  );

  // If there's only one variant or no items, use standard single-sheet format
  if (variantNames.length <= 1) {
    const activeItems = itemsByVariant[variantNames[0] || "Varianta Standard"] || [];
    const ws = createProductsSheet(activeItems);
    XLSX.utils.book_append_sheet(wb, ws, "Produse ofertă");

    const sumarData = [
      ["OFERTĂ COMERCIALĂ", ""],
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
  } else {
    // Multiple variants format:
    // Tab 1: Sumar Comparativ
    const sumarData = [
      ["OFERTĂ COMERCIALĂ - COMPARATIV VARIANTE", ""],
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
      ["COMPARATIV FINANCIAR", "", "", ""],
      ["Variantă", "Total fără TVA (lei)", `TVA ${TVA_PERCENT}% (lei)`, "TOTAL CU TVA (lei)"],
    ];

    variantNames.forEach((vName) => {
      const vItems = itemsByVariant[vName];
      const totalNet = vItems.reduce((sum, item) => sum + Number(item.subtotal), 0);
      const totalTva = totalNet * ((TVA_RATE || 1.19) - 1);
      const totalGross = totalNet * (TVA_RATE || 1.19);
      sumarData.push([
        vName,
        Number(totalNet.toFixed(2)),
        Number(totalTva.toFixed(2)),
        Number(totalGross.toFixed(2)),
      ]);
    });

    sumarData.push(
      ["", "", "", ""],
      ["Prețurile sunt exprimate în lei și includ TVA.", "", "", ""],
      ["Oferta este valabilă 30 de zile de la data emiterii.", "", "", ""]
    );

    const wsSumar = XLSX.utils.aoa_to_sheet(sumarData);
    wsSumar["!cols"] = [{ wch: 30 }, { wch: 20 }, { wch: 15 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsSumar, "Sumar Comparativ");

    // Tabs 2+: One for each variant details
    variantNames.forEach((vName) => {
      const vItems = itemsByVariant[vName];
      const ws = createProductsSheet(vItems);
      // Clean sheet name: max 31 characters, remove special characters Excel doesn't allow
      const cleanName = vName.replace(/[\[\]\*\?\/\\:]/g, "").slice(0, 30);
      XLSX.utils.book_append_sheet(wb, ws, cleanName);
    });
  }

  // Generate and download file
  const fileName = `oferta_comerciala_${(meta.client_name || "client")
    .replace(/\s+/g, "_")
    .toLowerCase()}_${meta.data.replace(/\./g, "-")}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
