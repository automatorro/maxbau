-- ============================================================
-- Seed: Sisteme Vatâ — rețete auxiliare pentru Configurator
-- Rulează în Supabase → SQL Editor
-- ============================================================

INSERT INTO retete_constructii (id, recipe_name, category, unit, status, materials)
VALUES

-- 1. ETICS Fațadă — Vatâ Bazaltică / Minerală
(
  gen_random_uuid(),
  'ETICS Fațadă — Vatâ Termizolantă',
  'vata-sistem',
  'mp',
  'active',
  '[
    {
      "position": 1,
      "description": "Adeziv & Masă de șpaclu pentru plăci termoizolante",
      "um": "kg",
      "consumption_per_m2": 9.0,
      "keywords": ["DuoContact", "ProContact", "adeziv termoizolant", "masa spaclu", "adeziv vata", "adeziv fatada", "Ceresit CT85", "Weber therm"]
    },
    {
      "position": 2,
      "description": "Plasă din fibră de sticlă armătură fațadă (160 g/mp)",
      "um": "mp",
      "consumption_per_m2": 1.1,
      "keywords": ["StarTex", "plasa fibra sticla", "armatura fatada", "160g", "plasa armare", "fibra sticla fatada"]
    },
    {
      "position": 3,
      "description": "Dibluri de fațadă cu cui metalic (10×160mm)",
      "um": "buc",
      "consumption_per_m2": 6.0,
      "keywords": ["diblu fatada", "diblu termoizolatie", "10x160", "cui metalic", "diblu vata", "fixare mecanica fatada"]
    },
    {
      "position": 4,
      "description": "Grund amorsă pentru tencuială decorativă",
      "um": "kg",
      "consumption_per_m2": 0.2,
      "keywords": ["UniPrimer", "amorsa tencuiala", "grund fatada", "primer fatada", "Ceresit CT16"]
    },
    {
      "position": 5,
      "description": "Tencuială decorativă siliconică granulație 2mm",
      "um": "kg",
      "consumption_per_m2": 2.8,
      "keywords": ["SilikonTop", "tencuiala decorativa", "siliconica 2mm", "finisaj fatada", "tencuiala siliconica", "tencuiala acrilica 2mm"]
    }
  ]'::jsonb
),

-- 2. Interior Mansardă — Vatâ Minerală
(
  gen_random_uuid(),
  'Interior Mansardă — Vatâ Minerală',
  'vata-sistem',
  'mp',
  'active',
  '[
    {
      "position": 1,
      "description": "Placă gips-carton standard 12.5mm",
      "um": "mp",
      "consumption_per_m2": 1.05,
      "keywords": ["gips carton", "rigips", "placa gips", "12.5mm", "GKB", "RB", "gipscarton standard"]
    },
    {
      "position": 2,
      "description": "Profil metalic structură CD60 (L=4m)",
      "um": "ml",
      "consumption_per_m2": 3.0,
      "keywords": ["profil CD60", "CD 60", "profil structura", "profil C60", "profil tavan CD"]
    },
    {
      "position": 3,
      "description": "Profil metalic contur UD30 (L=3m)",
      "um": "ml",
      "consumption_per_m2": 0.7,
      "keywords": ["profil UD30", "UD 30", "profil contur", "profil U30", "profil talpa"]
    },
    {
      "position": 4,
      "description": "Șuruburi autoperforante 3.5×25mm (gips-profil)",
      "um": "buc",
      "consumption_per_m2": 15.0,
      "keywords": ["surub autoperforant", "3.5x25", "surub gips", "surub TB 3.5", "autoperforante gips"]
    },
    {
      "position": 5,
      "description": "Ipsos de îmbinări rosturi gips-carton",
      "um": "kg",
      "consumption_per_m2": 0.3,
      "keywords": ["Fugenfuller", "ipsos rosturi", "chit gips", "Fugenfüller", "Knauf Uniflott", "ipsos finisaj rosturi"]
    },
    {
      "position": 6,
      "description": "Bandă armare îmbinări din fibră de sticlă",
      "um": "ml",
      "consumption_per_m2": 1.5,
      "keywords": ["banda armare", "banda gips", "fibra sticla rosturi", "banda rosturi", "banda armare fibra"]
    }
  ]'::jsonb
),

