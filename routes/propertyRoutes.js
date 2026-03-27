const express = require('express');
const axios = require('axios');
const { readProperties } = require('../services/propertyStore');

const router = express.Router();

const BUBBLE_CDN_SUFFIX = '.cdn.bubble.io';
const DEFAULT_IMAGE_CACHE_SECONDS = 60 * 60 * 24 * 365; // 1 year
const DEFAULT_IMAGE_PROXY_TIMEOUT_MS = 15000;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const IMAGE_CACHE_SECONDS = parsePositiveInt(
  process.env.PROPERTY_IMAGE_CACHE_SECONDS,
  DEFAULT_IMAGE_CACHE_SECONDS,
);
const IMAGE_PROXY_TIMEOUT_MS = parsePositiveInt(
  process.env.PROPERTY_IMAGE_PROXY_TIMEOUT_MS,
  DEFAULT_IMAGE_PROXY_TIMEOUT_MS,
);

function isBubbleJpgUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return false;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return false;
  }

  const protocol = parsedUrl.protocol.toLowerCase();
  if (protocol !== 'https:' && protocol !== 'http:') {
    return false;
  }

  const host = parsedUrl.hostname.toLowerCase();
  const isBubbleHost = host === 'cdn.bubble.io' || host.endsWith(BUBBLE_CDN_SUFFIX);
  if (!isBubbleHost) {
    return false;
  }

  const pathname = parsedUrl.pathname.toLowerCase();
  return pathname.endsWith('.jpg') || pathname.endsWith('.jpeg');
}

function getBackendBaseUrl(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim();
  const protocol = forwardedProto || req.protocol;
  const forwardedHost = String(req.headers['x-forwarded-host'] || '')
    .split(',')[0]
    .trim();
  const host = forwardedHost || req.get('host');

  if (host) {
    return `${protocol}://${host}`;
  }

  const configuredBaseUrl = String(process.env.BACKEND_URL || '').trim().replace(/\/+$/, '');
  return configuredBaseUrl || '';
}

function toProxiedImageUrl(imageUrl, req) {
  if (!isBubbleJpgUrl(imageUrl)) {
    return imageUrl;
  }

  const baseUrl = getBackendBaseUrl(req);
  if (!baseUrl) {
    return imageUrl;
  }

  return `${baseUrl}/api/properties/image-proxy?url=${encodeURIComponent(imageUrl)}`;
}

function mapPropertyImagesForClient(property, req) {
  if (!property || typeof property !== 'object') {
    return property;
  }

  const media = property.media;
  if (!media || typeof media !== 'object' || !Array.isArray(media.images)) {
    return property;
  }

  return {
    ...property,
    media: {
      ...media,
      images: media.images.map((imageUrl) => toProxiedImageUrl(imageUrl, req)),
    },
  };
}

router.get('/image-proxy', async (req, res) => {
  const imageUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';

  if (!isBubbleJpgUrl(imageUrl)) {
    return res.status(400).json({
      success: false,
      message: 'Only Bubble CDN JPG image URLs are supported.',
    });
  }

  try {
    const upstream = await axios.get(imageUrl, {
      responseType: 'stream',
      timeout: IMAGE_PROXY_TIMEOUT_MS,
      maxRedirects: 3,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        Accept: 'image/jpeg,image/*;q=0.8,*/*;q=0.1',
      },
    });

    const contentType = String(upstream.headers['content-type'] || '').toLowerCase();
    if (!contentType.startsWith('image/')) {
      upstream.data.destroy();
      return res.status(415).json({
        success: false,
        message: 'Upstream URL did not return an image.',
      });
    }

    res.setHeader('Cache-Control', `public, max-age=${IMAGE_CACHE_SECONDS}, immutable`);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', upstream.headers['content-type']);

    if (upstream.headers['content-length']) {
      res.setHeader('Content-Length', upstream.headers['content-length']);
    }

    upstream.data.on('error', (streamErr) => {
      console.error('Image proxy stream failed:', streamErr.message);
      if (!res.headersSent) {
        res.status(502).json({ success: false, message: 'Failed to stream image.' });
        return;
      }
      res.destroy(streamErr);
    });

    upstream.data.pipe(res);
  } catch (err) {
    const upstreamStatus = err.response?.status;
    if (upstreamStatus) {
      return res.status(upstreamStatus).json({
        success: false,
        message: 'Unable to fetch image from upstream.',
      });
    }

    console.error('Image proxy error:', err.message);
    return res.status(502).json({
      success: false,
      message: 'Failed to fetch image.',
    });
  }
});

router.get('/:mlsNumber', async (req, res) => {
  const requestedMlsNumber =
    typeof req.params.mlsNumber === 'string' ? decodeURIComponent(req.params.mlsNumber).trim() : '';

  if (!requestedMlsNumber) {
    return res.status(400).json({
      success: false,
      message: 'A property MLS number is required.',
    });
  }

  try {
    const properties = await readProperties();
    const property = properties.find((item) => item?.mlsNumber === requestedMlsNumber);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found.',
      });
    }

    return res.json({
      success: true,
      data: mapPropertyImagesForClient(property, req),
    });
  } catch (err) {
    console.error('Failed to read property:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to load property.',
    });
  }
});

router.get('/', async (req, res) => {
  try {
    const properties = await readProperties();
    const propertiesWithCachedImages = properties.map((property) =>
      mapPropertyImagesForClient(property, req),
    );

    res.json({ success: true, data: propertiesWithCachedImages });
  } catch (err) {
    console.error('Failed to read properties:', err);
    res.status(500).json({ success: false, message: 'Failed to load properties' });
  }
});

module.exports = router;
