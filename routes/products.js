const express = require('express');
const fs = require('fs');
const path = require('path');
const { db } = require('../db/database');
const { requireAdmin } = require('./adminAuth');

const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads', 'products');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_TYPES = ['tee', 'hoodie', 'beanie'];
const ALLOWED_PRINTS = ['logo', 'back'];
const ALLOWED_BACK_DESIGNS = ['none', 'signature', 'sitter', 'basketball', 'thumbsup', 'speech'];

function saveDataUrlImage(dataUrl, destPathNoExt) {
  if (!dataUrl || !dataUrl.startsWith('data:image')) return null;
  const match = dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if (!match) return null;
  const ext = match[1] === 'jpeg' ? 'jpg' : 'png';
  const buffer = Buffer.from(match[2], 'base64');
  const fullPath = `${destPathNoExt}.${ext}`;
  fs.writeFileSync(fullPath, buffer);
  return fullPath;
}

function validateProductFields(body, { partial = false } = {}) {
  const errors = [];
  const out = {};

  if (!partial || body.name !== undefined) {
    if (!body.name || !body.name.trim()) errors.push('Name is required.');
    out.name = (body.name || '').trim();
  }
  if (!partial || body.product_type !== undefined) {
    if (!ALLOWED_TYPES.includes(body.product_type)) errors.push(`product_type must be one of: ${ALLOWED_TYPES.join(', ')}`);
    out.product_type = body.product_type;
  }
  if (!partial || body.garment_color) {
    const c = body.garment_color || '#1c1d1d';
    if (!/^#[0-9a-fA-F]{6}$/.test(c)) errors.push('garment_color must be a hex colour like #141414.');
    out.garment_color = c;
  }
  if (!partial || body.print_type) {
    const pt = body.print_type || 'logo';
    if (!ALLOWED_PRINTS.includes(pt)) errors.push(`print_type must be one of: ${ALLOWED_PRINTS.join(', ')}`);
    out.print_type = pt;
  }
  if (!partial || body.back_design) {
    const bd = body.back_design || 'none';
    if (!ALLOWED_BACK_DESIGNS.includes(bd)) errors.push(`back_design must be one of: ${ALLOWED_BACK_DESIGNS.join(', ')}`);
    out.back_design = bd;
  }
  if (!partial || body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) errors.push('price must be a positive number.');
    out.price = Math.round(price);
  }

  return { errors, out };
}

// ---------- public: active products for the storefront ----------
router.get('/', (req, res) => {
  const rows = db.prepare(`SELECT * FROM products WHERE active = 1 ORDER BY id`).all();
  res.json(rows);
});

// ---------- admin: every product, active or not ----------
router.get('/all', requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT * FROM products ORDER BY id DESC`).all();
  res.json(rows);
});

// ---------- admin: create a product ----------
router.post('/', requireAdmin, express.json({ limit: '15mb' }), (req, res) => {
  const { errors, out } = validateProductFields(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const stamp = Date.now();
  let photoUrl = null, photoBackUrl = null;
  if (req.body.photo) {
    const saved = saveDataUrlImage(req.body.photo, path.join(UPLOADS_DIR, `product-${stamp}-front`));
    if (saved) photoUrl = `/uploads/products/${path.basename(saved)}`;
  }
  if (req.body.photo_back) {
    const saved = saveDataUrlImage(req.body.photo_back, path.join(UPLOADS_DIR, `product-${stamp}-back`));
    if (saved) photoBackUrl = `/uploads/products/${path.basename(saved)}`;
  }
  if (!photoUrl) return res.status(400).json({ error: 'Please upload the front photo (PNG or JPG).' });

  const info = db.prepare(`
    INSERT INTO products (name, product_type, garment_color, print_type, back_design, price, photo_url, photo_back_url, is_real_photo, active)
    VALUES (@name, @product_type, @garment_color, @print_type, @back_design, @price, @photo_url, @photo_back_url, 1, 1)
  `).run({ ...out, photo_url: photoUrl, photo_back_url: photoBackUrl });

  const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(info.lastInsertRowid);
  res.status(201).json(product);
});

// ---------- admin: update a product ----------
router.put('/:id', requireAdmin, express.json({ limit: '15mb' }), (req, res) => {
  const existing = db.prepare(`SELECT * FROM products WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found.' });

  const { errors, out } = validateProductFields(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const stamp = Date.now();
  let photoUrl = existing.photo_url;
  let photoBackUrl = existing.photo_back_url;
  let isReal = existing.is_real_photo;
  if (req.body.photo) {
    const saved = saveDataUrlImage(req.body.photo, path.join(UPLOADS_DIR, `product-${stamp}-front`));
    if (saved) { photoUrl = `/uploads/products/${path.basename(saved)}`; isReal = 1; }
  }
  if (req.body.photo_back) {
    const saved = saveDataUrlImage(req.body.photo_back, path.join(UPLOADS_DIR, `product-${stamp}-back`));
    if (saved) photoBackUrl = `/uploads/products/${path.basename(saved)}`;
  }
  if (req.body.remove_back) photoBackUrl = null;

  const merged = { ...existing, ...out, photo_url: photoUrl, photo_back_url: photoBackUrl, is_real_photo: isReal };
  db.prepare(`
    UPDATE products SET name=@name, product_type=@product_type, garment_color=@garment_color,
      print_type=@print_type, back_design=@back_design, price=@price, photo_url=@photo_url,
      photo_back_url=@photo_back_url, is_real_photo=@is_real_photo
    WHERE id=@id
  `).run({ ...merged, id: req.params.id });

  res.json(db.prepare(`SELECT * FROM products WHERE id = ?`).get(req.params.id));
});

// ---------- admin: activate/deactivate (soft delete — keeps order history intact) ----------
router.post('/:id/toggle', requireAdmin, (req, res) => {
  const existing = db.prepare(`SELECT * FROM products WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found.' });
  const nextActive = existing.active ? 0 : 1;
  db.prepare(`UPDATE products SET active = ? WHERE id = ?`).run(nextActive, req.params.id);
  res.json({ ok: true, active: !!nextActive });
});

module.exports = router;
