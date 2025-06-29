// COMMIT n2: feat: refactoring fetchVehiclesForOperator per supportare array di feed su ogni tipo (avl, gtfsrt, siri)

const path = require('path');
const { retry } = require('./utils');
const { saveVehiclesByPlate } = require('./redisClient');
const { addToken, getToken } = require('./tokenManager');

/**
 * Poll operatore/FEED singolo (avl, gtfsrt, siri)
 * @param {object} operator - contesto operatore
 * @param {object} opts - { type: "avl"|"gtfsrt"|"siri", feed: feedObj, index: int }
 */
async function fetchVehiclesForOperator(operator, opts) {
  if (!operator.filename) {
    throw new Error(`Missing filename for operator: ${operator.name}`);
  }

  const { type, feed, index } = opts;
  const modulePath = path.join(__dirname, 'operators', operator.filename);
  const handler = require(modulePath);
  let vehicles;
  const tokenKey = `${operator.slug}_${type}_${index}`;

  if (type === 'avl') {
    // Handle token per feed AVL specifico
    let token = getToken(tokenKey);

    if (!token) {
      console.log(`No AVL token found for operator ${operator.name} [feed #${index}], logging in...`);
      token = await retry(() => handler.login(feed.login), 3, 1000);
      addToken(tokenKey, token);
    }
    vehicles = await retry(() => handler.fetchVehicles(token, feed.vehicles), 3, 1000);
  }
  else if (type === 'gtfsrt') {
    // Feed_Gtfsrt: autenticazione base64 per feed specifico
    const gtfsToken = Buffer.from(`${feed.username}:${feed.password}`).toString('base64');
    vehicles = await retry(() => handler.fetchVehiclesGTFSRT(gtfsToken, feed.feed_url), 3, 1000);
  }
  else if (type === 'siri') {
    // Feed_SIRI, aggiungere eventuale auth qui se necessaria
    vehicles = await retry(() => handler.fetchVehiclesSIRI(feed.endpoint), 3, 1000);
  }
  else {
    throw new Error(`Unknown feed type: ${type}`);
  }

  await saveVehiclesByPlate(vehicles, operator.slug);
}

module.exports = {
  fetchVehiclesForOperator
};

// La firma di fetchVehiclesForOperator è aggiornata, il polling ora accetta feed oggetto specifico
