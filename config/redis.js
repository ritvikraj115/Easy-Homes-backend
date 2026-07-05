// server/config/redis.js
const Redis = require('ioredis');

const REDIS_URL = String(process.env.REDIS_URL || '').trim();
const REDIS_DISABLED = /^(true|1|yes|on)$/i.test(String(process.env.REDIS_DISABLED || ''));
const REDIS_RETRY_COOLDOWN_MS = Number(process.env.REDIS_RETRY_COOLDOWN_MS) || 5 * 60 * 1000;
const MEMORY_CACHE_MAX_ITEMS = Number(process.env.MEMORY_CACHE_MAX_ITEMS) || 5000;
const MEMORY_CACHE_SWEEP_MS = Number(process.env.MEMORY_CACHE_SWEEP_MS) || 10 * 60 * 1000;

const memoryCache = new Map();
let redis = null;
let connectPromise = null;
let redisUnavailableUntil = 0;
let hasLoggedUnavailable = false;

function getNow() {
  return Date.now();
}

function parseTtlMs(args = []) {
  for (let index = 0; index < args.length - 1; index += 1) {
    const flag = String(args[index] || '').toUpperCase();
    const value = Number(args[index + 1]);

    if (!Number.isFinite(value) || value <= 0) continue;
    if (flag === 'EX') return value * 1000;
    if (flag === 'PX') return value;
  }

  return null;
}

function sweepExpiredMemoryCache() {
  const now = getNow();
  for (const [key, entry] of memoryCache.entries()) {
    if (entry.expiresAt && entry.expiresAt <= now) {
      memoryCache.delete(key);
    }
  }
}

function trimMemoryCache() {
  while (memoryCache.size > MEMORY_CACHE_MAX_ITEMS) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey === undefined) break;
    memoryCache.delete(oldestKey);
  }
}

function getMemoryValue(key) {
  const entry = memoryCache.get(key);
  if (!entry) return null;

  if (entry.expiresAt && entry.expiresAt <= getNow()) {
    memoryCache.delete(key);
    return null;
  }

  // Refresh insertion order so frequently used keys survive max-size trimming.
  memoryCache.delete(key);
  memoryCache.set(key, entry);
  return entry.value;
}

function setMemoryValue(key, value, ttlMs = null) {
  memoryCache.set(key, {
    value,
    expiresAt: ttlMs ? getNow() + ttlMs : null,
  });
  trimMemoryCache();
}

function deleteMemoryValue(keys) {
  keys.flat().forEach((key) => {
    if (key !== undefined && key !== null) {
      memoryCache.delete(String(key));
    }
  });
}

function markRedisUnavailable(error) {
  redisUnavailableUntil = getNow() + REDIS_RETRY_COOLDOWN_MS;

  if (!hasLoggedUnavailable) {
    hasLoggedUnavailable = true;
    console.warn('[redis] unavailable; using in-memory cache fallback.', {
      message: error?.message || String(error || 'Unknown Redis error'),
      retryInMs: REDIS_RETRY_COOLDOWN_MS,
    });
  }

  if (redis) {
    redis.disconnect();
    redis = null;
  }
  connectPromise = null;
}

function canUseRedis() {
  if (REDIS_DISABLED || !REDIS_URL) return false;
  return getNow() >= redisUnavailableUntil;
}

function createRedisClient() {
  const client = new Redis(REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS) || 1500,
    retryStrategy(times) {
      return times <= 1 ? 250 : null;
    },
  });

  client.on('ready', () => {
    hasLoggedUnavailable = false;
    redisUnavailableUntil = 0;
    console.log('[redis] connected');
  });

  client.on('error', (error) => {
    markRedisUnavailable(error);
  });

  return client;
}

async function getRedisClient() {
  if (!canUseRedis()) return null;

  if (!redis) {
    redis = createRedisClient();
  }

  if (redis.status === 'ready') {
    return redis;
  }

  if (!connectPromise) {
    connectPromise = redis.connect()
      .then(() => redis)
      .catch((error) => {
        markRedisUnavailable(error);
        return null;
      })
      .finally(() => {
        connectPromise = null;
      });
  }

  return connectPromise;
}

const sweepTimer = setInterval(sweepExpiredMemoryCache, MEMORY_CACHE_SWEEP_MS);
if (typeof sweepTimer.unref === 'function') {
  sweepTimer.unref();
}

module.exports = {
  async get(key) {
    const normalizedKey = String(key);
    const memoryValue = getMemoryValue(normalizedKey);
    if (memoryValue !== null) return memoryValue;

    const client = await getRedisClient();
    if (!client) return null;

    try {
      const value = await client.get(normalizedKey);
      if (value !== null) {
        setMemoryValue(normalizedKey, value);
      }
      return value;
    } catch (error) {
      markRedisUnavailable(error);
      return null;
    }
  },

  async set(key, value, ...args) {
    const normalizedKey = String(key);
    const ttlMs = parseTtlMs(args);
    setMemoryValue(normalizedKey, value, ttlMs);

    const client = await getRedisClient();
    if (!client) return 'OK';

    try {
      return await client.set(normalizedKey, value, ...args);
    } catch (error) {
      markRedisUnavailable(error);
      return 'OK';
    }
  },

  async del(...keys) {
    deleteMemoryValue(keys);

    const client = await getRedisClient();
    if (!client) return 0;

    try {
      return await client.del(...keys);
    } catch (error) {
      markRedisUnavailable(error);
      return 0;
    }
  },
};
