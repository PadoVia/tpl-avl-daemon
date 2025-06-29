// COMMIT n2: refactor: support multi-feed; mantiene handler GTFSRT/SIRI per coerenza

const axios = require('axios');
const { parseRomeTimestamp, calculateBearing, calculateSpeed } = require('../utils');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const vehicles = new Map();

/**
 * effettua login e ritorna token (per feed AVL)
 */
async function login(config) {
  const payload = {
    username: config.username,
    password: config.password
  };

  const res = await axios.post(config.url, payload, {
    headers: config.headers
  });

  if (res.status !== 200 || !res.data.token) {
    throw new Error('Login failed');
  }

  return res.data.token;
}

/**
 * risistema la targa rimuovendo prefissi/suffix locali
 */
function cleanPlate(codice) {
  let plate = codice.replace("TRAM", "P").trim();
  if (/^B0+\d+$/.test(plate)) {
    plate = plate.slice(1).replace(/^0+/, '');
  }
  return plate;
}

/**
 * poll lista veicoli AVL per feed singolo
 */
async function fetchVehicles(token, config) {
  const res = await axios.get(config.url, {
    headers: {
      ...config.headers,
      Authorization: `Bearer ${token}`
    }
  });

  const updatedVehicles = [];

  if (res.status === 200 && Array.isArray(res.data.data)) {
    res.data.data.forEach(vehicle => {
      const { id, last_lat: lat, last_lon: lon, last_dt_quando: dt } = vehicle;
      if (!id || !lat || !lon) return;

      const timestamp = parseRomeTimestamp(dt || '');
      const plate = cleanPlate(vehicle.codice || '');
      const speed = vehicle.last_velocita
        ? parseFloat((vehicle.last_velocita / 10000 * 3.6).toFixed(2))
        : null;
      const prev = vehicles.get(id);
      const bearing = prev ? calculateBearing(prev.position.lat, prev.position.lon, lat, lon) : null;

      const isUpdated = prev &&
        prev.plate === plate &&
        (prev.position.lat !== lat ||
         prev.position.lon !== lon ||
         prev.timestamp !== timestamp);

      const vehicleData = {
        plate,
        timestamp,
        speed,
        door: speed >= 1 ? 0 : vehicle.porta,
        bearing,
        position: { lat, lon }
      };

      vehicles.set(id, vehicleData);

      if (isUpdated) {
        updatedVehicles.push(vehicleData);
      }
    });
  }
  return updatedVehicles;
}

/**
 * handler feed GTFS-RT (stub): puoi personalizzarlo se serve per operatore
 */
async function fetchVehiclesGTFSRT(token, feed_url) {
  const response = await axios.get(feed_url, {
    headers: {
      Authorization: `Basic ${token}`
    },
    responseType: 'arraybuffer'
  });
  if (response.status !== 200) throw new Error('GTFS-RT feed fetch error!');
  const feed = GtfsRealtimeBindings.FeedMessage.decode(response.data);

  return feed.entity.map((entity) => {
    const v = entity.vehicle;
    return {
      plate: v.vehicle ? v.vehicle.label : null,
      timestamp: v.timestamp ? v.timestamp.low : null,
      speed: v.position ? v.position.speed : null,
      position: {
        lat: v.position ? v.position.latitude : null,
        lon: v.position ? v.position.longitude : null
      },
      bearing: v.position ? v.position.bearing : null
    };
  });
}

async function fetchVehiclesSIRI(endpoint) {
  throw new Error('SIRI handler non implementato per questo operatore.');
}

module.exports = {
  login,
  fetchVehicles,
  fetchVehiclesGTFSRT,
  fetchVehiclesSIRI
};
