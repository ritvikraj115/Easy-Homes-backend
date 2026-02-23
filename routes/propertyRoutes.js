const express = require('express');
const { readProperties } = require('../services/propertyStore');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const properties = await readProperties();
    res.json({ success: true, data: properties });
  } catch (err) {
    console.error('Failed to read properties:', err);
    res.status(500).json({ success: false, message: 'Failed to load properties' });
  }
});

module.exports = router;
