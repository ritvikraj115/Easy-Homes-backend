const express = require('express');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const requireAdminAuth = require('../middleware/requireAdminAuth');
const { readProperties, writeProperties } = require('../services/propertyStore');
const {
  readKalpavrukshaContent,
  writeKalpavrukshaContent,
} = require('../services/kalpavrukshaContentStore');

const router = express.Router();
const KALPAVRUKSHA_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'kalpavruksha');
const KALPAVRUKSHA_UPLOAD_URL_PREFIX = '/uploads/kalpavruksha';
const KALPAVRUKSHA_IMAGE_MIME_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/avif', '.avif'],
]);
const KALPAVRUKSHA_MAX_IMAGE_SIZE_BYTES = 6 * 1024 * 1024;

function ensureKalpavrukshaUploadDir() {
  fs.mkdirSync(KALPAVRUKSHA_UPLOAD_DIR, { recursive: true });
}

function sanitizeFileStem(value) {
  const stem = path.basename(String(value || 'site-image'), path.extname(String(value || '')));
  return stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'site-image';
}

const kalpavrukshaImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, callback) => {
      try {
        ensureKalpavrukshaUploadDir();
        callback(null, KALPAVRUKSHA_UPLOAD_DIR);
      } catch (err) {
        callback(err);
      }
    },
    filename: (req, file, callback) => {
      const extension = KALPAVRUKSHA_IMAGE_MIME_TYPES.get(file.mimetype);
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      callback(null, `${sanitizeFileStem(file.originalname)}-${suffix}${extension}`);
    },
  }),
  limits: {
    fileSize: KALPAVRUKSHA_MAX_IMAGE_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (req, file, callback) => {
    if (!KALPAVRUKSHA_IMAGE_MIME_TYPES.has(file.mimetype)) {
      return callback(new Error('Only JPG, PNG, WebP, GIF, or AVIF images are allowed'));
    }
    return callback(null, true);
  },
});

function validatePropertyPayload(property) {
  if (!property || typeof property !== 'object') {
    return 'property object is required';
  }
  if (!property.mlsNumber || typeof property.mlsNumber !== 'string') {
    return 'property.mlsNumber is required';
  }
  if (!property.name || typeof property.name !== 'string') {
    return 'property.name is required';
  }
  return null;
}

function validateKalpavrukshaContent(content) {
  if (!content || !Array.isArray(content.siteImages)) {
    return 'siteImages array is required';
  }
  if (content.siteImages.length > 12) {
    return 'A maximum of 12 site images is supported';
  }

  for (const [index, item] of content.siteImages.entries()) {
    if (!String(item?.label || '').trim()) {
      return `Site image ${index + 1} requires a label`;
    }

    const imageUrl = String(item?.imageUrl || '').trim();
    if (!imageUrl) continue;
    if (imageUrl.startsWith('/')) continue;

    try {
      const parsed = new URL(imageUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return `Site image ${index + 1} must use an http(s) URL`;
      }
    } catch {
      return `Site image ${index + 1} has an invalid image URL`;
    }
  }

  return null;
}

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const expectedUsername = process.env.ADMIN_USERNAME || process.env.ADMIN_EMAIL;
  const expectedPassword = process.env.ADMIN_PASSWORD;
  const secret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;

  if (!expectedUsername || !expectedPassword || !secret) {
    return res.status(500).json({
      success: false,
      message: 'Admin credentials are not configured on server',
    });
  }

  if (username !== expectedUsername || password !== expectedPassword) {
    return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
  }

  const token = jwt.sign(
    { type: 'admin', username: expectedUsername },
    secret,
    { expiresIn: '12h' }
  );

  return res.json({ success: true, token });
});

router.get('/properties', requireAdminAuth, async (req, res) => {
  try {
    const properties = await readProperties();
    res.json({ success: true, data: properties });
  } catch (err) {
    console.error('Failed to read admin properties:', err);
    res.status(500).json({ success: false, message: 'Failed to load properties' });
  }
});

router.get('/kalpavruksha/content', requireAdminAuth, async (req, res) => {
  try {
    const content = await readKalpavrukshaContent();
    return res.json({ success: true, data: content });
  } catch (err) {
    console.error('Failed to read Kalpavruksha admin content:', err);
    return res.status(500).json({ success: false, message: 'Failed to load Kalpavruksha content' });
  }
});

router.post('/kalpavruksha/content/site-image', requireAdminAuth, (req, res) => {
  kalpavrukshaImageUpload.single('image')(req, res, (err) => {
    if (err) {
      const isSizeError = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({
        success: false,
        message: isSizeError
          ? 'Image must be 6MB or smaller'
          : err.message || 'Failed to upload image',
      });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Image file is required' });
    }

    const imageUrl = `${KALPAVRUKSHA_UPLOAD_URL_PREFIX}/${req.file.filename}`;
    return res.json({
      success: true,
      data: {
        imageUrl,
        originalName: req.file.originalname,
        size: req.file.size,
      },
    });
  });
});

router.put('/kalpavruksha/content', requireAdminAuth, async (req, res) => {
  try {
    const validationError = validateKalpavrukshaContent(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const content = await writeKalpavrukshaContent(req.body);
    return res.json({ success: true, data: content });
  } catch (err) {
    console.error('Failed to update Kalpavruksha admin content:', err);
    return res.status(500).json({ success: false, message: 'Failed to save Kalpavruksha content' });
  }
});

router.post('/properties/upsert', requireAdminAuth, async (req, res) => {
  try {
    const { originalMlsNumber, property } = req.body || {};
    const validationError = validatePropertyPayload(property);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const properties = await readProperties();
    const matchMls = originalMlsNumber || property.mlsNumber;
    const existingIndex = properties.findIndex((p) => p.mlsNumber === matchMls);
    const duplicateIndex = properties.findIndex(
      (p, index) => p.mlsNumber === property.mlsNumber && index !== existingIndex
    );

    if (duplicateIndex >= 0) {
      return res.status(409).json({
        success: false,
        message: `Another property already uses MLS number ${property.mlsNumber}`,
      });
    }

    let action = 'created';
    if (existingIndex >= 0) {
      properties[existingIndex] = property;
      action = 'updated';
    } else {
      properties.push(property);
    }

    await writeProperties(properties);
    return res.json({ success: true, action, data: properties });
  } catch (err) {
    console.error('Failed to upsert property:', err);
    return res.status(500).json({ success: false, message: 'Failed to save property' });
  }
});

module.exports = router;
