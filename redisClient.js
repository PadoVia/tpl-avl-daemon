const { createClient } = require('redis');
const config = require('./config.json');

const redis = createClient({
  url: config.redis_url
});

redis.on('error', (err) => console.error('Redis Client Error', err));

(async () => {
  try {
    await redis.connect();
    console.log('Redis connected');
  } catch (err) {
    console.error('Redis connection failed:', err);
  }
})();

// Salva con chiave semplice
async function saveToRedis(key, value, ttlSeconds = null) {
  const stringValue = JSON.stringify(value);

  if (ttlSeconds) {
    await redis.set(key, stringValue, {
      EX: ttlSeconds
    });
  } else {
    await redis.set(key, stringValue);
  }
}

// Recupera
async function getFromRedis(key) {
  const raw = await redis.get(key);
  return raw ? JSON.parse(raw) : null;
}

// Cancella
async function deleteFromRedis(key) {
  await redis.del(key);
}

// Salva i dati di un operatore con chiave strutturata
// operator:<operatorName>:<dataType>
async function saveOperatorData(operatorName, dataType, data, ttlSeconds) {
  const key = `operator:${operatorName}:${dataType}`;
  await saveToRedis(key, data, ttlSeconds);
}

// Salva i veicoli per targa con chiave strutturata
// operator:<operatorName>:vehicles:status:<plate>
// Utilizza un pipeline per ottimizzare le operazioni
async function saveVehiclesByPlate(vehicles, operatorName, ttlSeconds) {
  const pipeline = redis.multi();

  for (const [_, vehicle] of Object.entries(vehicles)) {
    const key = `operator:${operatorName}:vehicles:status:${vehicle.plate}`;
    const value = JSON.stringify(vehicle);

    if (ttlSeconds) {
      pipeline.set(key, value, { EX: ttlSeconds });
    } else {
      pipeline.set(key, value);
    }
  }

  await pipeline.exec();
}


module.exports = {
  saveToRedis,
  getFromRedis,
  deleteFromRedis,
  saveOperatorData,
  saveVehiclesByPlate
};
