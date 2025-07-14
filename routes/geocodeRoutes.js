const express           = require('express');
const { geocodeAddress } = require('../services/geocodeService');
const router            = express.Router();

/**
 * POST /api/geocode
 * body: { addresses: string[] }
 * returns: { results: { lat, lng }[] }
 */
router.post('/', async (req, res) => {
  try {
    const { addresses } = req.body;
    if (!Array.isArray(addresses)) {
      return res.status(400).json({ error: 'addresses must be an array' });
    }
    const results = await Promise.all(
      addresses.map(addr => geocodeAddress(addr))
    );
    res.json({ results });
  } catch (err) {
    console.error('Geocode error:', err);
    res.status(500).json({ error: 'Geocode failed' });
  }
});

module.exports = router;
