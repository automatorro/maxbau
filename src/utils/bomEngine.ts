/**
 * bomEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor de expandare specificații → sisteme complete de materiale (BOM).
 *
 * Flux:
 *   PlanData
 *     → matchSystems()          — găsește ce sisteme se aplică per spațiu
 *     → expandToBOM()           — expandează în BOMItem[] cu cantități calculate
 *     → bomToExtractedItems()   — convertește în formatul ExtractedItem existent
 */

import type {
  PlanData,
  PlanSpace,
  MaterialSystem,
  SystemComponent,
  RoomContext,
  BOMItem,
} from "@/types/planTypes";

// ── Biblioteca de sisteme ─────────────────────────────────────────────────────

export const MATERIAL_SYSTEMS: MaterialSystem[] = [

  // ══════════════════════════════════════════════════════
  // PARDOSELI
  // ══════════════════════════════════════════════════════

  {
    id: "gresie_antiderapanta_interior",
    name: "Pardoseală gresie antiderapantă interior",
    triggers: ["gresie antiderapantă de interior", "gresie antiderapanta de interior",
                "gresie antiderapantă interior", "gresie antiderapanta"],
    planTypes: ["finisaje_rezidential", "finisaje_public", "mixt"],
    components: [
      {
        role: "material_principal", label: "Gresie antiderapantă interior R10/R11",
        searchTerms: ["gresie antiderapantă interior R10 R11 slip resistant"],
        quantityFormula: ctx => round2(ctx.S * 1.10),
        unit: "mp", isOptional: false, defaultSelected: true,
      },
      {
        role: "adeziv", label: "Adeziv flex gresie C2TE",
        searchTerms: ["adeziv flex gresie C2TE adeziv gresie"],
        quantityFormula: ctx => round2(ctx.S * 1.8),
        unit: "kg", isOptional: false, defaultSelected: true,
      },
      {
        role: "amorsa", label: "Amorsa grunduit pardoseală",
        searchTerms: ["amorsa contact grunduit pardoseala gresie"],
        quantityFormula: ctx => round2(ctx.S),
        unit: "mp", isOptional: false, defaultSelected: true,
      },
      {
        role: "rosturi", label: "Chit rost gresie epoxidic 3mm",
        searchTerms: ["chit rost gresie epoxidic 3mm fugă"],
        quantityFormula: ctx => round2(ctx.S * 0.35),
        unit: "kg", isOptional: false, defaultSelected: true,
      },
      {
        role: "hidroizolatie", label: "Hidroizolație zonă umedă",
        searchTerms: ["hidroizolatie zona umeda membrană etanșare"],
        quantityFormula: ctx => round2(ctx.S + ctx.perimeter * 0.30),
        unit: "mp", isOptional: true, defaultSelected: false,
        condition: ctx => ctx.isWetRoom,
      },
      {
        role: "profil_dilatatie", label: "Profil dilatație gresie",
        searchTerms: ["profil dilatație expansiune gresie pardoseala"],
        quantityFormula: ctx => round2(ctx.perimeter * 0.25),
        unit: "ml", isOptional: true, defaultSelected: false,
      },
    ],
  },

  {
    id: "gresie_antiderapanta_exterior",
    name: "Pardoseală gresie antiderapantă exterior",
    triggers: ["gresie antiderapantă de exterior", "gresie antiderapanta de exterior",
                "gresie antiderapantă exterior", "gresie exterior"],
    planTypes: ["finisaje_rezidential", "finisaje_public", "mixt"],
    components: [
      {
        role: "material_principal", label: "Gresie antiderapantă exterior R11/R12 frost",
        searchTerms: ["gresie antiderapantă exterior R11 R12 frost îngheț terasa"],
        quantityFormula: ctx => round2(ctx.S * 1.10),
        unit: "mp", isOptional: false, defaultSelected: true,
      },
      {
        role: "adeziv", label: "Adeziv flex exterior C2F",
        searchTerms: ["adeziv flex exterior C2F frost rezistent îngheț"],
        quantityFormula: ctx => round2(ctx.S * 2.0),
        unit: "kg", isOptional: false, defaultSelected: true,
      },
      {
        role: "amorsa", label: "Amorsa contact exterior",
        searchTerms: ["amorsa contact grunduit exterior"],
        quantityFormula: ctx => round2(ctx.S),
        unit: "mp", isOptional: false, defaultSelected: true,
      },
      {
        role: "rosturi", label: "Chit rost exterior flexibil",
        searchTerms: ["chit rost gresie exterior flexibil frost"],
        quantityFormula: ctx => round2(ctx.S * 0.40),
        unit: "kg", isOptional: false, defaultSelected: true,
      },
    ],
  },

  {
    id: "gresie_interior",
    name: "Pardoseală gresie de interior",
    triggers: ["gresie de interior", "gresie interioara", "gresie portelanata",
                "gresie rectificata", "gresie"],
    planTypes: ["finisaje_rezidential", "finisaje_public", "mixt"],
    components: [
      {
        role: "material_principal", label: "Gresie de interior",
        searchTerms: ["gresie interior porțelanată rectificată"],
        quantityFormula: ctx => round2(ctx.S * 1.10),
        unit: "mp", isOptional: false, defaultSelected: true,
      },
      {
        role: "adeziv", label: "Adeziv gresie C1 standard",
        searchTerms: ["adeziv gresie C1 standard"],
        quantityFormula: ctx => round2(ctx.S * 1.5),
        unit: "kg", isOptional: false, defaultSelected: true,
      },
      {
        role: "amorsa", label: "Amorsa grunduit pardoseală",
        searchTerms: ["amorsa contact grunduit pardoseala"],
        quantityFormula: ctx => round2(ctx.S),
        unit: "mp", isOptional: false, defaultSelected: true,
      },
      {
        role: "rosturi", label: "Chit rost gresie 3mm",
        searchTerms: ["chit rost gresie fugă 3mm"],
        quantityFormula: ctx => round2(ctx.S * 0.30),
        unit: "kg", isOptional: false, defaultSelected: true,
      },
    ],
  },

  {
    id: "parchet_laminat",
    name: "Pardoseală parchet laminat",
    triggers: ["parchet laminat", "parchet", "parchet flotant"],
    planTypes: ["finisaje_rezidential", "finisaje_public", "mixt"],
    components: [
      {
        role: "material_principal", label: "Parchet laminat AC4/AC5 8mm",
        searchTerms: ["parchet laminat AC4 AC5 8mm rezistent trafic"],
        quantityFormula: ctx => round2(ctx.S * 1.08),
        unit: "mp", isOptional: false, defaultSelected: true,
      },
      {
        role: "folie", label: "Folie barieră vapori 0.2mm",
        searchTerms: ["folie polietilenă barieră vapori 0.2mm parchet"],
        quantityFormula: ctx => round2(ctx.S * 1.10),
        unit: "mp", isOptional: false, defaultSelected: true,
      },
      {
        role: "sapa_autonivelanta", label: "Șapă autonivelantă (dacă e nevoie de nivelare)",
        searchTerms: ["sapa autonivelanta pardoseala nivelat"],
        quantityFormula: ctx => round2(ctx.S * 4.5),
        unit: "kg", isOptional: true, defaultSelected: false,
      },
      {
        role: "profil_tranzitie", label: "Profil tranziție parchet-gresie",
        searchTerms: ["profil tranziție trecere parchet gresie aluminiu"],
        quantityFormula: _ => 1,
        unit: "buc", isOptional: true, defaultSelected: true,
      },
      {
        role: "pervaz", label: "Plintă / pervaz parchet",
        searchTerms: ["plintă pervaz parchet laminat"],
        quantityFormula: ctx => round2(ctx.perimeter),
        unit: "ml", isOptional: true, defaultSelected: false,
      },
    ],
  },

  {
    id: "pardoseala_industriala",
    name: "Pardoseală industrială epoxidică",
    triggers: ["pardoseală industrială", "pardoseala industriala", "epoxid",
                "rășină epoxidică", "rasina epoxidica", "beton sclivisit"],
    planTypes: ["industrial", "mixt"],
    components: [
      {
        role: "grunduit", label: "Grund epoxidic bicomponent",
        searchTerms: ["grund epoxidic bicomponent pardoseala industriala"],
        quantityFormula: ctx => round2(ctx.S * 0.20),
        unit: "kg", isOptional: false, defaultSelected: true,
      },
      {
        role: "material_principal", label: "Rășină epoxidică autonivelantă",
        searchTerms: ["rășină epoxidică autonivelantă pardoseală industrială"],
        quantityFormula: ctx => round2(ctx.S * 0.35),
        unit: "kg", isOptional: false, defaultSelected: true,
      },
      {
        role: "cuart", label: "Cuarț pentru strat de uzură (opțional)",
        searchTerms: ["cuarț nisip strat uzură pardoseală"],
        quantityFormula: ctx => round2(ctx.S * 3.0),
        unit: "kg", isOptional: true, defaultSelected: false,
      },
    ],
  },

  {
    id: "beton_pardoseala",
    name: "Pardoseală beton / șapă ciment",
    triggers: ["beton", "sapa ciment", "șapă ciment", "beton sclivisit"],
    planTypes: ["industrial", "structural", "subsol", "mixt"],
    components: [
      {
        role: "sapa", label: "Șapă de ciment M100",
        searchTerms: ["sapa ciment M100 pardoseala beton"],
        quantityFormula: ctx => round2(ctx.S * 20), // ~4cm grosime = 20kg/mp
        unit: "kg", isOptional: false, defaultSelected: true,
      },
      {
        role: "plasa_armare", label: "Plasă sudata armare șapă",
        searchTerms: ["plasă sudată armare pardoseală beton"],
        quantityFormula: ctx => round2(ctx.S),
        unit: "mp", isOptional: true, defaultSelected: false,
      },
    ],
  },

  // ══════════════════════════════════════════════════════
  // PEREȚI
  // ══════════════════════════════════════════════════════

  {
    id: "faianta_perete",
    name: "Finisaj perete faianță",
    triggers: ["faianță", "faianta", "faianța", "faianta perete"],
    planTypes: ["finisaje_rezidential", "finisaje_public", "mixt"],
    components: [
      {
        role: "material_principal", label: "Faianță",
        searchTerms: ["faianță baie bucătărie perete"],
        quantityFormula: ctx => round2(ctx.perimeter * ctx.hFinisaj * 1.10),
        unit: "mp", isOptional: false, defaultSelected: true,
      },
      {
        role: "adeziv", label: "Adeziv flex faianță C1",
        searchTerms: ["adeziv flex faianță C1 gresie perete"],
        quantityFormula: ctx => round2(ctx.perimeter * ctx.hFinisaj * 1.4),
        unit: "kg", isOptional: false, defaultSelected: true,
      },
      {
        role: "amorsa", label: "Amorsa perete interior",
        searchTerms: ["amorsa contact perete interior"],
        quantityFormula: ctx => round2(ctx.perimeter * ctx.hFinisaj),
        unit: "mp", isOptional: false, defaultSelected: true,
      },
      {
        role: "rosturi", label: "Chit rost faianță 2-3mm",
        searchTerms: ["chit rost faianță 2mm 3mm fugă perete"],
        quantityFormula: ctx => round2(ctx.perimeter * ctx.hFinisaj * 0.30),
        unit: "kg", isOptional: false, defaultSelected: true,
      },
      {
        role: "profil_colt", label: "Profil colț PVC/aluminiu faianță",
        searchTerms: ["profil colț PVC aluminiu faianță gresie perete"],
        quantityFormula: ctx => round2(ctx.hFinisaj * 4),
        unit: "ml", isOptional: true, defaultSelected: true,
      },
      {
        role: "hidroizolatie", label: "Hidroizolație sub faianță (zonă umedă)",
        searchTerms: ["hidroizolație membrană sub faianță zonă umedă"],
        quantityFormula: ctx => round2(ctx.perimeter * ctx.hFinisaj),
        unit: "mp", isOptional: true, defaultSelected: false,
        condition: ctx => ctx.isWetRoom,
      },
    ],
  },

  {
    id: "vopsea_lavabila",
    name: "Finisaj perete vopsea lavabilă",
    triggers: ["vopsea lavabilă", "vopsea lavabila", "vopsea pe baza de ulei",
                "vopsea", "zugraveli", "zugrăveli"],
    planTypes: ["finisaje_rezidential", "finisaje_public", "mixt"],
    components: [
      {
        role: "grunduit", label: "Grunduit / amorsa perete",
        searchTerms: ["grunduit amorsa perete interior vopsea"],
        quantityFormula: ctx => round2(ctx.perimeter * ctx.hFinisaj),
        unit: "mp", isOptional: false, defaultSelected: true,
      },
      {
        role: "glet", label: "Glet / chit finisaj perete",
        searchTerms: ["glet chit finisaj perete interior"],
        quantityFormula: ctx => round2(ctx.perimeter * ctx.hFinisaj * 0.8),
        unit: "kg", isOptional: true, defaultSelected: true,
      },
      {
        role: "material_principal", label: "Vopsea lavabilă interior",
        searchTerms: ["vopsea lavabilă interior albă"],
        quantityFormula: ctx => round2(ctx.perimeter * ctx.hFinisaj * 0.25),
        unit: "L", isOptional: false, defaultSelected: true,
      },
    ],
  },

  {
    id: "tencuiala_decorativa",
    name: "Finisaj perete tencuială decorativă",
    triggers: ["tencuială decorativă", "tencuiala decorativa", "tencuiala"],
    planTypes: ["finisaje_rezidential", "finisaje_public", "mixt"],
    components: [
      {
        role: "grunduit", label: "Grunduit perete",
        searchTerms: ["grunduit amorsa perete tencuiala"],
        quantityFormula: ctx => round2(ctx.perimeter * ctx.hFinisaj),
        unit: "mp", isOptional: false, defaultSelected: true,
      },
      {
        role: "material_principal", label: "Tencuială decorativă",
        searchTerms: ["tencuiala decorativa interior exterior"],
        quantityFormula: ctx => round2(ctx.perimeter * ctx.hFinisaj * 2.5),
        unit: "kg", isOptional: false, defaultSelected: true,
      },
    ],
  },

  // ══════════════════════════════════════════════════════
  // TAVANE
  // ══════════════════════════════════════════════════════

  {
    id: "tavan_casetat",
    name: "Tavan casetat 600×600",
    triggers: ["tavan casetat", "tavan armstrong", "tavan modular",
                "tavan demontabil", "plafon casetat"],
    planTypes: ["finisaje_rezidential", "finisaje_public", "industrial", "mixt"],
    components: [
      {
        role: "placi", label: "Plăci tavan casetat 600×600",
        searchTerms: ["placi tavan casetat 600x600 mineral casoprano ecophon"],
        quantityFormula: ctx => round2(ctx.S * 1.0),
        unit: "mp", isOptional: false, defaultSelected: true,
      },
      {
        role: "profil_principal", label: "SDT 200 T24 - Main Runner 3600mm",
        searchTerms: ["profil T24 principal tavan suspendat 3600mm main runner"],
        quantityFormula: ctx => round2(ctx.S * 1.0),
        unit: "ml", isOptional: false, defaultSelected: true,
      },
      {
        role: "profil_secundar_1200", label: "SDT 200 T24 - Cross Tee 1200mm",
        searchTerms: ["profil T24 secundar 1200mm cross tee tavan casetat"],
        quantityFormula: ctx => round2(ctx.S * 1.5),
        unit: "ml", isOptional: false, defaultSelected: true,
      },
      {
        role: "profil_secundar_600", label: "SDT 200 T24 - Cross Tee 600mm",
        searchTerms: ["profil T24 secundar 600mm cross tee tavan casetat"],
        quantityFormula: ctx => round2(ctx.S * 0.8),
        unit: "ml", isOptional: false, defaultSelected: true,
      },
      {
        role: "profil_perete", label: "SDT 200 T24 - Wall Angle 3000mm",
        searchTerms: ["profil perete L tavan suspendat wall angle"],
        quantityFormula: ctx => round2(ctx.perimeter * 1.0),
        unit: "ml", isOptional: false, defaultSelected: true,
      },
      {
        role: "ancora", label: "Ancoră metalică 6/40",
        searchTerms: ["ancora metalica 6/40 suspendare plafon"],
        quantityFormula: ctx => Math.ceil(ctx.S * 1.0),
        unit: "buc", isOptional: false, defaultSelected: true,
      },
      {
        role: "tija_ochi", label: "Tijă lisă de suspendare cu ochi ø 4 mm",
        searchTerms: ["tija ochi rigips suspendare 500mm"],
        quantityFormula: ctx => Math.ceil(ctx.S * 1.0),
        unit: "buc", isOptional: false, defaultSelected: true,
      },
      {
        role: "tija_carlig", label: "Tijă lisă de suspendare cu cârlig ø 4 mm",
        searchTerms: ["tija carlig rigips suspendare 500mm"],
        quantityFormula: ctx => Math.ceil(ctx.S * 1.0),
        unit: "buc", isOptional: false, defaultSelected: true,
      },
      {
        role: "prelungitor_fluture", label: "Prelungitor fluture suspendare",
        searchTerms: ["prelungitor fluture suspendare rigips tije"],
        quantityFormula: ctx => Math.ceil(ctx.S * 1.0),
        unit: "buc", isOptional: false, defaultSelected: true,
      },
      {
        role: "surub_diblu", label: "Șurub Rigips cu diblu plastic ø 6 x L=45 mm",
        searchTerms: ["surub diblu plastic 6x45 6x40 perimetru"],
        quantityFormula: ctx => Math.ceil(ctx.perimeter * 3.0),
        unit: "buc", isOptional: false, defaultSelected: true,
      },
    ],
  },

  {
    id: "tavan_rigips",
    name: "Tavan fals rigips",
    triggers: ["tavan rigips", "tavan fals rigips", "tavan fals", "plafon rigips"],
    planTypes: ["finisaje_rezidential", "finisaje_public", "mixt"],
    components: [
      {
        role: "placa", label: "Placă rigips GKB 12.5mm",
        searchTerms: ["placă rigips GKB gips carton 12.5mm tavan"],
        quantityFormula: ctx => round2(ctx.S * 1.10),
        unit: "mp", isOptional: false, defaultSelected: true,
      },
      {
        role: "profil_cd", label: "Profil CD 60 tavan",
        searchTerms: ["profil CD 60 rigips tavan"],
        quantityFormula: ctx => round2(ctx.S / 0.5),
        unit: "ml", isOptional: false, defaultSelected: true,
      },
      {
        role: "profil_ud", label: "Profil UD 28 perimetru",
        searchTerms: ["profil UD 28 rigips perimetru"],
        quantityFormula: ctx => round2(ctx.perimeter),
        unit: "ml", isOptional: false, defaultSelected: true,
      },
      {
        role: "cuier", label: "Cuier direct CD",
        searchTerms: ["cuier direct CD rigips suspendare"],
        quantityFormula: ctx => Math.ceil(ctx.S / 0.9),
        unit: "buc", isOptional: false, defaultSelected: true,
      },
      {
        role: "suruburi", label: "Șuruburi rigips",
        searchTerms: ["șuruburi rigips autoperforante"],
        quantityFormula: ctx => Math.ceil(ctx.S * 12),
        unit: "buc", isOptional: false, defaultSelected: true,
      },
      {
        role: "banda_chit", label: "Bandă hârtie armare + chit",
        searchTerms: ["bandă hârtie armare rigips chit îmbinare"],
        quantityFormula: ctx => round2(ctx.S / 1.2),
        unit: "ml", isOptional: false, defaultSelected: true,
      },
      {
        role: "glet_tavan", label: "Glet / vopsea tavan",
        searchTerms: ["glet finisaj tavan vopsea lavabilă"],
        quantityFormula: ctx => round2(ctx.S * 0.5),
        unit: "kg", isOptional: true, defaultSelected: true,
      },
    ],
  },

  // ══════════════════════════════════════════════════════
  // ZIDĂRIE
  // ══════════════════════════════════════════════════════

  {
    id: "zidarie_caramida",
    name: "Zidărie cărămidă / BCA",
    triggers: ["zid", "zidărie", "cărămidă", "caramida", "bca", "bloc ceramic",
                "perete zidărie", "perete portant"],
    planTypes: ["structural", "finisaje_rezidential", "finisaje_public", "mixt"],
    components: [
      {
        role: "material_principal", label: "Cărămidă / Bloc BCA (volum calculat la grosime 25cm)",
        searchTerms: ["cărămidă bloc ceramic BCA zidărie perete"],
        quantityFormula: ctx => round2(ctx.S * 0.25 * 0.75), // volum cu goluri ~75%
        unit: "mc", isOptional: false, defaultSelected: true,
      },
      {
        role: "mortar", label: "Mortar zidărie M5/M10",
        searchTerms: ["mortar zidărie M5 M10 ciment"],
        quantityFormula: ctx => round2(ctx.S * 0.25 * 0.25),
        unit: "mc", isOptional: false, defaultSelected: true,
      },
      {
        role: "plasa_armare", label: "Plasă armare zidărie",
        searchTerms: ["plasă armare zidărie rânduieli"],
        quantityFormula: ctx => round2(ctx.S),
        unit: "mp", isOptional: true, defaultSelected: false,
      },
      {
        role: "tencuiala_int", label: "Tencuială interioară",
        searchTerms: ["tencuiala interioară drișcuita perete"],
        quantityFormula: ctx => round2(ctx.S * 2), // ambele fețe
        unit: "mp", isOptional: true, defaultSelected: false,
      },
    ],
  },

  // ══════════════════════════════════════════════════════
  // TERMOSISTEM
  // ══════════════════════════════════════════════════════

  {
    id: "termosistem_vata_minerala",
    name: "Termosistem vată minerală bazaltică",
    triggers: ["termosistem vată", "termosistem vata", "vată minerală",
                "vata minerala", "izolație termică vată", "termosistem"],
    planTypes: ["finisaje_rezidential", "finisaje_public", "industrial", "mixt"],
    components: [
      {
        role: "material_principal", label: "Vată minerală bazaltică (100-150mm)",
        searchTerms: ["vată minerală bazaltică termosistem 100mm 120mm 150mm"],
        quantityFormula: ctx => round2(ctx.S * 1.05),
        unit: "mp", isOptional: false, defaultSelected: true,
      },
      {
        role: "adeziv", label: "Adeziv termosistem vată",
        searchTerms: ["adeziv termosistem vată minerală"],
        quantityFormula: ctx => round2(ctx.S * 5.0),
        unit: "kg", isOptional: false, defaultSelected: true,
      },
      {
        role: "dibluri", label: "Dibluri termosistem cu șaibă",
        searchTerms: ["dibluri termosistem șaibă expandare plastic"],
        quantityFormula: ctx => Math.ceil(ctx.S * 6),
        unit: "buc", isOptional: false, defaultSelected: true,
      },
      {
        role: "plasa", label: "Plasă fibră sticlă 160g",
        searchTerms: ["plasă fibră sticlă 160g termosistem armare"],
        quantityFormula: ctx => round2(ctx.S * 1.10),
        unit: "mp", isOptional: false, defaultSelected: true,
      },
      {
        role: "tencuiala_baza", label: "Tencuială de bază armată",
        searchTerms: ["tencuiala baza armata termosistem"],
        quantityFormula: ctx => round2(ctx.S * 4.0),
        unit: "kg", isOptional: false, defaultSelected: true,
      },
      {
        role: "grund_final", label: "Grund siliconic / acrilic",
        searchTerms: ["grund siliconic acrilic tencuiala decorativa"],
        quantityFormula: ctx => round2(ctx.S * 0.15),
        unit: "L", isOptional: false, defaultSelected: true,
      },
      {
        role: "tencuiala_finala", label: "Tencuială decorativă finală",
        searchTerms: ["tencuiala decorativa siliconica fatada"],
        quantityFormula: ctx => round2(ctx.S * 3.5),
        unit: "kg", isOptional: false, defaultSelected: true,
      },
      {
        role: "profile_colt", label: "Profile colț exterior + profile soclu",
        searchTerms: ["profil colț exterior PVC aluminiu termosistem"],
        quantityFormula: ctx => round2(ctx.perimeter),
        unit: "ml", isOptional: true, defaultSelected: true,
      },
    ],
  },

  {
    id: "termosistem_polistiren",
    name: "Termosistem polistiren expandat EPS",
    triggers: ["termosistem polistiren", "polistiren", "eps", "polistiren expandat"],
    planTypes: ["finisaje_rezidential", "finisaje_public", "mixt"],
    components: [
      {
        role: "material_principal", label: "Polistiren expandat EPS (100-150mm)",
        searchTerms: ["polistiren expandat EPS 100mm 150mm izolatie"],
        quantityFormula: ctx => round2(ctx.S * 1.05),
        unit: "mp", isOptional: false, defaultSelected: true,
      },
      {
        role: "adeziv", label: "Adeziv polistiren",
        searchTerms: ["adeziv polistiren termosistem"],
        quantityFormula: ctx => round2(ctx.S * 4.5),
        unit: "kg", isOptional: false, defaultSelected: true,
      },
      {
        role: "dibluri", label: "Dibluri cu cap lat polistiren",
        searchTerms: ["dibluri cap lat plastic polistiren termosistem"],
        quantityFormula: ctx => Math.ceil(ctx.S * 6),
        unit: "buc", isOptional: false, defaultSelected: true,
      },
      {
        role: "plasa", label: "Plasă fibră sticlă 145g",
        searchTerms: ["plasă fibră sticlă 145g armare"],
        quantityFormula: ctx => round2(ctx.S * 1.10),
        unit: "mp", isOptional: false, defaultSelected: true,
      },
      {
        role: "tencuiala_baza", label: "Tencuială de bază armată",
        searchTerms: ["tencuiala baza armata polistiren"],
        quantityFormula: ctx => round2(ctx.S * 4.0),
        unit: "kg", isOptional: false, defaultSelected: true,
      },
      {
        role: "tencuiala_finala", label: "Tencuială decorativă finală",
        searchTerms: ["tencuiala decorativa fatada exterior"],
        quantityFormula: ctx => round2(ctx.S * 3.5),
        unit: "kg", isOptional: false, defaultSelected: true,
      },
    ],
  },

  // ══════════════════════════════════════════════════════
  // ACOPERIȘ
  // ══════════════════════════════════════════════════════

  {
    id: "terasa_necirculabila",
    name: "Terasă necirculabilă — sistem complet",
    triggers: ["terasa necirculabila", "terasă necirculabilă", "terasa", "acoperis plat"],
    planTypes: ["acoperis", "mixt"],
    components: [
      {
        role: "bariera_vapori", label: "Barieră vapori",
        searchTerms: ["barieră vapori terasă polietilenă"],
        quantityFormula: ctx => round2(ctx.S * 1.10),
        unit: "mp", isOptional: false, defaultSelected: true,
      },
      {
        role: "izolatie_termica", label: "Termoizolație polistiren extrudat XPS",
        searchTerms: ["polistiren extrudat XPS terasa termoizolatie"],
        quantityFormula: ctx => round2(ctx.S * 1.05),
        unit: "mp", isOptional: false, defaultSelected: true,
      },
      {
        role: "membrana_hidro", label: "Membrană hidroizolație bituminoasă",
        searchTerms: ["membrană bituminoasă SBS APP hidroizolație terasă"],
        quantityFormula: ctx => round2(ctx.S * 1.15),
        unit: "mp", isOptional: false, defaultSelected: true,
      },
      {
        role: "primer", label: "Primer / grund bituminos",
        searchTerms: ["primer grund bituminos terasă"],
        quantityFormula: ctx => round2(ctx.S * 0.3),
        unit: "L", isOptional: false, defaultSelected: true,
      },
    ],
  },
];

