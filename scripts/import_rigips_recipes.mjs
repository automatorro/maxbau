/**
 * Script: import_rigips_recipes.mjs
 *
 * Utilizare:
 *   node scripts/import_rigips_recipes.mjs              <- dry-run: raport materiale găsite/lipsă
 *   node scripts/import_rigips_recipes.mjs --execute    <- inserează rețetele în retete_constructii
 *   node scripts/import_rigips_recipes.mjs --export-missing missing.json
 *                                                       <- export JSON cu materiale lipsă pentru
 *                                                          import în catalog products
 *
 * Ce face:
 *   1. Datele Rigips (33 materiale + 9 rețete) sunt hardcodate în acest script
 *      (extrase din oferta Nord One Brediceanu N4, 4784/2026-07-28).
 *   2. Interoghează DB (`products`) și încearcă să potrivească fiecare material
 *      Rigips cu produsele existente — după cod_intern (SAP) sau după keywords.
 *   3. Afișează raport: materiale găsite + materiale lipsă.
 *   4. Cu --execute: upsert în `retete_constructii` a celor 9 rețete Rigips
 *      (categorie „rigips-sistem"), cu materiale legate prin cod_intern unde
 *      există, iar restul rămân cu status FOUND/NOT_FOUND la rulare în UI.
 *
 * Sursă: Excel „6_Oferta_Nord_One_Brediceanu.xlsx", sheet „Materiale UML" +
 * „Ofertă Detaliată", ofertă Saint-Gobain Rigips prin MaxBau, valabilă
 * 30 zile de la 2026-07-28.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Citire .env ──────────────────────────────────────────────────────────────
const envPath = resolve(ROOT, '.env');
if (!existsSync(envPath)) {
  console.error('❌  Fișierul .env nu există. Creează-l cu VITE_SUPABASE_URL și SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const envText = readFileSync(envPath, 'utf-8');
const getEnv = (k) => envText.match(new RegExp(k + '\\s*=\\s*[\'"]?([^\\n\'"]+)[\'"]?'))?.[1]?.trim();
const SUPABASE_URL = getEnv('VITE_SUPABASE_URL');
const SERVICE_KEY  = getEnv('SUPABASE_SERVICE_ROLE_KEY');
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Lipsesc VITE_SUPABASE_URL sau SUPABASE_SERVICE_ROLE_KEY din .env');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const EXPORT_MISSING = args.indexOf('--export-missing') !== -1
  ? args[args.indexOf('--export-missing') + 1]
  : null;

// ═══════════════════════════════════════════════════════════════════════════
// DATE RIGIPS — extrase din oferta Nord One 4784/2026-07-28
// ═══════════════════════════════════════════════════════════════════════════

const RIGIPS_MATERIALS = [
  { cod_sap: '1100011350',        denumire: 'AKUSTO PLUS 10/5 MPS 24ROL 2x7500x(2x600)x50 mm', um: 'm2', pret_ron: 6.7936, ambalaj: 'palet' },
  { cod_sap: '1100006405_RO10_00', denumire: 'Placa Rigips® RB 12,5x1200x2600 mm, tip A, muchie PRO', um: 'm2', pret_ron: 10.2732, ambalaj: 'palet' },
  { cod_sap: '1100006183_RO10_00', denumire: 'Placa Rigips® HABITO 12,5x1200x2600 mm, tip DFRI, muchie PRO', um: 'm2', pret_ron: 33.5178, ambalaj: 'placa' },
  { cod_sap: '1100006408_RO10_00', denumire: 'Placa Rigips® RBI 12,5x1200x2000 mm, tip H2, muchie PRO', um: 'm2', pret_ron: 15.6373, ambalaj: 'palet' },
  { cod_sap: '1100007808_RO10_00', denumire: 'Placa Rigips® RBI 12,5x1200x2600 mm, tip H2, muchie PRO', um: 'm2', pret_ron: 15.6373, ambalaj: 'palet' },
  { cod_sap: '1100006420_RO10_00', denumire: 'Placa Rigips® RF 12,5x1200x2600 mm, tip F, muchie PRO', um: 'm2', pret_ron: 14.8896, ambalaj: 'palet' },
  { cod_sap: '1100006430_RO10_00', denumire: 'Placa Rigips® RFI 12,5x1200x2600 mm, tip FH2, muchie PRO', um: 'm2', pret_ron: 18.1081, ambalaj: 'palet' },
  { cod_sap: '1100006460_RO10_00', denumire: 'Placa Rigips® Fonic 12,5x1200x2600 mm, tip D, muchie PRO', um: 'm2', pret_ron: 14.2394, ambalaj: 'palet' },
  { cod_sap: '1200002258_RO10_00', denumire: 'Rigiprofil® UW 50, L=4,0m (gros. 0,6 mm) sina de ghidaj', um: 'm', pret_ron: 6.0291, ambalaj: 'legatura' },
  { cod_sap: '1200004712_RO10_00', denumire: 'Rigiprofil® CW 50, aripa=50mm, L=4,0m, montant', um: 'm', pret_ron: 7.4627, ambalaj: 'legatura' },
  { cod_sap: '1200002257_RO10_00', denumire: 'Rigiprofil® UW 75, L=4,0m (gros. 0,6 mm) sina de ghidaj', um: 'm', pret_ron: 7.4225, ambalaj: 'legatura' },
  { cod_sap: '1200002389_RO10_00', denumire: 'Rigiprofil® CW 75, aripa=50mm, L=4,0m, montant', um: 'm', pret_ron: 8.5546, ambalaj: 'legatura' },
  { cod_sap: '1200002132_RO10_00', denumire: 'Profil UW 75/80, aripa=80mm - 0,60 mm, L=2,0m, sina de ghidaj', um: 'm', pret_ron: 0, ambalaj: 'legatura' },
  { cod_sap: '1200002275_RO10_00', denumire: 'Rigiprofil® UW 100, L=4,0m (gros. 0,6 mm) sina de ghidaj', um: 'm', pret_ron: 8.4005, ambalaj: 'legatura' },
  { cod_sap: '1200002391_RO10_00', denumire: 'Rigiprofil® CW 100, aripa=50mm, L=4,0m, montant', um: 'm', pret_ron: 9.9078, ambalaj: 'legatura' },
  { cod_sap: '1200002466_RO10_00', denumire: 'Surub autofiletant 212, L=25mm, ø 3,5mm, 1000 buc/cutie', um: 'buc', pret_ron: 0.0348, ambalaj: 'cutie' },
  { cod_sap: '1200002467_RO10_00', denumire: 'Surub autofiletant 212, L=35mm, ø 3,5mm, 1000 buc/cutie', um: 'buc', pret_ron: 0.0435, ambalaj: 'cutie' },
  { cod_sap: '1200002469_RO10_00', denumire: 'Surub autofiletant 212, L=55mm, ø 3,5mm, 500 buc/cutie', um: 'buc', pret_ron: 0.0676, ambalaj: 'cutie' },
  { cod_sap: '1200002326_RO10_00', denumire: 'Surub autofiletant Hart Fix, L=25mm, ø 3,9mm, 1000 buc/cutie', um: 'buc', pret_ron: 0.0499, ambalaj: 'cutie' },
  { cod_sap: '1200002325_RO10_00', denumire: 'Surub autofiletant Hart Fix, L=35mm, ø 3,9mm, 1000 buc/cutie', um: 'buc', pret_ron: 0.0620, ambalaj: 'cutie' },
  { cod_sap: '1200002505_RO10_00', denumire: 'Surub autoperforant 421, L=13,0mm, ø 4,2mm, 1000 buc/cutie', um: 'buc', pret_ron: 0.0594, ambalaj: 'cutie' },
  { cod_sap: '1200002477_RO10_00', denumire: 'Surub Rigips cu diblu din plastic ø 6 x L=45mm, 100 buc/cutie', um: 'buc', pret_ron: 0.1802, ambalaj: 'cutie' },
  { cod_sap: '1200002229_RO10_00', denumire: 'Surub pentru beton Rigips R-LX-HF-ZP L=75, ø 8', um: 'buc', pret_ron: 2.3363, ambalaj: 'cutie' },
  { cod_sap: '1200002230_RO10_00', denumire: 'Surub pentru beton Rigips R-LX-HF-ZP L=100, ø 8', um: 'buc', pret_ron: 2.8172, ambalaj: 'cutie' },
  { cod_sap: '1200004865_RO10_00', denumire: 'Ancora metalica 6/40', um: 'buc', pret_ron: 0.5495, ambalaj: 'cutie' },
  { cod_sap: '1200004699_RO10_00', denumire: 'Banda etansare (adeziva) din PE (gros. 3mm) pt. profil UW 50', um: 'm', pret_ron: 0.8796, ambalaj: 'rola' },
  { cod_sap: '1200004700_RO10_00', denumire: 'Banda etansare (adeziva) din PE (gros. 3mm) pt. profil UW 75', um: 'm', pret_ron: 1.2938, ambalaj: 'rola' },
  { cod_sap: '1200004701_RO10_00', denumire: 'Banda etansare (adeziva) din PE (gros. 3mm) pt. profil UW 100', um: 'm', pret_ron: 1.7629, ambalaj: 'rola' },
  { cod_sap: '1200002346_RO10_00', denumire: 'Banda vata bazaltica 75mm pentru etansare (10 x 75 x 1000 mm)', um: 'm', pret_ron: 2.2385, ambalaj: 'cutie' },
  { cod_sap: '1100007802_RO10_00', denumire: 'Banda fibra de sticla (armare rosturi) lat 50mm x L=25m/rola', um: 'm', pret_ron: 0.1591, ambalaj: 'rola' },
  { cod_sap: '1100006250_RO10_00', denumire: 'Chit de rosturi Rigips® SUPER, ambalaj LDPE vidat, sac 25 kg', um: 'kg', pret_ron: 2.5285, ambalaj: 'palet' },
];

// ── 9 rețete Rigips (soluții), fiecare cu consumurile specifice per m² ─────
const RIGIPS_RECIPES = [
  {
    id: 'rigips-3-40-05',
    name: 'Perete compartimentare 12,5cm - (2+2) placi RB',
    cod_solutie: '3.40.05, 051, 052 RB, RS, GF',
    materials: [
      { cod_sap: '1100006405_RO10_00', consum: 4.0,  um: 'm2' },
      { cod_sap: '1200002257_RO10_00', consum: 0.5,  um: 'm' },
      { cod_sap: '1200002389_RO10_00', consum: 1.8,  um: 'm' },
      { cod_sap: '1200002466_RO10_00', consum: 8,    um: 'buc' },
      { cod_sap: '1200002467_RO10_00', consum: 21,   um: 'buc' },
      { cod_sap: '1200004865_RO10_00', consum: 0.8,  um: 'buc' },
      { cod_sap: '1200002505_RO10_00', consum: 0.5,  um: 'buc' },
      { cod_sap: '1200004700_RO10_00', consum: 0.7,  um: 'm' },
      { cod_sap: '1100007802_RO10_00', consum: 2.1,  um: 'm' },
      { cod_sap: '1100006250_RO10_00', consum: 0.9,  um: 'kg' },
      { cod_sap: '1100011350',         consum: 1.0,  um: 'm2' },
    ],
  },
  {
    id: 'rigips-3-40-06',
    name: 'Perete compartimentare 15,0cm - (2+2) placi RB',
    cod_solutie: '3.40.06, 061, 062 RB, RS, GF',
    materials: [
      { cod_sap: '1100006405_RO10_00', consum: 4.0,  um: 'm2' },
      { cod_sap: '1200002275_RO10_00', consum: 0.5,  um: 'm' },
      { cod_sap: '1200002391_RO10_00', consum: 1.8,  um: 'm' },
      { cod_sap: '1200002466_RO10_00', consum: 8,    um: 'buc' },
      { cod_sap: '1200002467_RO10_00', consum: 21,   um: 'buc' },
      { cod_sap: '1200004865_RO10_00', consum: 0.8,  um: 'buc' },
      { cod_sap: '1200002505_RO10_00', consum: 0.5,  um: 'buc' },
      { cod_sap: '1200004701_RO10_00', consum: 0.7,  um: 'm' },
      { cod_sap: '1100007802_RO10_00', consum: 2.1,  um: 'm' },
      { cod_sap: '1100006250_RO10_00', consum: 0.9,  um: 'kg' },
      { cod_sap: '1100011350',         consum: 1.0,  um: 'm2' },
    ],
  },
  {
    id: 'rigips-st-p-12',
    name: 'Perete compartimentare 12,5cm - HABITO + RB (rezistență trafic)',
    cod_solutie: 'ST_P.12',
    materials: [
      { cod_sap: '1100006405_RO10_00', consum: 2.0,  um: 'm2' },
      { cod_sap: '1100006183_RO10_00', consum: 2.0,  um: 'm2' },
      { cod_sap: '1200002257_RO10_00', consum: 0.5,  um: 'm' },
      { cod_sap: '1200002389_RO10_00', consum: 1.8,  um: 'm' },
      { cod_sap: '1200002466_RO10_00', consum: 8,    um: 'buc' },
      { cod_sap: '1200002467_RO10_00', consum: 21,   um: 'buc' },
      { cod_sap: '1200002477_RO10_00', consum: 4,    um: 'buc' },
      { cod_sap: '1200004700_RO10_00', consum: 0.7,  um: 'm' },
      { cod_sap: '1100007802_RO10_00', consum: 2.1,  um: 'm' },
      { cod_sap: '1100006250_RO10_00', consum: 0.9,  um: 'kg' },
    ],
  },
  {
    id: 'rigips-3-41-01',
    name: 'Perete compartimentare 15,3cm - (2+2) RB + RBI (zone umede)',
    cod_solutie: '3.41.01, 011, 012 RB, RS, GF',
    materials: [
      { cod_sap: '1100006405_RO10_00', consum: 2.0,  um: 'm2' },
      { cod_sap: '1100006408_RO10_00', consum: 2.0,  um: 'm2' },
      { cod_sap: '1200002258_RO10_00', consum: 0.5,  um: 'm' },
      { cod_sap: '1200004712_RO10_00', consum: 1.8,  um: 'm' },
      { cod_sap: '1200002466_RO10_00', consum: 8,    um: 'buc' },
      { cod_sap: '1200002467_RO10_00', consum: 21,   um: 'buc' },
      { cod_sap: '1200004865_RO10_00', consum: 0.8,  um: 'buc' },
      { cod_sap: '1200002505_RO10_00', consum: 0.5,  um: 'buc' },
      { cod_sap: '1200004699_RO10_00', consum: 0.7,  um: 'm' },
      { cod_sap: '1100007802_RO10_00', consum: 2.1,  um: 'm' },
      { cod_sap: '1100006250_RO10_00', consum: 0.9,  um: 'kg' },
      { cod_sap: '1100011350',         consum: 1.0,  um: 'm2' },
    ],
  },
  {
    id: 'rigips-3-41-02',
    name: 'Perete compartimentare 20,3cm - (2+2) RB + RBI (zone umede, mai gros)',
    cod_solutie: '3.41.02, 021, 022 RB, RS, GF',
    materials: [
      { cod_sap: '1100006405_RO10_00', consum: 2.0,  um: 'm2' },
      { cod_sap: '1100007808_RO10_00', consum: 2.0,  um: 'm2' },
      { cod_sap: '1200002257_RO10_00', consum: 0.5,  um: 'm' },
      { cod_sap: '1200002389_RO10_00', consum: 1.8,  um: 'm' },
      { cod_sap: '1200002466_RO10_00', consum: 8,    um: 'buc' },
      { cod_sap: '1200002467_RO10_00', consum: 21,   um: 'buc' },
      { cod_sap: '1200004865_RO10_00', consum: 0.8,  um: 'buc' },
      { cod_sap: '1200002505_RO10_00', consum: 0.5,  um: 'buc' },
      { cod_sap: '1200004699_RO10_00', consum: 0.35, um: 'm' },
      { cod_sap: '1200004700_RO10_00', consum: 0.35, um: 'm' },
      { cod_sap: '1100007802_RO10_00', consum: 2.1,  um: 'm' },
      { cod_sap: '1100006250_RO10_00', consum: 0.9,  um: 'kg' },
    ],
  },
  {
    id: 'rigips-3-40-10',
    name: 'Perete compartimentare 15,0cm - (3+3) RF (rezistență foc superioară)',
    cod_solutie: '3.40.10',
    materials: [
      { cod_sap: '1100006420_RO10_00', consum: 6.0,  um: 'm2' },
      { cod_sap: '1200002257_RO10_00', consum: 0.35, um: 'm' },
      { cod_sap: '1200002132_RO10_00', consum: 0.15, um: 'm' },
      { cod_sap: '1200002389_RO10_00', consum: 1.8,  um: 'm' },
      { cod_sap: '1200002466_RO10_00', consum: 8,    um: 'buc' },
      { cod_sap: '1200002467_RO10_00', consum: 12,   um: 'buc' },
      { cod_sap: '1200002469_RO10_00', consum: 21,   um: 'buc' },
      { cod_sap: '1200002230_RO10_00', consum: 0.8,  um: 'buc' },
      { cod_sap: '1200002505_RO10_00', consum: 0.5,  um: 'buc' },
      { cod_sap: '1200002346_RO10_00', consum: 0.7,  um: 'm' },
      { cod_sap: '1100007802_RO10_00', consum: 4.2,  um: 'm' },
      { cod_sap: '1100006250_RO10_00', consum: 1.6,  um: 'kg' },
    ],
  },
  {
    id: 'rigips-3-22-00b',
    name: 'Tencuiala uscata pe metal - (2) RBI 12,5mm, fără vată',
    cod_solutie: '3.22.00b',
    materials: [
      { cod_sap: '1100007808_RO10_00', consum: 2.0,  um: 'm2' },
      { cod_sap: '1200002258_RO10_00', consum: 0.5,  um: 'm' },
      { cod_sap: '1200004712_RO10_00', consum: 1.8,  um: 'm' },
      { cod_sap: '1200002466_RO10_00', consum: 8,    um: 'buc' },
      { cod_sap: '1200002467_RO10_00', consum: 12,   um: 'buc' },
      { cod_sap: '1200002229_RO10_00', consum: 0.8,  um: 'buc' },
      { cod_sap: '1200004699_RO10_00', consum: 0.7,  um: 'm' },
      { cod_sap: '1100007802_RO10_00', consum: 2.1,  um: 'm' },
      { cod_sap: '1100006250_RO10_00', consum: 0.9,  um: 'kg' },
    ],
  },
  {
    id: 'rigips-3-50-16',
    name: 'Tencuiala uscata 7,5cm - (2) RFI (rezistență foc + zone umede)',
    cod_solutie: '3.50.16, 161, 162 RF HA RS GH GX GF',
    materials: [
      { cod_sap: '1100006430_RO10_00', consum: 2.0,  um: 'm2' },
      { cod_sap: '1200002258_RO10_00', consum: 0.5,  um: 'm' },
      { cod_sap: '1200004712_RO10_00', consum: 1.8,  um: 'm' },
      { cod_sap: '1200002466_RO10_00', consum: 8,    um: 'buc' },
      { cod_sap: '1200002467_RO10_00', consum: 12,   um: 'buc' },
      { cod_sap: '1200004865_RO10_00', consum: 0.4,  um: 'buc' },
      { cod_sap: '1200004699_RO10_00', consum: 0.7,  um: 'm' },
      { cod_sap: '1100007802_RO10_00', consum: 2.1,  um: 'm' },
      { cod_sap: '1100006250_RO10_00', consum: 0.9,  um: 'kg' },
    ],
  },
  {
    id: 'rigips-st-t-12',
    name: 'Tencuiala uscata 12,5cm - (2) Fonic (izolare acustică superioară)',
    cod_solutie: 'ST_T.12',
    materials: [
      { cod_sap: '1100006460_RO10_00', consum: 2.0,  um: 'm2' },
      { cod_sap: '1200002275_RO10_00', consum: 0.5,  um: 'm' },
      { cod_sap: '1200002391_RO10_00', consum: 1.8,  um: 'm' },
      { cod_sap: '1200002326_RO10_00', consum: 8,    um: 'buc' },
      { cod_sap: '1200002325_RO10_00', consum: 12,   um: 'buc' },
      { cod_sap: '1200002477_RO10_00', consum: 4,    um: 'buc' },
      { cod_sap: '1200004701_RO10_00', consum: 0.7,  um: 'm' },
      { cod_sap: '1100007802_RO10_00', consum: 2.1,  um: 'm' },
      { cod_sap: '1100006250_RO10_00', consum: 0.9,  um: 'kg' },
      { cod_sap: '1100011350',         consum: 1.0,  um: 'm2' },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// MATCH ALGORITHM
// ═══════════════════════════════════════════════════════════════════════════

/** Extrage token-uri distinctive dintr-o denumire Rigips (RB, RBI, CW, UW, HABITO,
 *  Fonic, dimensiune, etc.) — folosit pentru match fuzzy când SAP-ul nu se găsește. */
