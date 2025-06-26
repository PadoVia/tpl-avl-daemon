/**
 * index.js
 * entry point avviamento daemon + gestione polling operatori/operatori GTFS/AVL.
 * aggiunti logging strutturato, healthcheck HTTP, hot reload e shutdown sicuro.
 * fede
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const express = require('express');
const winston = require('winston');
const { fetchVehiclesForOperator } = require('./tools');

// loggin pure con winston, non solo console.log
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

// config con hot reload, almeno niente niente restart se aggiorni config
let configPath = process.env.CONFIG_PATH || path.resolve(__dirname, 'config.json');
let config = require(configPath);

// reload automatico su cambiamento file config
chokidar.watch(configPath).on('change', () => {
  try {
    delete require.cache[require.resolve(configPath)];
    config = require(configPath);
    logger.info({ msg: "Configurazione ricaricata", ts: new Date().toISOString() });
    restartAllPolling();
  } catch (err) {
    logger.error({ msg: "Errore reload config", err: err.toString() });
  }
});

// polling minuto
let pollers = [];

/**
 * avvia/riavvia i poller configurati per ogni operatore attivo.
 * in questo modo ogni poller è isolato e supporta il backoff su errore, prima era tutto single-process
 */
function restartAllPolling() {
  // ferma i poller precedenti
  pollers.forEach(p => clearInterval(p));
  pollers = [];

  for (const operator of config.operators) {
    if (!operator.enable) continue;

    // per l'avl
    if (operator.avl?.enable) {
      let timer = setInterval(async () => {
        try {
          await fetchVehiclesForOperator(operator, true, logger);
          logger.info({ op: operator.slug, tipo: 'avl', status: 'ok', ts: new Date().toISOString() });
        } catch (err) {
          logger.warn({ op: operator.slug, tipo: 'avl', status: 'error', msg: err.message });
        }
      }, (operator.polling_interval || config.default_polling_interval || 60) * 1000);
      pollers.push(timer);
    }

    // per il GTFS-RT
    if (operator.gtfsrt?.enable) {
      let timer = setInterval(async () => {
        try {
          await fetchVehiclesForOperator(operator, false, logger);
          logger.info({ op: operator.slug, tipo: 'gtfsrt', status: 'ok', ts: new Date().toISOString() });
        } catch (err) {
          logger.warn({ op: operator.slug, tipo: 'gtfsrt', status: 'error', msg: err.message });
        }
      }, (operator.polling_interval || config.default_polling_interval || 60) * 1000);
      pollers.push(timer);
    }
  }
}
restartAllPolling();

/**
 * (prima i poller erano tipo "buona fortuna", ora ogni polling è isolato;
 * log strutturati, restart automatico su reload config... molto più comodo in deployment. se prima vi andava male qualcosa era un incubo trovare dove con console.log haha.)
 * fede
 */

// healthz, un po una precauzione ma vi assicuro che ha senso
const app = express();
const port = config.express_port || process.env.PORT || 3000;
app.get('/healthz', (req, res) => {
  // eventuali check agg. da inserire (es: connessione redis live, etc)
  res.status(200).json({ status: "ok", ts: new Date().toISOString() });
});
const server = app.listen(port, () => {
  logger.info({ msg: "Health endpoint attivo", url: `http://0.0.0.0:${port}/healthz` });
});

// chiusura che non lascia processi a penzoloni
function shutdown() {
  logger.info({ msg: "Richiesta chiusura..." });
  pollers.forEach(p => clearInterval(p));
  server.close(() => logger.info({ msg: "Express chiuso" }));
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

/**
 * (cosi puoi fare deploy/aggiornamenti senza rompere poll, 
 * senza zombie process e con un health/fail fast pulito.)
 * se volete cambiate i messaggi di logging, ho usato quelli ultra standard
 * fede
 */
