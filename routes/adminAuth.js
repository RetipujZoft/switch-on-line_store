const express = require('express');
const crypto = require('crypto');

const router = express.Router();

// tiny in-memory session store — fine for a single small store's admin dashboard
const sessions = new Set();

function requireAdmin(req, res, next) {
  const token = req.cookies && req.cookies.admin_session;
  if (token && sessions.has(token)) return next();
  return res.status(401).json({ error: 'Not logged in' });
}

router.post('/login', express.json(), (req, res) => {
  const { password } = req.body || {};
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Server has no ADMIN_PASSWORD configured — set one in .env' });
  }
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  sessions.add(token);
  res.cookie('admin_session', token, { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 12 });
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  const token = req.cookies && req.cookies.admin_session;
  if (token) sessions.delete(token);
  res.clearCookie('admin_session');
  res.json({ ok: true });
});

router.get('/check', (req, res) => {
  const token = req.cookies && req.cookies.admin_session;
  res.json({ loggedIn: !!(token && sessions.has(token)) });
});

module.exports = { router, requireAdmin };
