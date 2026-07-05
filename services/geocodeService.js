const { Client } = require('@googlemaps/google-maps-services-js');
const redis        = require('../config/redis');
const client       = new Client();
const TTL_SECONDS  = 24 * 60 * 60; // cache for 1 day
const inFlightGeocodeRequests = new Map();

class GeocodeServiceError extends Error {
  constructor(message, statusCode = 502, code = 'GEOCODE_FAILED') {
    super(message);
    this.name = 'GeocodeServiceError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Returns { lat, lng } for address, using cache when available.
 */
async function geocodeAddress(address) {
  const normalizedAddress = String(address || '').trim();
  if (!normalizedAddress) {
    throw new GeocodeServiceError('Invalid address provided', 400, 'INVALID_ADDRESS');
  }

  if (!process.env.GOOGLE_MAPS_API_KEY) {
    throw new GeocodeServiceError('GOOGLE_MAPS_API_KEY is not configured', 500, 'MISSING_API_KEY');
  }

  const key = `geocode:${normalizedAddress.toLowerCase()}`;
  const cached = await redis.get(key);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (_) {
      // Ignore malformed cache entries and fetch fresh coordinates.
    }
  }

  if (inFlightGeocodeRequests.has(key)) {
    return inFlightGeocodeRequests.get(key);
  }

  const geocodePromise = fetchAndCacheGeocode(normalizedAddress, key);
  inFlightGeocodeRequests.set(key, geocodePromise);

  try {
    return await geocodePromise;
  } finally {
    inFlightGeocodeRequests.delete(key);
  }
}

async function fetchAndCacheGeocode(address, key) {
  let res;
  try {
    res = await client.geocode({
      params: { address, key: process.env.GOOGLE_MAPS_API_KEY }
    });
  } catch (error) {
    const status = error.response?.data?.status;
    const errorMessage = error.response?.data?.error_message;

    if (status === 'REQUEST_DENIED') {
      throw new GeocodeServiceError(
        `Google Geocoding denied the request: ${errorMessage || 'Check API enablement/key restrictions'}`,
        502,
        'REQUEST_DENIED'
      );
    }

    throw new GeocodeServiceError('Failed to reach Google Geocoding service');
  }

  const apiStatus = res.data?.status;
  if (apiStatus === 'ZERO_RESULTS') {
    const emptyResult = { lat: null, lng: null };
    await redis.set(key, JSON.stringify(emptyResult), 'EX', TTL_SECONDS);
    return emptyResult;
  }

  if (apiStatus !== 'OK') {
    const apiMessage = res.data?.error_message || `Google Geocoding returned status ${apiStatus}`;
    throw new GeocodeServiceError(apiMessage, 502, apiStatus || 'GEOCODE_STATUS_ERROR');
  }

  const location = res.data?.results?.[0]?.geometry?.location;
  if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
    throw new GeocodeServiceError('No coordinates returned for the address', 404, 'NO_COORDINATES');
  }

  const { lat, lng } = location;
  await redis.set(key, JSON.stringify({ lat, lng }), 'EX', TTL_SECONDS);
 
  return { lat, lng };
}

module.exports = { geocodeAddress, GeocodeServiceError };
