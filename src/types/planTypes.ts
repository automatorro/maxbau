/**
 * planTypes.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tipuri de date pentru extragerea planurilor arhitecturale și motorul BOM
 * (Bill of Materials).
 */

// ── Tipuri de plan ────────────────────────────────────────────────────────────

export type PlanType =
  | "finisaje_rezidential"    // casă, apartament
  | "finisaje_public"         // școală, birou, spital
  | "industrial"              // hală, depozit, fabrică
  | "structural"              // fundații, planșee, stâlpi
  | "acoperis"                // terasă, șarpantă
  | "subsol"                  // subsol, parcaj
  | "mixt"                    // combină mai multe tipuri
  | "necunoscut";

// ── Date extrase din plan ─────────────────────────────────────────────────────

export interface PlanSpace {
  /** Denumirea spațiului exact cum apare în plan (ex: "G.S. FETE", "SALA CLASA 1") */
  name: string;
  /** Suprafața în mp (din S=) */
  areaSqm: number;
  /** Perimetrul în ml calculat din cotele planului */
  perimeterM?: number;
  /** Dimensiunile individuale (din cote) */
  dimensions?: { w: number; l: number; label?: string }[];
  /** Înălțimea liberă a spațiului (H=) */
  heightM?: number;
  /** True dacă e zonă umedă (baie, bucătărie, grup sanitar) → implică hidroizolație */
  isWetRoom: boolean;

  // ── Finisaje ────────────────────────────────────────────────────────────────
  /** Tipul pardoselii (ex: "gresie antiderapantă", "parchet laminat", "beton") */
  pardoseala?: string;
  /** Finisajul peretului */
  pereti?: {
    finisaj: string;       // "faianță" | "vopsea lavabilă" | "tencuială decorativă"
    hFinisaj?: number;     // înălțimea finisajului în m (ex: 1.20, 2.60)
  };
  /** Tipul tavanului (ex: "tavan casetat 600x600", "tavan fals rigips", "zugrăveală") */
  tavan?: string;
  /** Alte specificații din plan care nu se încadrează în categoriile de mai sus */
  specialNotes?: string[];
}

export interface StructuralElement {
  type: "zidarie" | "planseu" | "fundatie" | "stalp" | "grinda" | "acoperis" | "alt";
  material?: string;        // "cărămidă", "BCA", "beton C20/25", "lemn"
  dimensiuni?: Record<string, number>; // { grosime: 0.25, latime: 0.60 }
  cantitate?: number;
  unit?: string;            // "mc", "mp", "ml", "buc"
  locatie?: string;         // "perete exterior", "perete interior", "planșeu"
  needsReview?: boolean;
}

export interface EnvelopeData {
  termosistem?: {
    tip: string;            // "vată minerală bazaltică" | "polistiren expandat EPS"
    grosimeMM: number;      // 100, 120, 150
    suprafataMP: number;
  };
  acoperis?: {
    tip: string;            // "terasa necirculabila" | "sarpanta" | "terasa circulabila"
    suprafataMP: number;
    panta?: number;         // în grade sau %
    material?: string;      // "membrane bituminoase" | "tigla ceramica"
  };
  hidroizolatie?: {
    suprafataMP: number;
    tip: string;
  };
}

/** Structura completă returnată de Gemini Vision după analiza unui plan */
export interface PlanData {
  planType: PlanType;
  /** Scara planului (ex: "1:100", "1:50") */
  scara?: string;
  /** Titlul/descrierea planului din cartuș */
  titlu?: string;
  /** Suprafața totală construită */
  totalArieConstruita?: number;
  /** Nr. de pagini analizate */
  numPages?: number;
  /** Toate spațiile identificate */
  spaces: PlanSpace[];
  /** Elemente structurale (zidărie, fundații etc.) */
  structuralElements: StructuralElement[];
  /** Date anvelopă (termosistem, acoperiș) */
  envelope?: EnvelopeData;
  /** Observații generale din plan */
  generalNotes?: string[];
  /** True dacă Gemini a returnat date parțiale (plan greu de citit) */
  isPartialExtraction?: boolean;
  /** Răspunsul brut al API-ului pentru debugging */
  rawResponseText?: string;
}

// ── BOM Engine ────────────────────────────────────────────────────────────────

export interface RoomContext {
  S: number;              // suprafata mp
  perimeter: number;      // perimetru ml
  H: number;              // inaltime camera m (default 2.80)
  hFinisaj: number;       // inaltime finisaj perete m (default H sau 2.60)
  isWetRoom: boolean;
  spaceName: string;
}

