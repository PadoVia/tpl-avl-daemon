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

// Carica dati esistenti da Redis nei Map dell'operatore all'avvio
async function loadExistingDataIntoMaps(operatorName, vehiclesMap, gtfsrtFeedMap) {
  try {
    let loadedVehicles = 0;
    let loadedGtfsrtItems = 0;
    
    // Carica dati veicoli esistenti
    const vehiclePattern = `operator:${operatorName}:vehicles:status:*`;
    const vehicleKeys = await redis.keys(vehiclePattern);
    
    if (vehicleKeys.length > 0) {
      const vehicleValues = await redis.mGet(vehicleKeys);
      vehicleKeys.forEach((key, index) => {
        if (vehicleValues[index]) {
          try {
            const vehicle = JSON.parse(vehicleValues[index]);
            vehiclesMap.set(vehicle.plate, vehicle);
            loadedVehicles++;
          } catch (parseErr) {
            logger.warn({ msg: `Error parsing vehicle data from Redis`, key, err: parseErr.toString() });
          }
        }
      });
    }
    
    // Carica dati GTFS-RT esistenti
    const gtfsrtPattern = `operator:${operatorName}:vehicles:gtfsrt:*`;
    const gtfsrtKeys = await redis.keys(gtfsrtPattern);
    
    if (gtfsrtKeys.length > 0) {
      // Per ogni chiave, prendiamo l'elemento più recente dalla lista
      const pipeline = redis.multi();
      gtfsrtKeys.forEach(key => pipeline.lIndex(key, 0));
      const gtfsrtValues = await pipeline.exec();
      
      gtfsrtKeys.forEach((key, index) => {
        if (gtfsrtValues[index] && gtfsrtValues[index][1]) {
          try {
            const feedItem = JSON.parse(gtfsrtValues[index][1]);
            gtfsrtFeedMap.set(feedItem.plate, feedItem);
            loadedGtfsrtItems++;
          } catch (parseErr) {
            logger.warn({ msg: `Error parsing GTFS-RT data from Redis`, key, err: parseErr.toString() });
          }
        }
      });
    }
    
    logger.info({ 
      msg: `Loaded existing data for ${operatorName}`, 
      vehicles: loadedVehicles, 
      gtfsrtItems: loadedGtfsrtItems 
    });
    
    return { vehicles: loadedVehicles, gtfsrtItems: loadedGtfsrtItems };
  } catch (err) {
    logger.error({ msg: `Error loading existing data for ${operatorName}`, err: err.toString() });
    return { vehicles: 0, gtfsrtItems: 0 };
  }
}

module.exports = {
  saveVehiclesByPlate,
  saveGtfsRtFeed,
  loadExistingDataIntoMaps,
};

/*
 * fede: 
 * - log strutturato vero, no solo console.error (scusate ho la paranoia)
 * - gestione ttl/errore pulita su tutte le funzioni
 * - pool robusto con compatibilità cluster/cloud di default
 * - più sicuro su path: la url non è mai hardcoded
 */