// ── Utilități ─────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ș/g, "s").replace(/ț/g, "t")
    .replace(/ă/g, "a").replace(/â/g, "a").replace(/î/g, "i")
    .trim();
}

/** Returnează sistemele aplicabile unui text de specificație */
export function matchSystemsForSpec(spec: string): MaterialSystem[] {
  const norm = normalize(spec);
  return MATERIAL_SYSTEMS.filter(sys =>
    sys.triggers.some(trigger => norm.includes(normalize(trigger)))
  );
}

/** Construiește contextul de calcul pentru un spațiu */
function buildContext(space: PlanSpace): RoomContext {
  const H = space.heightM ?? 2.80;
  // Dacă nu avem perimetru calculat, estimăm dintr-un dreptunghi echivalent
  const perimeter = space.perimeterM
    ?? round2(2 * Math.sqrt(space.areaSqm) * (1 + 0.2)); // aproximare
  return {
    S: space.areaSqm,
    perimeter,
    H,
    hFinisaj: space.pereti?.hFinisaj ?? Math.min(H, 2.60),
    isWetRoom: space.isWetRoom,
    spaceName: space.name,
  };
}

// ── API principal ─────────────────────────────────────────────────────────────

let _idCounter = 0;
function uid(): string {
  return `bom_${Date.now()}_${_idCounter++}`;
}

