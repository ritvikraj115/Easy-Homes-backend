const express = require('express');
const jwt = require('jsonwebtoken');
const requireAdminAuth = require('../middleware/requireAdminAuth');
const { readProperties, writeProperties } = require('../services/propertyStore');

const router = express.Router();

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
