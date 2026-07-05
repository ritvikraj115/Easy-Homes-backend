const express = require('express');
const { fetchKalpavrukshaGoogleReviews } = require('../services/googleReviewsService');

const router = express.Router();

router.get('/kalpavruksha', async (req, res) => {
  try {
    const reviews = await fetchKalpavrukshaGoogleReviews();
    res.json({
      success: true,
      data: reviews,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Google reviews could not be fetched.',
      code: error.code || 'GOOGLE_REVIEWS_FAILED',
      details: error.details || null,
    });
  }
});

module.exports = router;
