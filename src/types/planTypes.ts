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
