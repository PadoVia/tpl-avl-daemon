// COMMIT: refactor n3: ripristino di tutte le funzioni di logging avanzato, hot reload, express e polling multi-feed che avevo rimosso per far vedere la logica in modo chiaro
// fede

const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const express = require('express');
const winston = require('winston');
const { fetchVehiclesForOperator } = require('./tools');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

// config con hot reload
let configPath = process.env.CONFIG_PATH || path.resolve(__dirname, 'config.json');
let config = require(configPath);

let pollers = []; // salva setInterval attivi

function stopAllPolling() {
  if (pollers.length > 0) {
    pollers.forEach(clr => clearInterval(clr));
    pollers = [];
  }
}

// restart polling (usato anche on config reload)
function restartAllPolling() {
  stopAllPolling();
  startPolling();
  logger.info({ msg: "Restarted polling after config reload", ts: new Date().toISOString() });
}

function singlePoller(operator, feedType, feed, feedIdx) {
  const pollInterval = (config.defaultPollingInterval || 60) * 1000;
  return setInterval(async () => {
    try {
      await fetchVehiclesForOperator(operator, { type: feedType, feed, index: feedIdx });
    } catch (err) {
      logger.error({
        msg: `Error polling ${feedType} feed #${feedIdx} for ${operator.name}`,
        err: err.stack || err.toString()
      });
    }
  }, pollInterval);
}

// polling su tutti i feed, multi-feed e multi-tipo!
function startPolling() {
  for (const operator of config.operators) {
    if (!operator.enable) continue;

    // cicla feed AVL
    if (Array.isArray(operator.avl)) {
      operator.avl.forEach((feed, idx) => {
        if (feed.enable) {
          pollers.push(singlePoller(operator, 'avl', feed, idx));
        }
      });
    }
    // cicla feed GTFSRT
    if (Array.isArray(operator.gtfsrt)) {
      operator.gtfsrt.forEach((feed, idx) => {
        if (feed.enable) {
          pollers.push(singlePoller(operator, 'gtfsrt', feed, idx));
        }
      });
    }
    // cicla feed SIRI
    if (Array.isArray(operator.siri)) {
      operator.siri.forEach((feed, idx) => {
        if (feed.enable) {
          pollers.push(singlePoller(operator, 'siri', feed, idx));
        }
      });
    }
  }
}

// hot reload config
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

startPolling();
