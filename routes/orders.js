const express = require('express');
const fs = require('fs');
const path = require('path');
const { db, nextOrderRef } = require('../db/database');
const { buildPaymentFields, verifyItnSignature, getConfig } = require('./payfast');
const { requireAdmin } = require('./adminAuth');

const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads', 'orders');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ---------- helpers ----------
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

// ---------- create order (public — called from checkout) ----------
router.post('/', express.json({ limit: '25mb' }), (req, res) => {
  const { customer, fulfilment, address, notes, items } = req.body || {};

  if (!customer || !customer.name || !customer.phone) {
    return res.status(400).json({ error: 'Name and phone are required.' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'No items in order.' });
  }

  const orderRef = nextOrderRef();
  const total = items.reduce((sum, it) => sum + Number(it.price || 0), 0);
  const orderDir = path.join(UPLOADS_DIR, orderRef);
  fs.mkdirSync(orderDir, { recursive: true });

  const insertOrder = db.prepare(`
    INSERT INTO orders (order_ref, customer_name, customer_phone, fulfilment, address, notes, total, status)
    VALUES (@order_ref, @customer_name, @customer_phone, @fulfilment, @address, @notes, @total, 'pending_payment')
  `);
  const insertItem = db.prepare(`
    INSERT INTO order_items (order_id, label, garment_color, personalisation_text, price, front_image_path, back_image_path)
    VALUES (@order_id, @label, @garment_color, @personalisation_text, @price, @front_image_path, @back_image_path)
  `);

  const tx = db.transaction(() => {
    const info = insertOrder.run({
      order_ref: orderRef,
      customer_name: customer.name,
      customer_phone: customer.phone,
      fulfilment: fulfilment || 'delivery',
      address: address || '',
      notes: notes || '',
      total
    });
    const orderId = info.lastInsertRowid;

    items.forEach((it, idx) => {
      const frontPath = saveDataUrlImage(it.frontImage, path.join(orderDir, `item${idx + 1}-front`));
      const backPath = it.backImage ? saveDataUrlImage(it.backImage, path.join(orderDir, `item${idx + 1}-back`)) : null;
      insertItem.run({
        order_id: orderId,
        label: it.label || 'Custom item',
        garment_color: it.color || null,
        personalisation_text: it.text || '',
        price: Number(it.price || 0),
        front_image_path: frontPath ? `/uploads/orders/${orderRef}/${path.basename(frontPath)}` : null,
        back_image_path: backPath ? `/uploads/orders/${orderRef}/${path.basename(backPath)}` : null
      });
    });

    return orderId;
  });

  tx();

  // build the PayFast redirect for this order
  const origin = `${req.protocol}://${req.get('host')}`;
  const { fields, processUrl } = buildPaymentFields({
    orderRef,
    amount: total,
    itemName: `Switch-On order ${orderRef}`,
    name: customer.name,
    phone: customer.phone,
    returnUrl: `${origin}/order-success.html?ref=${orderRef}`,
    cancelUrl: `${origin}/order-cancelled.html?ref=${orderRef}`,
    notifyUrl: `${origin}/api/orders/payfast/notify`
  });

  res.json({ orderRef, total, payfast: { processUrl, fields } });
});

// ---------- PayFast ITN webhook (server-to-server) ----------
router.post('/payfast/notify', express.urlencoded({ extended: false }), (req, res) => {
  const body = req.body;
  res.sendStatus(200); // acknowledge immediately, PayFast requires a fast 200

  try {
    const validSignature = verifyItnSignature(body);
    const paymentStatus = body.payment_status;
    const orderRef = body.m_payment_id;
    if (!validSignature) {
      console.warn(`PayFast ITN signature mismatch for ${orderRef}`);
      return;
    }
    if (paymentStatus === 'COMPLETE') {
      db.prepare(`UPDATE orders SET status='paid', payment_ref=@ref, updated_at=datetime('now') WHERE order_ref=@order_ref`)
        .run({ ref: body.pf_payment_id || '', order_ref: orderRef });
      console.log(`Order ${orderRef} marked paid via PayFast ITN.`);
    }
  } catch (err) {
    console.error('PayFast ITN handling error:', err);
  }
});

// ---------- order lookup for the success page (public, minimal info) ----------
router.get('/lookup/:ref', (req, res) => {
  const order = db.prepare(`SELECT order_ref, status, total, customer_name FROM orders WHERE order_ref = ?`).get(req.params.ref);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

// ---------- admin: list all orders ----------
router.get('/', requireAdmin, (req, res) => {
  const orders = db.prepare(`SELECT * FROM orders ORDER BY id DESC`).all();
  const items = db.prepare(`SELECT * FROM order_items WHERE order_id = ?`);
  const full = orders.map(o => ({ ...o, items: items.all(o.id) }));
  res.json(full);
});

// ---------- admin: update order status ----------
router.post('/:id/status', requireAdmin, express.json(), (req, res) => {
  const { status } = req.body || {};
  const allowed = ['pending_payment', 'paid', 'in_production', 'shipped', 'completed', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare(`UPDATE orders SET status=@status, updated_at=datetime('now') WHERE id=@id`).run({ status, id: req.params.id });
  res.json({ ok: true });
});

module.exports = router;
