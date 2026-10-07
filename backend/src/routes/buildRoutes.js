const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const buildController = require('../controllers/buildController');

router.post('/build/upload', upload.single('file'), (req, res, next) => buildController.uploadAab(req, res, next));
router.get('/builds', (req, res, next) => buildController.listBuilds(req, res, next));
router.get('/build/:id', (req, res, next) => buildController.getBuild(req, res, next));
router.post('/build/:id/analyze', (req, res, next) => buildController.analyzeBuild(req, res, next));
router.delete('/build/:id', (req, res, next) => buildController.deleteBuild(req, res, next));

module.exports = router;