/**
 * Expandează PlanData → BOMItem[] cu cantitățile calculate.
 * `selectedSystemIds` = lista ID-urilor de sisteme de inclus (null = toate)
 */
export function expandToBOM(
  planData: PlanData,
  selectedSystemIds?: string[] | null
): BOMItem[] {
  const result: BOMItem[] = [];

  // ── Spații cu finisaje ──────────────────────────────────────────────────────
  for (const space of planData.spaces) {
    const ctx = buildContext(space);

    // Colectăm toate specificațiile spațiului
    const specs: Array<{ text: string; hFinisajOverride?: number }> = [];

    if (space.pardoseala) specs.push({ text: space.pardoseala });
    if (space.tavan) specs.push({ text: space.tavan });
    if (space.pereti?.finisaj) {
      specs.push({
        text: space.pereti.finisaj,
        hFinisajOverride: space.pereti.hFinisaj,
      });
    }

    for (const spec of specs) {
      const systems = matchSystemsForSpec(spec.text);
      if (!systems.length) {
        // Niciun sistem matched — adăugăm ca item simplu pentru review
        result.push({
          id: uid(),
          spaceName: space.name,
          systemId: "manual",
          systemName: "Specificație neidentificată",
          role: "manual",
          descriere: spec.text,
          searchTerms: [spec.text],
          cantitate: space.areaSqm,
          unit: "mp",
          selected: true,
          isOptional: false,
          needsReview: true,
          reviewReason: `Specificație "${spec.text}" — sistem nedefinit. Adăugați manual materialele.`,
        });
        continue;
      }

      for (const system of systems) {
        if (selectedSystemIds && !selectedSystemIds.includes(system.id)) continue;

        // Override hFinisaj dacă vine din specificația de perete
        const ctxForSystem: RoomContext = spec.hFinisajOverride
          ? { ...ctx, hFinisaj: spec.hFinisajOverride }
          : ctx;

        for (const comp of system.components) {
          // Verificăm condiția opțională (ex: isWetRoom)
          if (comp.condition && !comp.condition(ctxForSystem)) continue;

          const qty = comp.quantityFormula(ctxForSystem);
          result.push({
            id: uid(),
            spaceName: space.name,
            systemId: system.id,
            systemName: system.name,
            role: comp.role,
            descriere: comp.label,
            searchTerms: comp.searchTerms,
            cantitate: qty,
            unit: comp.unit,
            selected: comp.defaultSelected,
            isOptional: comp.isOptional,
          });
        }
      }
    }
  }

  // ── Elemente structurale ──────────────────────────────────────────────────
  for (const el of planData.structuralElements) {
    const spec = el.material ?? el.type;
    const systems = matchSystemsForSpec(spec);

    if (!systems.length) {
      result.push({
        id: uid(),
        spaceName: el.locatie ?? "Structural",
        systemId: "structural_manual",
        systemName: "Element structural",
        role: "manual",
        descriere: `${el.type} — ${el.material ?? "material nespecificat"}`,
        searchTerms: [el.material ?? el.type],
        cantitate: el.cantitate ?? 1,
        unit: el.unit ?? "buc",
        selected: true,
        isOptional: false,
        needsReview: true,
        reviewReason: "Verificați materialul și cantitatea",
      });
      continue;
    }

    for (const system of systems) {
      if (selectedSystemIds && !selectedSystemIds.includes(system.id)) continue;
      // Pentru elemente structurale folosim un context estimat
      const dummyCtx: RoomContext = {
        S: el.cantitate ?? 10,
        perimeter: el.cantitate ? Math.sqrt(el.cantitate) * 4 : 20,
        H: 2.80, hFinisaj: 2.60, isWetRoom: false,
        spaceName: el.locatie ?? "structural",
      };
      for (const comp of system.components) {
        result.push({
          id: uid(),
          spaceName: el.locatie ?? "Structural",
          systemId: system.id,
          systemName: system.name,
          role: comp.role,
          descriere: comp.label,
          searchTerms: comp.searchTerms,
          cantitate: comp.quantityFormula(dummyCtx),
          unit: comp.unit,
          selected: comp.defaultSelected,
          isOptional: comp.isOptional,
        });
      }
    }
  }

  // ── Anvelopă (termosistem, acoperiș) ─────────────────────────────────────
  if (planData.envelope?.termosistem) {
    const ts = planData.envelope.termosistem;
    const systems = matchSystemsForSpec(ts.tip);
    const tsCtx: RoomContext = {
      S: ts.suprafataMP,
      perimeter: Math.sqrt(ts.suprafataMP) * 4,
      H: 2.80, hFinisaj: 2.60, isWetRoom: false,
      spaceName: "Termosistem",
    };
    for (const system of systems) {
      if (selectedSystemIds && !selectedSystemIds.includes(system.id)) continue;
      for (const comp of system.components) {
        result.push({
          id: uid(),
          spaceName: "Termosistem",
          systemId: system.id,
          systemName: system.name,
          role: comp.role,
          descriere: comp.label,
          searchTerms: comp.searchTerms,
          cantitate: comp.quantityFormula(tsCtx),
          unit: comp.unit,
          selected: comp.defaultSelected,
          isOptional: comp.isOptional,
        });
      }
    }
  }

  if (planData.envelope?.acoperis) {
    const ac = planData.envelope.acoperis;
    const systems = matchSystemsForSpec(ac.tip);
    const acCtx: RoomContext = {
      S: ac.suprafataMP,
      perimeter: Math.sqrt(ac.suprafataMP) * 4,
      H: 2.80, hFinisaj: 2.60, isWetRoom: false,
      spaceName: "Acoperiș",
    };
    for (const system of systems) {
      if (selectedSystemIds && !selectedSystemIds.includes(system.id)) continue;
      for (const comp of system.components) {
        result.push({
          id: uid(),
          spaceName: "Acoperiș",
          systemId: system.id,
          systemName: system.name,
          role: comp.role,
          descriere: comp.label,
          searchTerms: comp.searchTerms,
          cantitate: comp.quantityFormula(acCtx),
          unit: comp.unit,
          selected: comp.defaultSelected,
          isOptional: comp.isOptional,
        });
      }
    }
  }

  return result;
}

