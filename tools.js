/**
 * tools.js
 * gestione compatibile plugin del core polling:
 * - se 'filename' dichiarato e file esiste in /operators, delega tutto lì (login, fetch, parsing)
 * - altrimenti logica avl/gtfsrt standard più plugin custom_transform opzionale
 * fede: ora design pienamente modulare e scalabile, ogni operatore può evolvere/aggiornare logic senza "sporcare" il core
 */

const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { getTokenForOperator } = require('./tokenManager');
const { saveOperatorData, saveVehiclesByPlate } = require('./redisClient');
const { loadCustomTransform } = require('./utils');

async function fetchVehiclesForOperator(operator, isAvl = true, logger = console) {
    if (!operator) throw new Error('Operator config mancante');
    
    // plugin dedicato in ops
    if (operator.filename) {
        const pluginPath = path.join(__dirname, 'operators', operator.filename);
        if (fs.existsSync(pluginPath)) {
            try {
                const operatorPlugin = require(pluginPath);
                if (typeof operatorPlugin === 'function') {
                    const data = await operatorPlugin(operator, logger);
                    logger.info({ op: operator.slug, tipo: 'custom_plugin', plugin: operator.filename, count: data.length });
                    // NB: salva sempre i dati normalizzati dal plugin
                    await saveOperatorData(operator.slug, 'vehicles', data, 180);
                    await saveVehiclesByPlate(data, operator.slug, 180);
                    return data;
                }
            } catch (err) {
                logger.error({ op: operator.slug, msg: 'Errore esecuzione plugin operator', plugin: operator.filename, err: err.toString() });
            }
        } else {
            logger.warn({ op: operator.slug, msg: 'plugin declared but file not found', plugin: operator.filename });
        }
    }

    // logica generica per gli ops non mentioned, se dovete aggiungerli
    let data = [];
    try {
        // avl generico
        if (isAvl && operator.avl?.enable) {
            const token = await getTokenForOperator(operator, logger);
            const url = operator.avl.vehicles.url;
            const headers = { ...(operator.avl.vehicles.headers || {}), Authorization: `Bearer ${token}` };

            const res = await axios.get(url, { headers, timeout: 10000 });
            data = res.data.vehicles || res.data || [];
            logger.debug({ op: operator.slug, tipo: 'avl_std', esito: 'ok', count: data.length });
        }
        // gtfsrt generico (stub da arricchire a piacere)
        if (!isAvl && operator.gtfsrt?.enable) {
            logger.debug({ op: operator.slug, tipo: 'gtfsrt_std', esito: 'stub' });
        }

        // plugin custom_transform legacy (opzionale. a mio avviso sarebbe ottimo)
        if (operator.custom_transform) {
            try {
                const plugin = loadCustomTransform(operator.custom_transform, logger);
                if (typeof plugin === 'function') data = plugin(data, operator, logger);
            } catch (e) {
                logger.warn({ op: operator.slug, msg: 'Plugin custom_transform non caricato', err: e.toString() });
            }
        }

        await saveOperatorData(operator.slug, isAvl ? 'vehicles_avl' : 'vehicles_gtfsrt', data, 180);
        if (isAvl) await saveVehiclesByPlate(data, operator.slug, 180);

        return data;
    } catch (err) {
        logger.error({ op: operator.slug, msg: 'Polling failed (std logic)', err: err.toString() });
        throw err;
    }
}

module.exports = {
    fetchVehiclesForOperator
};
/*
 * ora il core polling si adatta a qualsiasi logica evolutiva degli operatori!
 * funziona anche con i vecchi config standard, e si integra seamless con custom in operators/.
 * fede
 */
