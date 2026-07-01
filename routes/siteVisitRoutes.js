const express = require('express');
const router = express.Router();
const controller = require('../controllers/siteVisitController');

// POST /api/site-visits
router.get('/available-slots', controller.getAvailableSlots);
router.post('/', controller.create);

module.exports = router;
