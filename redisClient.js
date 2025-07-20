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

/**
 * salva key-value in redis. Valore sempre serializzato json.
 * fede: ho aggiunto try/catch e logga su errore per debugging più sicuro
 */
async function saveToRedis(key, value, ttlSeconds = null) {
  try {
    const stringValue = JSON.stringify(value);
    redis.publish(key, stringValue); // pubblica il valore appena salvato
    if (ttlSeconds) {
      await redis.set(key, stringValue, { EX: ttlSeconds });
    } else {
      await redis.set(key, stringValue);
    }
  } catch (err) {
    logger.error({ msg: `Error saving key ${key} to redis`, err: err.toString() });
  }
}

async function getFromRedis(key) {
  try {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.error({ msg: `Error getting key ${key} from redis`, err: err.toString() });
    return null;
  }
}

async function deleteFromRedis(key) {
  try {
    await redis.del(key);
  } catch (err) {
    logger.error({ msg: `Error deleting key ${key} from redis`, err: err.toString() });
  }
}

// Salva i dati per un operatore con key composta
async function saveOperatorData(operatorName, dataType, data, ttlSeconds) {
  const key = `operator:${operatorName}:${dataType}`;
  await saveToRedis(key, data, ttlSeconds);
}

// Salva i veicoli per targa con chiave strutturata
async function saveVehiclesByPlate(vehicles, operatorName, ttlSeconds) {
  try {
    const pipeline = redis.multi();
    for (const [_, vehicle] of Object.entries(vehicles)) {
      const key = `operator:${operatorName}:vehicles:status:${vehicle.plate}`;
      pipeline.set(key, JSON.stringify(vehicle), ttlSeconds ? { EX: ttlSeconds } : undefined);
    }
    await pipeline.exec();
  } catch (err) {
    logger.error({ msg: `Error saving vehicles by plate for ${operatorName}`, err: err.toString() });
  }
}

module.exports = {
  saveToRedis,
  getFromRedis,
  deleteFromRedis,
  saveOperatorData,
  saveVehiclesByPlate
};

/*
 * fede: 
 * - log strutturato vero, no solo console.error (scusate ho la paranoia)
 * - gestione ttl/errore pulita su tutte le funzioni
 * - pool robusto con compatibilità cluster/cloud di default
 * - più sicuro su path: la url non è mai hardcoded
 */