/**
 * Convertește BOMItem[] → formatul ExtractedItem existent în AntemasuratorImport.
 * Doar itemele cu selected=true sunt incluse.
 */
export function bomToExtractedItems(
  bomItems: BOMItem[]
): Array<{
  id: string;
  nr?: string;
  sectiune?: string;
  descriere_client: string;
  cantitate: number;
  unitate: string;
  needsManualReview?: boolean;
  reviewReason?: string;
  cameraNume?: string;
}> {
  return bomItems
    .filter(item => item.selected && item.cantitate > 0)
    .map((item, idx) => ({
      id: item.id,
      nr: String(idx + 1),
      sectiune: `${item.spaceName} — ${item.systemName}`,
      descriere_client: item.descriere,
      cantitate: item.cantitate,
      unitate: item.unit,
      needsManualReview: item.needsReview,
      reviewReason: item.reviewReason,
      cameraNume: item.spaceName,
    }));
}

/**
 * Agregă BOMItem-urile identice (același searchTerms[0]) sumând cantitățile.
 * Util pentru lista finală unde același material apare în mai multe spații.
 */
export function aggregateBOM(items: BOMItem[]): BOMItem[] {
  const map = new Map<string, BOMItem>();

  for (const item of items) {
    if (!item.selected) continue;
    const key = `${item.systemId}::${item.role}::${item.unit}`;
    const existing = map.get(key);
    if (existing) {
      existing.cantitate = round2(existing.cantitate + item.cantitate);
      // Acumulăm spațiile în descrierea secțiunii
      if (!existing.spaceName.includes(item.spaceName)) {
        existing.spaceName += `, ${item.spaceName}`;
      }
    } else {
      map.set(key, { ...item, spaceName: item.spaceName });
    }
  }

  return [...map.values()];
}
