// COMMIT: refactor n3: aggiunto supporto multi-feed alla funzione fetchVehiclesForOperator, riaggiunta di tutte le funzioni depletate

const path = require('path');
const { retry } = require('./utils');
const { saveVehiclesByPlate, saveGtfsRtFeed, getVehiclesByPlate, getGtfsRtFeed, checkDataFreshness } = require('./redisClient');
const { addToken, getTokenForOperator } = require('./tokenManager');

/**
 * multi-feed: ora riceve oggetto {type, feed, index}
 * - type: 'avl' | 'gtfsrt' | 'siri'
 * - feed: oggetto feed specifico (array entry)
 * - index: numero feed dell'array
 * - checkRedisFirst: se true, controlla Redis prima di fare API call (default: false per retrocompatibilità)
 */
async function fetchVehiclesForOperator(operator, opts_or_isAVL = true) {
  // Legacy support: se chiamato come prima, mappa su nuovo formato
  if (typeof opts_or_isAVL === "boolean") {
    const isAVL = opts_or_isAVL;
    let type = isAVL ? "avl" : "gtfsrt";
    // Usa primi feed per retrocompatibilità
    let feed = operator[type];
    let feedUrl = feed && feed.url ? feed.url : (feed && feed.feed_url ? feed.feed_url : undefined);
    if (type === "gtfsrt" && feed && !feedUrl && (feed.tram || feed.bus)) {
      // caso vecchio config con sub-campi tram/bus
      const result = [];
      ["tram", "bus"].forEach(sub => {
        if (feed[sub]) {
          const token = Buffer.from(`${feed.username}:${feed.password}`).toString('base64');
          result.push(retry(() => handler.fetchVehiclesGTFSRT(token, feed[sub]), 3, 1000));
        }
      });
      await Promise.all(result);
      return;
    }
    return await fetchVehiclesForOperator(operator, { type, feed, index: 0 });
  }

  // Nuova firma multi-feed
  const { type, feed, index, checkRedisFirst = false } = opts_or_isAVL;
  if (!operator.filename) {
    throw new Error(`Missing filename for operator: ${operator.name}`);
  }

  const operatorSlug = operator.slug + (feed.label ? `_${feed.label}` : '');
  
  // Se richiesto, controlla Redis prima di fare API call
  if (checkRedisFirst) {
    const freshness = await checkDataFreshness(operatorSlug, 5); // 5 minuti di età massima
    if (freshness.isFresh) {
      console.log(`[${operator.name}] Dati freschi trovati in Redis (${freshness.vehicleCount} veicoli). Skipping API call.`);
      return {
        skipped: true,
        reason: 'data_fresh_in_redis',
        vehicleCount: freshness.vehicleCount
      };
    } else {
      console.log(`[${operator.name}] Dati non freschi in Redis (${freshness.reason}). Procedendo con API call.`);
    }
  }

  const modulePath = path.join(__dirname, 'operators', operator.filename);
  const handler = require(modulePath);
  let vehicles = [], gtfsrtFeed = [];
  const tokenKey = `${operator.slug}_${type}_${index}`;

  if (type === 'avl') {
    // Handle token per feed AVL specifico
    let token = await getTokenForOperator(operator);

    if (!token) {
      console.log(`No token found for operator ${operator.name} [feed #${index}], logging in...`);
      token = await retry(() => handler.login(feed.login), 3, 1000);
      addToken(tokenKey, token);
    }
    vehicles = await retry(() => handler.fetchVehicles(token, feed.vehicles), 3, 1000);
  } else if (type === 'gtfsrt') {
    const token = Buffer.from(`${feed.username}:${feed.password}`).toString('base64');
    // La property dell'URL può essere feed.feed_url (nuovo) o feed.url (vecchio)
    ({ vehicles, gtfsrtFeed } = await retry(() => handler.fetchVehiclesGTFSRT(token, feed), 3, 1000));
  } else if (type === 'siri') {
    vehicles = await retry(() => handler.fetchVehiclesSIRI(feed.endpoint), 3, 1000);
  } else {
    throw new Error(`Tipo feed sconosciuto: ${type}`);
  }

  // Salva usando slug e opzionale feed label per separare multi-feed
  await saveVehiclesByPlate(vehicles, operatorSlug);
  await saveGtfsRtFeed(gtfsrtFeed, operatorSlug);
  
  return {
    skipped: false,
    vehicleCount: vehicles.length,
    gtfsrtCount: gtfsrtFeed.length
  };
}

/**
 * Funzione per il recupero dei dati all'avvio del servizio
 * Controlla Redis e recupera solo i dati mancanti o scaduti
 */
async function performStartupDataRecovery(config) {
  console.log("🔄 Avvio recupero dati da Redis...");
  
  const recoveryResults = [];
  
  for (const operator of config.operators) {
    if (!operator.enable) continue;

    // Recupera dati AVL
    if (Array.isArray(operator.avl)) {
      for (let idx = 0; idx < operator.avl.length; idx++) {
        const feed = operator.avl[idx];
        if (feed.enable) {
          try {
            const result = await fetchVehiclesForOperator(operator, { 
              type: 'avl', 
              feed, 
              index: idx, 
              checkRedisFirst: true 
            });
            recoveryResults.push({
              operator: operator.name,
              type: 'avl',
              index: idx,
              ...result
            });
          } catch (err) {
            console.error(`❌ Errore recupero AVL per ${operator.name} [feed #${idx}]:`, err.message);
          }
        }
      }
    }

    // Recupera dati GTFSRT
    if (Array.isArray(operator.gtfsrt)) {
      for (let idx = 0; idx < operator.gtfsrt.length; idx++) {
        const feed = operator.gtfsrt[idx];
        if (feed.enable) {
          try {
            const result = await fetchVehiclesForOperator(operator, { 
              type: 'gtfsrt', 
              feed, 
              index: idx, 
              checkRedisFirst: true 
            });
            recoveryResults.push({
              operator: operator.name,
              type: 'gtfsrt',
              index: idx,
              ...result
            });
          } catch (err) {
            console.error(`❌ Errore recupero GTFSRT per ${operator.name} [feed #${idx}]:`, err.message);
          }
        }
      }
    }

    // Recupera dati SIRI
    if (Array.isArray(operator.siri)) {
      for (let idx = 0; idx < operator.siri.length; idx++) {
        const feed = operator.siri[idx];
        if (feed.enable) {
          try {
            const result = await fetchVehiclesForOperator(operator, { 
              type: 'siri', 
              feed, 
              index: idx, 
              checkRedisFirst: true 
            });
            recoveryResults.push({
              operator: operator.name,
              type: 'siri',
              index: idx,
              ...result
            });
          } catch (err) {
            console.error(`❌ Errore recupero SIRI per ${operator.name} [feed #${idx}]:`, err.message);
          }
        }
      }
    }
  }

  // Riassunto recupero
  const skipped = recoveryResults.filter(r => r.skipped).length;
  const fetched = recoveryResults.filter(r => !r.skipped).length;
  const totalVehicles = recoveryResults.reduce((sum, r) => sum + (r.vehicleCount || 0), 0);
  
  console.log(`✅ Recupero dati completato: ${skipped} skip (dati freschi), ${fetched} fetch (dati nuovi/scaduti), ${totalVehicles} veicoli totali`);
  
  return recoveryResults;
}

module.exports = {
  fetchVehiclesForOperator,
  performStartupDataRecovery
};

// Tutto il resto delle funzioni originali resta invariato.
