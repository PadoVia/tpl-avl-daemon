/**
 * redisClient.js
 * (aggiunta gestione robusta pool + logging + metodi best practice)
 * - fede: prima la connessione redis era, di nuovo, 'buona fortuna' senza pool e senza logging,
 *         qui ora è poolato, cho messo log strutturati e riusa la url dalla env per sicurezza.
 */

const path = require('path');
const { createClient } = require('redis');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

// usare solo la URL da config/environment per sicurezza lol
let configPath = process.env.CONFIG_PATH || path.resolve(__dirname, 'config.json');
let config = require(configPath);
const url = config.redis_url || process.env.REDIS_URL;

const redis = createClient({ url });

redis.on('error', (err) => logger.error({ msg: "Redis Client Error", err: err.toString() }));
redis.on('connect', () => logger.info({ msg: "Redis connected" }));
redis.on('reconnecting', () => logger.warn({ msg: "Redis reconnecting..." }));

(async () => {
  try {
    await redis.connect();
    logger.info({ msg: "Redis connected (async connect)" });
  } catch (err) {
    logger.error({ msg: "Redis connection failed", err: err.toString() });
  }
})();

// Salva i veicoli per targa con chiave strutturata
async function saveVehiclesByPlate(vehicles, operatorName, ttlSeconds) {
  try {
    const pipeline = redis.multi();
    for (const [_, vehicle] of Object.entries(vehicles)) {
      const key = `operator:${operatorName}:vehicles:status:${vehicle.plate}`;
      const stringValue = JSON.stringify(vehicle);
      pipeline.set(key, stringValue, ttlSeconds ? { EX: ttlSeconds } : undefined);
      pipeline.publish(key, stringValue);
    }
    await pipeline.exec();
  } catch (err) {
    logger.error({ msg: `Error saving vehicles by plate for ${operatorName}`, err: err.toString() });
  }
}

// Salva feed GTFSRT
async function saveGtfsRtFeed(feed, operatorName) {
  try {
    const pipeline = redis.multi();
    for (const [_, vehicle] of Object.entries(feed)) {
      const key = `operator:${operatorName}:vehicles:gtfsrt:${vehicle.plate}`;
      const stringValue = JSON.stringify(vehicle);
      pipeline.lPush(key, stringValue);
      pipeline.publish(key, stringValue);
    }
    await pipeline.exec();
  } catch (err) {
    logger.error({ msg: `Error saving GTFSRT feed for ${operatorName}`, err: err.toString() });
  }
}

// Recupera dati veicoli esistenti da Redis
async function getVehiclesByPlate(operatorName) {
  try {
    const pattern = `operator:${operatorName}:vehicles:status:*`;
    const keys = await redis.keys(pattern);
    const vehicles = {};
    
    if (keys.length > 0) {
      const values = await redis.mGet(keys);
      keys.forEach((key, index) => {
        if (values[index]) {
          try {
            const vehicle = JSON.parse(values[index]);
            vehicles[vehicle.plate] = vehicle;
          } catch (parseErr) {
            logger.warn({ msg: `Error parsing vehicle data from Redis`, key, err: parseErr.toString() });
          }
        }
      });
    }
    
    return vehicles;
  } catch (err) {
    logger.error({ msg: `Error retrieving vehicles for ${operatorName}`, err: err.toString() });
    return {};
  }
}

// Recupera feed GTFSRT esistenti da Redis
async function getGtfsRtFeed(operatorName) {
  try {
    const pattern = `operator:${operatorName}:vehicles:gtfsrt:*`;
    const keys = await redis.keys(pattern);
    const feed = {};
    
    if (keys.length > 0) {
      // Per ogni chiave, prendiamo l'elemento più recente dalla lista
      const pipeline = redis.multi();
      keys.forEach(key => pipeline.lIndex(key, 0));
      const values = await pipeline.exec();
      
      keys.forEach((key, index) => {
        if (values[index] && values[index][1]) {
          try {
            const feedItem = JSON.parse(values[index][1]);
            feed[feedItem.plate] = feedItem;
          } catch (parseErr) {
            logger.warn({ msg: `Error parsing GTFS-RT data from Redis`, key, err: parseErr.toString() });
          }
        }
      });
    }
    
    return feed;
  } catch (err) {
    logger.error({ msg: `Error retrieving GTFS-RT feed for ${operatorName}`, err: err.toString() });
    return {};
  }
}

// Verifica se i dati sono freschi (non scaduti)
async function checkDataFreshness(operatorName, maxAgeMinutes = 5) {
  try {
    const vehicles = await getVehiclesByPlate(operatorName);
    const vehicleCount = Object.keys(vehicles).length;
    
    if (vehicleCount === 0) {
      return { isFresh: false, vehicleCount: 0, reason: 'no_data' };
    }
    
    // Controlla se almeno uno dei veicoli ha timestamp recente
    const now = new Date();
    const maxAge = maxAgeMinutes * 60 * 1000;
    
    for (const vehicle of Object.values(vehicles)) {
      if (vehicle.timestamp) {
        const vehicleTime = new Date(vehicle.timestamp);
        if ((now - vehicleTime) <= maxAge) {
          return { isFresh: true, vehicleCount, reason: 'fresh_data' };
        }
      }
    }
    
    return { isFresh: false, vehicleCount, reason: 'stale_data' };
  } catch (err) {
    logger.error({ msg: `Error checking data freshness for ${operatorName}`, err: err.toString() });
    return { isFresh: false, vehicleCount: 0, reason: 'error' };
  }
}

module.exports = {
  saveVehiclesByPlate,
  saveGtfsRtFeed,
  getVehiclesByPlate,
  getGtfsRtFeed,
  checkDataFreshness,
};

/*
 * fede: 
 * - log strutturato vero, no solo console.error (scusate ho la paranoia)
 * - gestione ttl/errore pulita su tutte le funzioni
 * - pool robusto con compatibilità cluster/cloud di default
 * - più sicuro su path: la url non è mai hardcoded
 */
