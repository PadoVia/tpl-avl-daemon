// COMMIT n3: refactor: reintrodotta funzione avanzata GTFS-RT rimossa temporaneamente perché non sapevo se sarebbe crashata col multi-feed; ho testato e sembra essere tutto compatibile.

const axios = require('axios');
const { parseRomeTimestamp, calculateBearing, calculateSpeed } = require('../utils');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const vehicles = new Map();
const gtfsrtFeed = new Map();

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
 * risistema la targa rimuovendo prefissi/suffix locali ("TRAM" etc)
 */
function cleanPlate(codice) {
    let plate = codice.replace("TRAM", "P").trim();
    if (/^B0+\d+$/.test(plate)) {
        plate = plate.slice(1).replace(/^0+/, '');
    }
    return plate;
}

/**
 * esegue polling lista veicoli da endpoint avl (token già validato)
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

            const prev = vehicles.get(plate);
            const bearing = prev
                ? calculateBearing(prev.position.lat, prev.position.lon, lat, lon)
                : null;

            const vehicleData = {
                plate,
                timestamp,
                speed,
                door: speed >= 1 ? 0 : vehicle.porta,
                bearing,
                position: { lat, lon }
            };

            if (!prev || new Date(timestamp) > new Date(prev.timestamp)) {
                vehicles.set(plate, vehicleData);
                updatedVehicles.push(vehicleData);
            }
        });
    }
    return updatedVehicles;
}

/**
 * ADVANCED: polling e parsing GTFS-RT, mappa veicoli in base a posizione, speed, timestamp, bearing.
 * config: { url, headers, ... } chiamato come config dal feed multi-feed
 */
async function fetchVehiclesGTFSRT(token, config) {
    const url = config.feed_url || config.url;
    const res = await axios.get(url, {
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
        return [];
    }

    // parsing feed real time protobuf, ottimizzato per multi-feed!
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(res.data));
    const updatedVehicles = [];
    const updatedGtfsrtFeed = [];

    feed.entity.forEach(entity => {
        if (!entity.vehicle || !entity.vehicle.vehicle) return;

        const vehicle = entity.vehicle.vehicle;
        const lat = entity.vehicle.position.latitude;
        const lon = entity.vehicle.position.longitude;
        const timestamp = new Date(entity.vehicle.timestamp * 1000).toISOString();
        const plate = cleanPlate(vehicle.label || '');

        const currentGtfsrtFeed = { ...entity.vehicle.trip, plate };
        const previousGtfsrtFeed = gtfsrtFeed.get(plate);

        if (!previousGtfsrtFeed || JSON.stringify(currentGtfsrtFeed) !== JSON.stringify(previousGtfsrtFeed)) {
            gtfsrtFeed.set(plate, currentGtfsrtFeed);
            updatedGtfsrtFeed.push(currentGtfsrtFeed);
        }

        const prev = vehicles.get(plate);

        const speed = prev
            ? calculateSpeed(prev.position.lat, prev.position.lon, lat, lon, prev.timestamp, timestamp)
            : null;
        const bearing = prev
            ? calculateBearing(prev.position.lat, prev.position.lon, lat, lon)
            : null;

        // aggiornamento solo se timestamp più recente
        if (!prev || new Date(timestamp) > new Date(prev.timestamp)) {
            const vehicleData = {
                plate,
                timestamp,
                speed,
                door: prev?.door || 0,
                bearing,
                position: { lat, lon }
            };

            vehicles.set(plate, vehicleData);
            updatedVehicles.push(vehicleData);
        }
    });

    return {vehicles: updatedVehicles, gtfsrtFeed: updatedGtfsrtFeed};
}

/**
 * handler SIRI stub (non implementato per questo operatore)
 */
async function fetchVehiclesSIRI(endpoint) {
    throw new Error('SIRI handler non implementato per questo operatore.');
}

module.exports = {
    login,
    fetchVehicles,
    fetchVehiclesGTFSRT,
    fetchVehiclesSIRI
};
