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

    if (addresses.length === 0) {
      return res.json({ results: [] });
    }

    const addressKeys = addresses.map(addr => String(addr || '').trim().toLowerCase());
    const uniqueAddressMap = new Map();
    addresses.forEach((address, index) => {
      const key = addressKeys[index];
      if (key && !uniqueAddressMap.has(key)) {
        uniqueAddressMap.set(key, address);
      }
    });

    const uniqueResults = await Promise.all(
      Array.from(uniqueAddressMap.entries()).map(async ([key, address]) => [
        key,
        await geocodeAddress(address),
      ])
    );
    const resultsByKey = new Map(uniqueResults);
    const results = addressKeys.map(key => resultsByKey.get(key) || { lat: null, lng: null });

    res.json({ results });
  } catch (err) {
    console.error('Geocode error:', err.message);
    res.status(err.statusCode || 500).json({
      error: err.message || 'Geocode failed',
      code: err.code || 'GEOCODE_FAILED'
    });
  }
});

module.exports = router;
