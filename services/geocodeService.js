const { Client } = require('@googlemaps/google-maps-services-js');
const redis        = require('../config/redis');
const client       = new Client();
const TTL_SECONDS  = 24 * 60 * 60; // cache for 1 day

/**
 * Returns { lat, lng } for address, using Redis as cache.
 */
async function geocodeAddress(address) {
  const key = `geocode:${address}`;
  const cached = await redis.get(key);
  if (cached) {
    return JSON.parse(cached);
  }
  const res = await client.geocode({
    params: { address, key: process.env.GOOGLE_MAPS_API_KEY }
  });
  const { lat, lng } = res.data.results[0].geometry.location;
  try {
     await redis.set(key, JSON.stringify({ lat, lng }), 'EX', TTL_SECONDS);
    
  } catch (error) {
    console.log(error);
    
  }
 
  return { lat, lng };
}

module.exports = { geocodeAddress };
