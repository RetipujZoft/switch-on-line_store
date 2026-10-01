const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cookieParser = require('cookie-parser');

const productsRouter = require('./routes/products');
const ordersRouter = require('./routes/orders');
const geocodeRouter = require('./routes/geocode');
const { router: adminAuthRouter } = require('./routes/adminAuth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/admin', adminAuthRouter);
app.use('/api/products', productsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/geocode', geocodeRouter);

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`\nSwitch-On server running:`);
  console.log(`  Storefront:  http://localhost:${PORT}/`);
  console.log(`  Admin login: http://localhost:${PORT}/admin.html`);
  console.log(`  PayFast mode: ${(process.env.PAYFAST_MODE || 'sandbox').toUpperCase()}\n`);
});