function extractKeywords(denumire) {
  const tokens = new Set();
  const lower = denumire.toLowerCase();

  // Tipuri plăci
  ['rbi', 'rfi', 'rf ', 'rb ', 'habito', 'fonic', 'akusto'].forEach(t => {
    if (lower.includes(t.trim())) tokens.add(t.trim().toUpperCase());
  });
  // Profile
  ['cw 50', 'cw 75', 'cw 100', 'uw 50', 'uw 75', 'uw 100'].forEach(t => {
    if (lower.includes(t)) tokens.add(t.replace(' ', '').toUpperCase());
  });
  // Dimensiune plăci
  const dimMatch = denumire.match(/12,?5\s*x\s*1200\s*x\s*(2000|2600)/);
  if (dimMatch) tokens.add(`12.5X1200X${dimMatch[1]}`);
  // Șuruburi
  const lMatch = denumire.match(/L\s*=\s*(\d+)\s*mm/i);
  if (lMatch) tokens.add(`L${lMatch[1]}`);
  // Brand
  if (lower.includes('rigips')) tokens.add('RIGIPS');
  if (lower.includes('bazaltica')) tokens.add('VATA-BAZALTICA');

  return [...tokens];
}

async function fetchAllProducts() {
  console.log('📚  Descarc catalogul de produse...');
  const all = [];
  let page = 0;
  while (true) {
    const { data, error } = await sb
      .from('products')
      .select('id, cod_intern, denumire_completa, pret_lista, unit')
      .range(page * 1000, (page + 1) * 1000 - 1);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
    page++;
  }
  console.log(`   ${all.length} produse descărcate.\n`);
  return all;
}

