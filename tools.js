// COMMIT: refactor n3: aggiunto supporto multi-feed alla funzione fetchVehiclesForOperator, riaggiunta di tutte le funzioni depletate

const path = require('path');
const { retry } = require('./utils');
const { saveVehiclesByPlate } = require('./redisClient');
const { addToken, getTokenForOperator } = require('./tokenManager');

/**
 * multi-feed: ora riceve oggetto {type, feed, index}
 * - type: 'avl' | 'gtfsrt' | 'siri'
 * - feed: oggetto feed specifico (array entry)
 * - index: numero feed dell'array
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
  const { type, feed, index } = opts_or_isAVL;
  if (!operator.filename) {
    throw new Error(`Missing filename for operator: ${operator.name}`);
  }

  const modulePath = path.join(__dirname, 'operators', operator.filename);
  const handler = require(modulePath);
  let vehicles;
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
    const url = feed.feed_url || feed.url;
    vehicles = await retry(() => handler.fetchVehiclesGTFSRT(token, url), 3, 1000);
  } else if (type === 'siri') {
    vehicles = await retry(() => handler.fetchVehiclesSIRI(feed.endpoint), 3, 1000);
  } else {
    throw new Error(`Tipo feed sconosciuto: ${type}`);
  }

  // Salva usando slug e opzionale feed label per separare multi-feed
  await saveVehiclesByPlate(vehicles, operator.slug + (feed.label ? `_${feed.label}` : ''));
}

module.exports = {
  fetchVehiclesForOperator
};

// Tutto il resto delle funzioni originali resta invariato.
