const axios = require('axios');

const GOOGLE_PLACES_BASE_URL = 'https://places.googleapis.com/v1/places';
const GOOGLE_FIELD_MASK = 'displayName,rating,userRatingCount,googleMapsUri';
const DEFAULT_KALPAVRUKSHA_PLACE_ID = 'ChIJNRWJPwDvNToR_tPFD6Zsj9s';
const DEFAULT_REVIEW_URL = 'https://share.google/OHvpBdiGZ7sqZGHYR';
const CACHE_TTL_MS = 15 * 60 * 1000;

let kalpavrukshaReviewsCache = null;

class GoogleReviewsServiceError extends Error {
  constructor(message, statusCode = 500, code = 'GOOGLE_REVIEWS_FAILED', details = null) {
    super(message);
    this.name = 'GoogleReviewsServiceError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function normalizeRating(value) {
  const numericRating = Number(value);
  if (!Number.isFinite(numericRating)) return null;
  return numericRating.toFixed(1);
}

function normalizeReviewCount(value) {
  const numericCount = Number(value);
  if (!Number.isFinite(numericCount)) return null;
  return String(Math.max(0, Math.round(numericCount)));
}

function isCacheFresh(cacheEntry) {
  return Boolean(cacheEntry && Date.now() - cacheEntry.cachedAt < CACHE_TTL_MS);
}

async function fetchKalpavrukshaGoogleReviews() {
  if (isCacheFresh(kalpavrukshaReviewsCache)) {
    return kalpavrukshaReviewsCache.data;
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const placeId = process.env.KALPAVRUKSHA_GOOGLE_PLACE_ID || DEFAULT_KALPAVRUKSHA_PLACE_ID;
  const fallbackReviewUrl = process.env.KALPAVRUKSHA_GOOGLE_REVIEW_URL || DEFAULT_REVIEW_URL;

  if (!apiKey) {
    throw new GoogleReviewsServiceError(
      'Google reviews are not configured for Kalpavruksha.',
      503,
      'GOOGLE_REVIEWS_NOT_CONFIGURED',
      {
        hasGoogleMapsApiKey: Boolean(apiKey),
        hasKalpavrukshaPlaceId: Boolean(placeId),
      },
    );
  }

  let response;
  try {
    response = await axios.get(`${GOOGLE_PLACES_BASE_URL}/${encodeURIComponent(placeId)}`, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': GOOGLE_FIELD_MASK,
      },
      timeout: 8000,
    });
  } catch (error) {
    throw new GoogleReviewsServiceError(
      'Google reviews could not be fetched.',
      error.response?.status || 502,
      'GOOGLE_REVIEWS_UPSTREAM_FAILED',
      error.response?.data || { message: error.message },
    );
  }

  const place = response.data || {};
  const rating = normalizeRating(place.rating);
  const reviewCount = normalizeReviewCount(place.userRatingCount);

  if (!rating || reviewCount === null) {
    throw new GoogleReviewsServiceError(
      'Google reviews response did not include rating data.',
      502,
      'GOOGLE_REVIEWS_INCOMPLETE_RESPONSE',
      place,
    );
  }

  const data = {
    rating,
    reviewCount,
    reviewUrl: place.googleMapsUri || fallbackReviewUrl,
    source: 'google_places',
    fetchedAt: new Date().toISOString(),
  };

  kalpavrukshaReviewsCache = {
    data,
    cachedAt: Date.now(),
  };

  return data;
}

module.exports = {
  fetchKalpavrukshaGoogleReviews,
  GoogleReviewsServiceError,
};
