/**
 * utils.js
 * Utility robuste e modulari per polling/transit: delay, retry, parse datetimes, bearing/speed calc.
 * fede: ho lasciato la tua struttura base intatta ma ho aggiunto:
 * - logging delegabile, più opzioni per la gestione degli errori in retry
 * - spazio per plugin di trasformazione per renderlo più espandibile
 * - commenti chiari e pragmatismo production.
 */

const { DateTime } = require('luxon');

// sleep async per X ms
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * retry wrapper per promesse, con logging opzionale e backoff.
 * fede: ora puoi passare un logger custom per catch centralizzato, e la funzione
 * ora lancia sempre l'ultimo errore per evitare silent fail.
 */
async function retry(fn, maxRetries = 3, delayMs = 1000, logger = null) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (logger) logger.warn({ msg: `Attempt ${attempt} failed`, err: err.message });
      else console.warn(`Attempt ${attempt} failed:`, err.message);
      if (attempt < maxRetries) await delay(delayMs);
    }
  }
  throw lastErr;
}

// converte timestamp Roma (locale) in ISO UTC (vedo che era particolarmente richiesto)
function parseRomeTimestamp(str) {
  return DateTime.fromFormat(str, 'yyyy-MM-dd HH:mm:ss', { zone: 'Europe/Rome' })
    .toUTC()
    .toISO();
}
// angoli gradi/radianti
function toRadians(degrees) { return degrees * (Math.PI / 180); }
function toDegrees(radians) { return radians * (180 / Math.PI); }

// bearing tra due lat/lon in gradi. questa parte mi sta a cuore, sto usando praticamente le stesse funzioni per 6615.io
function calculateBearing(lat1, lon1, lat2, lon2) {
  const φ1 = toRadians(lat1), φ2 = toRadians(lat2), Δλ = toRadians(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  let θ = Math.atan2(y, x);
  θ = toDegrees(θ);
  return (θ + 360) % 360;
}

// calcola velocità media tra due pos/time point (in km/h) - ok, non é male.. ma di solito l'rt include la speed. usate quella, direi, per poi 
// fare una funzione che trasporti il marker da una parte all'altra in base al path, ovviamente. é semplicissima, se volete ve la do.
function calculateSpeed(lat1, lon1, lat2, lon2, time1, time2) {
  const R = 6371e3;
  const φ1 = toRadians(lat1), φ2 = toRadians(lat2);
  const Δφ = toRadians(lat2 - lat1), Δλ = toRadians(lon2 - lon1);
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  const timeDiff = (new Date(time2) - new Date(time1)) / 1000;
  return timeDiff > 0 ? (distance / timeDiff) * 3.6 : null;
}

/**
 * loader per plugin custom (custom_transform) se mai richiesto.
 * fede: cosi puo' caricare funzioni custom stile plugin in maniera affidabile e senza crash
 */
function loadCustomTransform(pluginPath, logger = null) {
  if (!pluginPath) return x => x;
  try {
    const plugin = require(pluginPath);
    if (logger) logger.info({ msg: "Plugin custom_transform caricato", path: pluginPath });
    return typeof plugin === 'function' ? plugin : (plugin && plugin.default ? plugin.default : x => x);
  } catch (err) {
    if (logger) logger.warn({ msg: "Plugin custom_transform fallito", err: err.toString() });
    return x => x;
  }
}

module.exports = {
  delay,
  retry,
  parseRomeTimestamp,
  calculateBearing,
  calculateSpeed,
  loadCustomTransform
};

/*
 * fede:
 * - ho lasciato tutte le utility matematiche tue (complimenti, tra l'altro. Mi sembrano impeccabili) e aggiunto 
 *   - retry robusto con logger, loader plugin avanzato e commenti orientati ad operatori
 */
