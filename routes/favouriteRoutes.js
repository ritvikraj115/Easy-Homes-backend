// server/routes/favouriteRoutes.js
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/favouriteController');
const requireAuth = require('../middleware/requireAuth');

router.use(requireAuth);

// GET   /api/favourites
router.get('/', ctrl.getFavourites);

// POST  /api/favourites/:mlsNumber
router.post('/:mlsNumber', ctrl.addFavourite);

// DELETE /api/favourites/:mlsNumber
router.delete('/:mlsNumber', ctrl.removeFavourite);

module.exports = router;