export interface SystemComponent {
  /** Identificatorul rolului (pentru grupare în UI) */
  role: string;
  /** Eticheta afișată utilizatorului */
  label: string;
  /** Termeni de căutare pentru matching în catalogul MaxBau */
  searchTerms: string[];
  /** Formula pentru calculul cantității */
  quantityFormula: (ctx: RoomContext) => number;
  /** Unitatea de măsură */
  unit: "mp" | "kg" | "ml" | "buc" | "mc" | "L" | "m";
  /** Dacă componenta e opțională (utilizatorul o poate debifa) */
  isOptional: boolean;
  /** Dacă componenta e bifată implicit */
  defaultSelected: boolean;
  /** Condiție suplimentară (ex: doar pentru zone umede) */
  condition?: (ctx: RoomContext) => boolean;
}

export interface MaterialSystem {
  id: string;
  /** Denumirea sistemului afișată în UI */
  name: string;
  /** Cuvinte cheie care declanșează sistemul (lowercase) */
  triggers: string[];
  /** Tipurile de plan pentru care se aplică sistemul */
  planTypes: PlanType[];
  /** Componentele sistemului */
  components: SystemComponent[];
}

// ── Extragere planuri structurale (armătură / beton) ─────────────────────────
// Vezi CLAUDE.md §8 + docs interne: extragere Vision pe PDF-uri scanate, apoi
// agregare deterministă în cod (kg/ml pe combinația marcă + diametru).

/** Marca de oțel standard din planurile românești. String liber pentru variante. */
export type MarcaOtel = "B500C" | "PC52" | "OB37" | string;

/** Tipul barei conform pattern-urilor de adnotare (§4.1 din spec). */
export type TipBara = "dreapta" | "etrier" | "distributie";

/**
 * Adnotare brută extrasă 1:1 de pe planșă (grafică sau Extras), înainte de
 * orice agregare. Modelul AI umple aceste câmpuri; aritmetica se face în cod.
 */
export interface RawRebarEntry {
  /** ex: "R02.pdf" sau "Extras_fundatii.pdf" — pentru audit + agregare per-planșă */
  sourceFile: string;
  sourceType: "extras_table" | "graphic_plan";
  /** codul poziției din planșă ex: "1a", "2", "11k" — opțional pe planșa grafică */
  poz?: string;
  marca: MarcaOtel;
  diametruMm: number;
  tipBara: TipBara;
  numarBare: number;
  /** metri, valoarea pe UN bară */
  lungimeUnaBara: number;
  /** valoarea „Lungime totală" tipărită în tabel (pentru cross-check) */
  lungimeTotalaSursa?: number;
  needsManualReview?: boolean;
  reviewReason?: string;
}

/**
 * Rezultatul agregării deterministe pe combinația (marcă + Ø). Calculat în
 * TypeScript, NU cerut modelului AI.
 */
export interface RebarTotalByMarcaDiametru {
  marca: MarcaOtel;
  diametruMm: number;
  totalMl: number;
  /** kg/ml — din tabelul standardizat (§5.5 spec) */
  masaPeMetru: number;
  totalKg: number;
  /** True dacă recalcularea nu se potrivește cu footer-ul tipărit al Extras-ului */
  needsManualReview: boolean;
  reviewReason?: string;
  /** Lista fișierelor sursă care au contribuit (pentru trasabilitate) */
  sourceFiles: string[];
}

/**
 * Volum de beton pe clasă. Cerință deschisă (§10 pct.1 spec) — populat numai
 * dacă găsim tabel centralizator de beton sau dacă cerința va fi confirmată.
 */
export interface ConcreteTotalByClass {
  clasa: string; // ex: "C20/25", "C25/30"
  totalMc: number;
  needsManualReview: boolean;
  reviewReason?: string;
  sourceFiles: string[];
}

/**
 * Metadate din caseta „MATERIALE:" a fiecărei planșe (§7 spec).
 * Ne spune ce clasă de beton / marcă de oțel se aplică elementelor din acea planșă.
 */
export interface PlanMaterialsBox {
  sourceFile: string;
  beton?: Array<{ element: string; clasa: string; note?: string }>;
  otel?: Array<{ element: string; marca: MarcaOtel }>;
  lemn?: Array<{ specificatie: string }>;
}

// ── Șarpantă / lemn (§14 spec — MVP conservator) ─────────────────────────────
// NU există centralizator scanat separat pentru lemn → nu avem sursă de
// validare încrucișată. Politica: needsManualReview: true necondiționat pe
// toate cantitățile, indiferent dacă am detectat o discrepanță sau nu.

export type TipElementLemn =
  | "caprior"
  | "pana"
  | "pop"
  | "cosoroaba"
  | "clesti"
  | "contrafisa"
  | "coama"
  | "alt";

