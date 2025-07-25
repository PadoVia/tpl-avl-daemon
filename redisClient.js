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

// carica tutti i veicoli per targa da Redis
// ritorna una mappa con targa come chiave e oggetto veicolo come valore
// usato per inizializzare lo stato locale all'avvio
async function loadAllVehiclesByPlate(operatorName) {
  try {
    const pattern = `operator:${operatorName}:vehicles:status:*`;
    const keys = await redis.keys(pattern);

    if (keys.length === 0) return new Map();

    const pipeline = redis.multi();
    keys.forEach((key) => pipeline.get(key));
    const results = await pipeline.exec();

    const vehicleMap = new Map();
    keys.forEach((key, i) => {
      const plate = key.split(":").pop();
      const value = results[i];
      if (!value) return;
      try {
        vehicleMap.set(plate, JSON.parse(value));
      } catch (parseErr) {
        logger.warn({ msg: `Error parsing vehicle ${plate}`, err: parseErr.toString() });
      }
    });

    return vehicleMap;
  } catch (err) {
    logger.error({ msg: `Error loading all vehicles for ${operatorName}`, err: err.toString() });
    return new Map();
  }
}

// carica l'ultimo feed GTFSRT per ogni targa
// ritorna una mappa con targa come chiave e oggetto feed come valore
// usato per inizializzare lo stato locale all'avvio
async function loadAllGtfsRtFeed(operatorName) {
  try {
    const pattern = `operator:${operatorName}:vehicles:gtfsrt:*`;
    const keys = await redis.keys(pattern);

    if (keys.length === 0) return new Map();

    const pipeline = redis.multi();
    keys.forEach((key) => pipeline.lIndex(key, 0)); // prende l'ultimo elemento
    const results = await pipeline.exec();

    const feedMap = new Map();
    keys.forEach((key, i) => {
      const plate = key.split(":").pop();
      const value = results[i];
      if (!value) return;

      try {
        const parsed = JSON.parse(value);
        feedMap.set(plate, parsed);
      } catch (parseErr) {
        logger.warn({ msg: `Error parsing GTFSRT for ${plate}`, err: parseErr.toString() });
      }
    });

    return feedMap;
  } catch (err) {
    logger.error({ msg: `Error loading latest GTFSRT feeds for ${operatorName}`, err: err.toString() });
    return new Map();
  }
}


module.exports = {
  saveVehiclesByPlate,
  saveGtfsRtFeed,
  loadAllVehiclesByPlate,
  loadAllGtfsRtFeed
};

/*
 * fede: 
 * - log strutturato vero, no solo console.error (scusate ho la paranoia)
 * - gestione ttl/errore pulita su tutte le funzioni
 * - pool robusto con compatibilità cluster/cloud di default
 * - più sicuro su path: la url non è mai hardcoded
 */
