// COMMIT: docs: aggiunto esempio per operatori multi-feed AVL/GTFSRT/SIRI
// magari la struttura del file di prima é troppo cambiata, quindi questo é un file example per formattare correttamente op.js

const axios = require('axios');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

async function login(config) {
  const payload = {
    username: config.username,
    password: config.password,
    ...(config.extraParams || {})
  };
  const res = await axios.post(config.url, payload, {
    headers: config.headers
  });
  if (res.status !== 200 || !res.data.token) throw new Error('Login failed');
  return res.data.token;
}

async function fetchVehicles(token, vehiclesConfig) {
  const res = await axios.get(vehiclesConfig.url, {
    headers: {
      ...vehiclesConfig.headers,
      Authorization: `Bearer ${token}`
    }
  });
  return Array.isArray(res.data.data)
    ? res.data.data.map(vehicle => ({
        plate: vehicle.plate || null
      }))
    : [];
}

async function fetchVehiclesGTFSRT(token, feedUrl) {
  const response = await axios.get(feedUrl, {
    headers: { Authorization: `Basic ${token}` },
    responseType: 'arraybuffer'
  });
  if (response.status !== 200) throw new Error('GTFS-RT feed fetch error!');
  const feed = GtfsRealtimeBindings.FeedMessage.decode(response.data);
  return feed.entity.map(ent => ({
    plate: ent.vehicle?.vehicle?.label
  }));
}

async function fetchVehiclesSIRI(endpoint) {
  throw new Error('SIRI handler non implementato');
}

module.exports = {
  login,
  fetchVehicles,
  fetchVehiclesGTFSRT,
  fetchVehiclesSIRI
};