export type MetodaCalculLemn =
  | "cota_explicita"    // cotă exactă lângă piesă pe planșă
  | "pas_x_rulaj"       // număr bucăți = lungime_rulaj_orizontal ÷ pas + 1
  | "unghi_confirmat"   // §14.4 update: lungime = rulaj_orizontal ÷ cos(unghiPantaGrade)
                        //  DOAR pentru elemente drepte, pe versant simplu (nu hip/vale/coamă)
  | "manual_necesar";   // geometrie neregulată (vale, coamă complexă) — nu automatizăm

export interface RawLumberEntry {
  sourceFile: string;
  tipElement: TipElementLemn;
  sectiuneCm: string;              // ex "14x14", "10x14"
  metodaCalcul: MetodaCalculLemn;
  /** Unghiul pantei (grade) folosit când metodaCalcul = "unghi_confirmat".
   *  Sursa curentă: A02_Plan_Invelitoare.pdf → 20° confirmat de utilizator ca
   *  aplicabil întregii case (§14.4 + §16.4). NU presupune uniformitate
   *  totală — dacă vreo secțiune a acoperișului are altă pantă, câmpul rămâne
   *  undefined și cade pe manual_necesar. */
  unghiPantaGrade?: number;
  numarBucati: number | null;      // null dacă metodaCalcul = "manual_necesar"
  lungimeUnitaraM: number | null;
  /** ÎNTOTDEAUNA true pentru lemn — nu există validare încrucișată. Politică
   *  explicită, nu bug: până când proiectantul confirmă manual, orice cantitate
   *  de lemn calculată automat rămâne estimare. Unghiul confirmat elimină o
   *  sursă de incertitudine, dar NU creează un mecanism de validare
   *  încrucișată echivalent footer-ului de armătură. */
  needsManualReview: true;
  reviewReason: string;
}

// ── §16: Plan învelitoare / țiglă — categorie SEPARATĂ de structura lemn ────
// A02_Plan_Invelitoare.pdf e emis de arh. (nu structurist), calculează
// SUPRAFAȚĂ (m² țiglă înclinată) — nu secțiuni/lungimi de lemn. Are text
// layer real (nativ CAD, cale TEXT §13), deci fiabilitate mult mai bună
// decât lemnul (§14). Unghiul de pantă e tipărit explicit pe planșă.

export interface RoofCoveringResult {
  sourceFile: string;
  /** Unghiul de pantă tipărit pe planșă (ex 20°). Extractorul verifică
   *  uniformitatea între versante — dacă apar valori diferite, semnalează
   *  în reviewReason și rămâne cu prima valoare, needsManualReview=true. */
  unghiPantaGrade: number;
  /** Suprafață orizontală (proiecție în plan), sumă a cotelor de contur.
   *  Validată împotriva totalului tipărit pe planșă (același principiu ca
   *  footer-ul de la Extras armătură §5.3). */
  suprafataOrizontalaMp: number;
  /** = orizontală ÷ cos(unghi). Calculată în TS, NU cerută modelului. */
  suprafataInclinataMp: number;
  /** Denumirea materialului dacă apare pe planșă (ex „țiglă ceramică vișinie") */
  materialInvelitoare: string | null;
  /** Lungime totală ml coame + dolii + muchii (opțional, dacă e extras).
   *  Vândut separat de țiglă, la ml — nu la m². */
  coameDoliiMl?: number;
  needsManualReview: boolean;
  reviewReason?: string;
}

/** Rezultatul agregat al unui import complet (mai multe planșe într-un proiect). */
export interface StructuralImportResult {
  /** Câte fișiere PDF au fost procesate în acest import */
  numFiles: number;
  /** Toate rândurile brute (pentru audit + re-agregare per fișier) */
  rawEntries: RawRebarEntry[];
  /** Totalurile finale, per (marcă + Ø), peste toate planurile */
  rebarTotals: RebarTotalByMarcaDiametru[];
  /** Beton — populat opțional când există tabel centralizator */
  concreteTotals?: ConcreteTotalByClass[];
  /** Metadate materiale per planșă */
  materialsBoxes: PlanMaterialsBox[];
  /** Erori / avertismente la nivel de import */
  warnings: string[];
}

/** O linie în lista BOM (Bill of Materials) expandată */
export interface BOMItem {
  id: string;
  /** Spațiul de origine */
  spaceName: string;
  /** Sistemul din care face parte */
  systemId: string;
  systemName: string;
  /** Rolul componentei în sistem */
  role: string;
  /** Descrierea pentru ofertă */
  descriere: string;
  /** Termeni de căutare pentru catalog */
  searchTerms: string[];
  /** Cantitatea calculată */
  cantitate: number;
  unit: string;
  /** Dacă e selectată pentru includere în ofertă */
  selected: boolean;
  /** Dacă e opțională */
  isOptional: boolean;
  /** Dacă necesită review manual */
  needsReview?: boolean;
  reviewReason?: string;
}
