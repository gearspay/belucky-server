const express = require('express');
const publicController = require('../controllers/publicController');

const router = express.Router();

// Public routes (no authentication required)
router.get('/games', publicController.getPublicGames);
router.get('/stats', publicController.getPlatformStats);

module.exports = router;