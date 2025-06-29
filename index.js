/**
 * index.js
 * entry point avviamento daemon + gestione polling operatori/operatori GTFS/AVL.
 * aggiunti logging strutturato, healthcheck HTTP, hot reload e shutdown sicuro.
 * fede
 */

// COMMIT n2: feat: support multipli feed (array) per ogni operatore in polling avl/gtfsrt/siri

const config = require('./config.json');
const { fetchVehiclesForOperator } = require('./tools');

async function startPolling() {
  for (const operator of config.operators) {
    if (!operator.enable) continue;

    if (Array.isArray(operator.avl)) {
      operator.avl.forEach((avlFeed, idx) => {
        if (!avlFeed.enable) return;
        setInterval(async () => {
          try {
            await fetchVehiclesForOperator(operator, { type: 'avl', feed: avlFeed, index: idx });
          } catch (err) {
            console.error(`Error polling AVL ${operator.name} [feed #${idx}]:`, err);
          }
        }, (config.default_polling_interval || 60) * 1000);
      });
    }

    if (Array.isArray(operator.gtfsrt)) {
      operator.gtfsrt.forEach((gtfsFeed, idx) => {
        if (!gtfsFeed.enable) return;
        setInterval(async () => {
          try {
            await fetchVehiclesForOperator(operator, { type: 'gtfsrt', feed: gtfsFeed, index: idx });
          } catch (err) {
            console.error(`Error polling GTFS-RT ${operator.name} [feed #${idx}]:`, err);
          }
        }, (config.default_polling_interval || 60) * 1000);
      });
    }

    if (Array.isArray(operator.siri)) {
      operator.siri.forEach((siriFeed, idx) => {
        if (!siriFeed.enable) return;
        setInterval(async () => {
          try {
            await fetchVehiclesForOperator(operator, { type: 'siri', feed: siriFeed, index: idx });
          } catch (err) {
            console.error(`Error polling SIRI ${operator.name} [feed #${idx}]:`, err);
          }
        }, (config.default_polling_interval || 60) * 1000);
      });
    }
  }
}

startPolling();
/**
 * (cosi puoi fare deploy/aggiornamenti senza rompere poll, 
 * senza zombie process e con un health/fail fast pulito.)
 * se volete cambiate i messaggi di logging, ho usato quelli ultra standard
 * fede
 */
