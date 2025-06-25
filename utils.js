const { DateTime } = require('luxon');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retry(fn, maxRetries = 3, delayMs = 1000) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(`Attempt ${attempt} failed:`, err.message);
      if (attempt < maxRetries) await delay(delayMs);
    }
  }
  throw lastErr;
}

function parseRomeTimestamp(str) {
  return DateTime.fromFormat(str, 'yyyy-MM-dd HH:mm:ss', { zone: 'Europe/Rome' })
    .toUTC()
    .toISO();
}

function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

function toDegrees(radians) {
  return radians * (180 / Math.PI);
}

function calculateBearing(lat1, lon1, lat2, lon2) {
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δλ = toRadians(lon2 - lon1);

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) -
            Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  let θ = Math.atan2(y, x);
  θ = toDegrees(θ);
  return (θ + 360) % 360; // normalizza tra 0 e 360 gradi
}

function calculateSpeed(lat1, lon1, lat2, lon2, time1, time2) {
    const R = 6371e3; // raggio della Terra in metri
    const φ1 = toRadians(lat1);
    const φ2 = toRadians(lat2);
    const Δφ = toRadians(lat2 - lat1);
    const Δλ = toRadians(lon2 - lon1);
    
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    const distance = R * c; // distanza in metri
    
    const timeDiff = (new Date(time2) - new Date(time1)) / 1000; // differenza in secondi
    return timeDiff > 0 ? (distance / timeDiff) * 3.6 : null; // velocità in km/h
}


module.exports = {
  delay,
  retry,
  parseRomeTimestamp,
  calculateBearing,
  calculateSpeed
};
