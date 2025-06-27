const express = require('express');
const { 
  getProfile, 
  updateProfile, 
  changePassword 
} = require('../controllers/profileController');
const requireAuth = require('../middleware/requireAuth');
const router = express.Router();

// All routes require a logged-in user
router.use(requireAuth);

// GET   /api/profile
router.get('/', getProfile);

// PUT   /api/profile
router.put('/', updateProfile);

// POST  /api/profile/password
router.post('/password', changePassword);

// // GET   /api/profile/favorites
// router.get('/favorites', getFavorites);

// // POST  /api/profile/favorites
// router.post('/favorites', addFavorite);

// // DELETE /api/profile/favorites/:mlsId
// router.delete('/favorites/:mlsId', removeFavorite);

module.exports = router;
