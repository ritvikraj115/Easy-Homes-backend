const express = require('express');
const controller = require('../controllers/leadController');

const router = express.Router();

router.post('/enquiry', controller.captureWebsiteEnquiryLead);
router.post('/layout-download', controller.captureLayoutDownloadLead);

module.exports = router;
