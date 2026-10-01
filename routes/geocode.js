const express = require('express');
const router = express.Router();

// Simple in-memory cache so repeated keystrokes for the same query don't
// keep hitting the upstream service.
const cache = new Map();
const CACHE_TTL_MS = 1000 * 60 * 30;

router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 3) return res.json([]);

  const cached = cache.get(q);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return res.json(cached.results);
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=za&q=${encodeURIComponent(q)}`;
    const upstream = await fetch(url, {
      headers: {
        // Nominatim's usage policy requires a real identifying User-Agent —
        // update the contact detail here if you'd like it to point at you.
        'User-Agent': 'SwitchOnStore/1.0 (contact: store-admin@switch-on.co.za)'
      }
    });
    if (!upstream.ok) throw new Error(`Upstream status ${upstream.status}`);
    const data = await upstream.json();
    const results = data.map(r => ({
      label: r.display_name,
      lat: r.lat,
      lon: r.lon
    }));
    cache.set(q, { at: Date.now(), results });
    res.json(results);
  } catch (err) {
    console.error('Address search failed:', err.message);
    res.json([]); // fail quietly — the customer can still type their address manually
  }
});

module.exports = router;