-- 3. Plafon Suspendat — Vatâ Fonică / Termică
(
  gen_random_uuid(),
  'Plafon Suspendat — Vatâ Termică/Fonică',
  'vata-sistem',
  'mp',
  'active',
  '[
    {
      "position": 1,
      "description": "Placă gips-carton tavan 12.5mm",
      "um": "mp",
      "consumption_per_m2": 1.05,
      "keywords": ["gips carton tavan", "placa gips plafon", "rigips tavan", "GKB tavan", "placa gips 12.5"]
    },
    {
      "position": 2,
      "description": "Profil CD60 structură tavan (L=4m)",
      "um": "ml",
      "consumption_per_m2": 2.5,
      "keywords": ["profil CD60", "CD 60 tavan", "profil structura tavan", "CD60 plafon"]
    },
    {
      "position": 3,
      "description": "Profil UD30 perimetral tavan (L=3m)",
      "um": "ml",
      "consumption_per_m2": 0.5,
      "keywords": ["profil UD30", "UD perimetral", "profil contur tavan", "UD30 plafon"]
    },
    {
      "position": 4,
      "description": "Suspensii tijă M8 reglabilă pentru tavan",
      "um": "buc",
      "consumption_per_m2": 1.5,
      "keywords": ["suspensie tija", "suspensie reglabila", "M8 tavan", "suspensie plafon", "tija suspensie"]
    },
    {
      "position": 5,
      "description": "Șuruburi autoperforante gips-tavan",
      "um": "buc",
      "consumption_per_m2": 12.0,
      "keywords": ["surub autoperforant tavan", "surub gips plafon", "autoperforante tavan", "3.5x25 tavan"]
    },
    {
      "position": 6,
      "description": "Ipsos și bandă armare rosturi tavan",
      "um": "kg",
      "consumption_per_m2": 0.3,
      "keywords": ["ipsos rosturi tavan", "chit gips tavan", "Fugenfuller tavan", "ipsos finisaj plafon"]
    }
  ]'::jsonb
),

-- 4. Pereți Compartimentare — Vatâ Fonică
(
  gen_random_uuid(),
  'Pereți Compartimentare — Vatâ Fonică',
  'vata-sistem',
  'mp',
  'active',
  '[
    {
      "position": 1,
      "description": "Placă gips-carton 12.5mm (dublu strat, 2 fețe)",
      "um": "mp",
      "consumption_per_m2": 2.1,
      "keywords": ["gips carton", "rigips 12.5", "placa gips dublu", "GKB perete", "placa gips compartimentare"]
    },
    {
      "position": 2,
      "description": "Profil metalic montant CW75 (L=4m)",
      "um": "ml",
      "consumption_per_m2": 3.0,
      "keywords": ["profil CW75", "CW 75", "profil montant", "CW perete", "profil C75"]
    },
    {
      "position": 3,
      "description": "Profil metalic talpă UW75 (L=3m)",
      "um": "ml",
      "consumption_per_m2": 0.8,
      "keywords": ["profil UW75", "UW 75", "profil talpa perete", "UW perete", "profil U75"]
    },
    {
      "position": 4,
      "description": "Șuruburi autoperforante 3.5×35mm (gips dublu)",
      "um": "buc",
      "consumption_per_m2": 20.0,
      "keywords": ["surub TB 3.5x35", "3.5x35", "autoperforante dublu strat", "surub gips perete", "TB35"]
    },
    {
      "position": 5,
      "description": "Ipsos și bandă armare rosturi pereți",
      "um": "kg",
      "consumption_per_m2": 0.4,
      "keywords": ["ipsos rosturi perete", "chit gips perete", "Fugenfuller perete", "banda armare perete"]
    }
  ]'::jsonb
);

-- Verificare: ar trebui să apară 4 rânduri noi cu category='vata-sistem'
SELECT id, recipe_name, category, status FROM retete_constructii WHERE category = 'vata-sistem';
