const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'switch-on.sqlite');
const isNewDb = !fs.existsSync(DB_PATH);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  product_type TEXT NOT NULL,        -- tee | hoodie | beanie
  garment_color TEXT NOT NULL,       -- hex
  print_type TEXT NOT NULL,          -- logo | back
  back_design TEXT,                  -- none | sitter | basketball | thumbsup | speech
  price INTEGER NOT NULL,            -- rand, integer
  photo_url TEXT,
  photo_back_url TEXT,
  is_real_photo INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_ref TEXT UNIQUE NOT NULL,       -- human-friendly ref e.g. SO-1001
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  fulfilment TEXT NOT NULL,             -- delivery | collection
  address TEXT,
  notes TEXT,
  total INTEGER NOT NULL,               -- rand
  status TEXT NOT NULL DEFAULT 'pending_payment',
  -- pending_payment | paid | in_production | shipped | completed | cancelled
  payment_ref TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  garment_color TEXT,
  personalisation_text TEXT,
  price INTEGER NOT NULL,
  front_image_path TEXT,
  back_image_path TEXT
);
`);

// migrate older databases: add the back-photo column if it's missing
if (!db.prepare(`PRAGMA table_info(products)`).all().some(c => c.name === 'photo_back_url')) {
  db.exec(`ALTER TABLE products ADD COLUMN photo_back_url TEXT`);
}

// The full real colour range, sampled directly from the product photography.
const COLOR_PALETTE = [
  { key: 'black',     label: 'Black',      hex: '#1c1d1d' },
  { key: 'cream',     label: 'Cream',      hex: '#f6e6cd' },
  { key: 'mint',      label: 'Mint Green', hex: '#aed6c1' },
  { key: 'white',     label: 'White',      hex: '#e2e1e6' },
  { key: 'orange',    label: 'Orange',     hex: '#fb5805' },
  { key: 'yellow',    label: 'Yellow',     hex: '#fdd421' },
  { key: 'purple',    label: 'Purple',     hex: '#512377' },
  { key: 'pink',      label: 'Pink',       hex: '#fa6995' },
  { key: 'red',       label: 'Red',        hex: '#d4080f' },
  { key: 'lightblue', label: 'Light Blue', hex: '#88d6f5' },
  { key: 'royalblue', label: 'Royal Blue', hex: '#0444aa' },
  { key: 'grey',      label: 'Grey',       hex: '#9c9c9c' },
  { key: 'navy',      label: 'Navy',       hex: '#1c263f' },
  { key: 'beige',     label: 'Beige',      hex: '#edd5b8' },
  { key: 'aqua',      label: 'Aqua',       hex: '#90dae8' },
  { key: 'maroon',    label: 'Maroon',     hex: '#661626' }
];
// beanies weren't shot in every colour — only seed the ones we actually have photos for
const BEANIE_COLORS = COLOR_PALETTE.map(c => c.key); // all 16 designed beanies exist

// ---------------------------------------------------------------------------
// KNOWN BAD SEED PHOTOS
// ---------------------------------------------------------------------------
// The seed photography in public/uploads/seed/ was cropped from colour-swatch
// grid sheets. For most colours the crop is clean, but for the combinations
// below the source image itself is defective in one of three ways:
//   'fused'    - two garments are touching with no background gap between
//                them in the original photo, so no amount of cropping can
//                separate them (they render as if two products overlap).
//   'mismatch' - the file shows the wrong colour garment entirely (e.g. the
//                file for "beige" actually contains a navy hoodie).
//   'broken'   - the garment itself was accidentally keyed out as background
//                (this happened to every "white" variant) or the file is a
//                near-empty/degenerate crop with no usable photo at all.
// None of these can be fixed by re-cropping or by CSS - they need a real
// reshoot/re-export of that specific garment+colour. Until then we seed the
// product but set active:0 so it never appears in the storefront. Flip
// active back to 1 (or use the admin "toggle active" control) once a real
// photo_url has been supplied for that row.
const BAD_HOODIE_FRONT = new Set([]);
const BAD_HOODIE_BACK  = new Set([]);
const BAD_TEE_FRONT    = new Set([]);
const BAD_TEE_BACK     = new Set([]);
const BAD_BEANIE       = new Set(['pink', 'royalblue', 'white', 'lightblue']);

// seed products once, on first run
if (isNewDb) {
  const insert = db.prepare(`
    INSERT INTO products (name, product_type, garment_color, print_type, back_design, price, photo_url, is_real_photo, active)
    VALUES (@name, @product_type, @garment_color, @print_type, @back_design, @price, @photo_url, @is_real_photo, @active)
  `);
  const seed = db.transaction((rows) => rows.forEach(r => insert.run(r)));

  const rows = [];

  COLOR_PALETTE.forEach(({ key, label, hex }) => {
    // logo-only tee
    rows.push({
      name: `Classic Tee — ${label}`, product_type: 'tee', garment_color: hex,
      print_type: 'logo', back_design: 'none', price: 280,
      photo_url: `/uploads/seed/tee_designed_${key}_front.png`, is_real_photo: 1,
      active: BAD_TEE_FRONT.has(key) ? 0 : 1
    });
    // signature back-design tee (each colour's own real back print)
    rows.push({
      name: `${label} Signature Tee`, product_type: 'tee', garment_color: hex,
      print_type: 'back', back_design: 'signature', price: 310,
      photo_url: `/uploads/seed/tee_designed_${key}_back.png`, is_real_photo: 1,
      active: BAD_TEE_BACK.has(key) ? 0 : 1
    });
    // logo-only hoodie
    rows.push({
      name: `Classic Hoodie — ${label}`, product_type: 'hoodie', garment_color: hex,
      print_type: 'logo', back_design: 'none', price: 482,
      photo_url: `/uploads/seed/hoodie_designed_${key}_front.png`, is_real_photo: 1,
      active: BAD_HOODIE_FRONT.has(key) ? 0 : 1
    });
    // signature back-design hoodie
    rows.push({
      name: `${label} Signature Hoodie`, product_type: 'hoodie', garment_color: hex,
      print_type: 'back', back_design: 'signature', price: 500,
      photo_url: `/uploads/seed/hoodie_designed_${key}_back.png`, is_real_photo: 1,
      active: BAD_HOODIE_BACK.has(key) ? 0 : 1
    });
  });

  BEANIE_COLORS.forEach(key => {
    const { label, hex } = COLOR_PALETTE.find(c => c.key === key);
    rows.push({
      name: `Beanie — ${label}`, product_type: 'beanie', garment_color: hex,
      print_type: 'logo', back_design: 'none', price: 100,
      photo_url: `/uploads/seed/beanie_designed_${key}.png`, is_real_photo: 1,
      active: BAD_BEANIE.has(key) ? 0 : 1
    });
  });

  seed(rows);
  const disabledCount = rows.filter(r => r.active === 0).length;
  console.log(`Seeded product catalogue (first run) — ${rows.length} products across ${COLOR_PALETTE.length} colours (${disabledCount} disabled pending real photos).`);
}

function nextOrderRef() {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM orders`).get();
  return `SO-${1000 + row.n + 1}`;
}

module.exports = { db, nextOrderRef, COLOR_PALETTE };
