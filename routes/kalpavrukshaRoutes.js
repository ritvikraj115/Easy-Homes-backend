const express = require('express');
const { readKalpavrukshaContent } = require('../services/kalpavrukshaContentStore');

const router = express.Router();

router.get('/content', async (req, res) => {
  try {
    const content = await readKalpavrukshaContent();
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ success: true, data: content });
  } catch (err) {
    console.error('Failed to read Kalpavruksha content:', err);
    return res.status(500).json({ success: false, message: 'Failed to load Kalpavruksha content' });
  }
});

module.exports = router;