function findMatch(material, products) {
  // 1. Match direct pe cod_intern = cod_sap
  const bySap = products.find(p => (p.cod_intern || '').trim() === material.cod_sap);
  if (bySap) return { product: bySap, method: 'cod_sap_exact' };

  // 2. Match fuzzy: caută produs cu keywords + Rigips în denumire
  const kws = extractKeywords(material.denumire);
  if (kws.length === 0) return null;

  const candidates = products.filter(p => {
    const name = (p.denumire_completa || '').toLowerCase();
    if (!name.includes('rigips') && !kws.includes('VATA-BAZALTICA')) return false;
    return kws.every(k => name.toUpperCase().includes(k.toUpperCase()));
  });

  if (candidates.length === 1) return { product: candidates[0], method: 'keywords_unique' };
  if (candidates.length > 1) return { product: candidates[0], method: 'keywords_first_of_many', all: candidates };

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

console.log('═'.repeat(80));
console.log('  IMPORT RIGIPS RECIPES — dry-run' + (EXECUTE ? ' + execute' : ''));
console.log('═'.repeat(80));
console.log(`  ${RIGIPS_MATERIALS.length} materiale · ${RIGIPS_RECIPES.length} rețete`);
console.log('');

const products = await fetchAllProducts();

// ── Match materiale ────────────────────────────────────────────────────────
const found = [];
const missing = [];
const ambiguous = [];

for (const mat of RIGIPS_MATERIALS) {
  const match = findMatch(mat, products);
  if (!match) {
    missing.push(mat);
  } else if (match.method === 'keywords_first_of_many') {
    ambiguous.push({ ...mat, product: match.product, all: match.all });
  } else {
    found.push({ ...mat, product: match.product, method: match.method });
  }
}

console.log('═'.repeat(80));
console.log(`  ✓ GĂSITE: ${found.length}/${RIGIPS_MATERIALS.length}`);
console.log('═'.repeat(80));
for (const f of found) {
  console.log(`  ${f.method === 'cod_sap_exact' ? '🎯' : '🔍'} ${f.cod_sap.padEnd(25)} → ${(f.product.cod_intern || '').padEnd(20)} ${(f.product.denumire_completa || '').slice(0, 55)}`);
}

if (ambiguous.length > 0) {
  console.log('');
  console.log('═'.repeat(80));
  console.log(`  ? AMBIGUE (mai multe candidate — folosesc primul): ${ambiguous.length}`);
  console.log('═'.repeat(80));
  for (const a of ambiguous) {
    console.log(`  ⚠️  ${a.cod_sap.padEnd(25)} → prima: ${(a.product.cod_intern || '').padEnd(20)} ${(a.product.denumire_completa || '').slice(0, 55)}`);
    console.log(`     (${a.all.length} candidați: ${a.all.slice(0, 3).map(p => p.cod_intern).join(', ')}${a.all.length > 3 ? '…' : ''})`);
  }
}

console.log('');
console.log('═'.repeat(80));
console.log(`  ❌ LIPSĂ ÎN CATALOG: ${missing.length}/${RIGIPS_MATERIALS.length}`);
console.log('═'.repeat(80));
if (missing.length === 0) {
  console.log('  🎉  Toate materialele Rigips există în catalog!');
} else {
  console.log('  Adaugă-le manual în /admin/products SAU generează un import de catalog.');
  console.log('');
  console.log('  Format pentru import:');
  console.log('  ' + '-'.repeat(76));
  console.log(`  ${'COD SAP (folosește ca cod_intern)'.padEnd(30)} | ${'UM'.padEnd(4)} | ${'PREȚ RON'.padEnd(9)} | DENUMIRE`);
  console.log('  ' + '-'.repeat(76));
  for (const m of missing) {
    console.log(`  ${m.cod_sap.padEnd(30)} | ${m.um.padEnd(4)} | ${String(m.pret_ron).padStart(9)} | ${m.denumire}`);
  }
}

// ── Export lista de lipsă ca JSON (opțional) ───────────────────────────────
if (EXPORT_MISSING) {
  const exportData = missing.map(m => ({
    cod_intern: m.cod_sap,
    denumire_completa: m.denumire,
    unit: m.um,
    pret_lista: m.pret_ron,
    pack_quantity: null,
    note: `Import Rigips oferta 4784/2026-07-28 — ambalaj: ${m.ambalaj}`,
  }));
  writeFileSync(EXPORT_MISSING, JSON.stringify(exportData, null, 2));
  console.log('');
  console.log(`  📤  Export: ${EXPORT_MISSING} (${exportData.length} produse pentru import în /admin/products)`);
}

// ── Construire rețete cu materiale legate (cod_intern) ─────────────────────
const foundMap = new Map(found.map(f => [f.cod_sap, f.product]));
const ambigMap = new Map(ambiguous.map(a => [a.cod_sap, a.product]));

const recipesToInsert = RIGIPS_RECIPES.map(r => ({
  id: r.id,
  recipe_name: r.name,
  category: 'rigips-sistem',
  unit: 'm²',
  status: 'active',
  materials: r.materials.map((m, idx) => {
    const p = foundMap.get(m.cod_sap) ?? ambigMap.get(m.cod_sap);
    return {
      position: idx + 1,
      description: RIGIPS_MATERIALS.find(x => x.cod_sap === m.cod_sap)?.denumire ?? m.cod_sap,
      um: m.um,
      consumption_per_m2: m.consum,
      keywords: extractKeywords(RIGIPS_MATERIALS.find(x => x.cod_sap === m.cod_sap)?.denumire ?? ''),
      cod_intern: p?.cod_intern ?? m.cod_sap, // dacă lipsește, păstrează SAP pentru mapare viitoare
    };
  }),
}));

console.log('');
console.log('═'.repeat(80));
console.log(`  📋 REȚETE DE INSERAT: ${recipesToInsert.length}`);
console.log('═'.repeat(80));
for (const r of recipesToInsert) {
  const linkedCount = r.materials.filter(m => foundMap.has(m.cod_intern) || products.some(p => p.cod_intern === m.cod_intern)).length;
  console.log(`  ${r.id.padEnd(25)} · ${r.materials.length} materiale · ${linkedCount} legate direct la cod_intern`);
}

if (!EXECUTE) {
  console.log('');
  console.log('💡  Rulează cu --execute ca să inserezi rețetele în DB.');
  console.log('    Rulează cu --export-missing missing.json ca să exportezi lista de produse lipsă.');
  process.exit(0);
}

// ── Execute: insert în retete_constructii ──────────────────────────────────
console.log('');
console.log('═'.repeat(80));
console.log('  EXECUTE: upsert rețete în retete_constructii');
console.log('═'.repeat(80));

let ok = 0, fail = 0;
for (const r of recipesToInsert) {
  const { error } = await sb.from('retete_constructii').upsert(r);
  if (error) {
    console.log(`  ❌  ${r.id}: ${error.message}`);
    fail++;
  } else {
    console.log(`  ✓   ${r.id}`);
    ok++;
  }
}
console.log('');
console.log(`  Rezultat: ${ok} upsert OK · ${fail} eșec`);
