const axios = require('axios');
const { parseRomeTimestamp, calculateBearing, calculateSpeed } = require('../utils');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

const vehicles = new Map();

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

function cleanPlate(codice) {
  // Rimuove "TRAM" e spazi
  let plate = codice.replace("TRAM", "P").trim();

  // Se inizia con "B" e poi solo zeri + numeri → rimuovi zeri
  if (/^B0+\d+$/.test(plate)) {
    plate = plate.slice(1).replace(/^0+/, '');
  }

  return plate;
}

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
      const bearing = prev
        ? calculateBearing(prev.position.lat, prev.position.lon, lat, lon)
        : null;

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

async function fetchVehiclesGTFSRT(token, config) {
    const res = await axios.get(config.url, {
        responseType: 'arraybuffer',
        headers: {
            ...config.headers,
            Authorization: `Basic ${token}`
        },
        validateStatus: () => true 
    });

    if (res.status !== 200) {
        throw new Error('Failed to fetch GTFS-RT data');
    }

    if (!res.data || !res.data.length) {
        console.error("Risposta vuota o non valida:", res.data);
        return;
    }

    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(res.data));

    const updatedVehicles = [];

    feed.entity.forEach(entity => {
        if (!entity.vehicle || !entity.vehicle.vehicle) return;

        const vehicle = entity.vehicle.vehicle;
        const id = vehicle.id;
        const lat = entity.vehicle.position.latitude;
        const lon = entity.vehicle.position.longitude;
        const timestamp = new Date(entity.vehicle.timestamp * 1000).toISOString();
        const plate = cleanPlate(vehicle.label || '');

        const prev = vehicles.get(id);

        const speed = prev
        ? calculateSpeed(prev.position.lat, prev.position.lon, lat, lon, prev.timestamp, timestamp)
        : null;
        const bearing = prev
        ? calculateBearing(prev.position.lat, prev.position.lon, lat, lon)
        : null;

        // Confronta i timestamp per vedere se è più recente
        if (!prev || new Date(timestamp) > new Date(prev.timestamp)) {
            const vehicleData = {
                plate,
                timestamp,
                speed,
                door: prev?.door || 0,
                bearing,
                position: { lat, lon }
            };

            vehicles.set(id, vehicleData);
            updatedVehicles.push(vehicleData);
        }
    });

    return updatedVehicles;
}

module.exports = {
  login,
  fetchVehicles,
  fetchVehiclesGTFSRT
};
