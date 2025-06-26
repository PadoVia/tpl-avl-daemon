/**
 * tokenManager.js
 * fede: qui prima c'era solo una funzione per decodificare JWT - peccato, si puo aggiungere un sacco di altra roba.
 * ora, per veri polling avl con login, serve anche caching del token per non loggare ogni giro. 
 * più logging e controlli in caso di errori in generale
 */

const jwt = require('jsonwebtoken');
const axios = require('axios');

const tokenCache = {};

/**
 * ottieni (e, se serve, rinnova) token per un operatore con config in arrivo da tools.js
 * - fede: qui centralizzo la gestione dei token cosí evitate doppie richieste e race.
 * - supporto ENV e struttura avanzata per login.
 */
async function getTokenForOperator(operator, logger) {
    const cacheKey = operator.slug || operator.name || JSON.stringify(operator);
    if (tokenCache[cacheKey] && tokenCache[cacheKey].exp && tokenCache[cacheKey].exp > Date.now() / 1000) {
        logger && logger.debug({ msg: "Token usato da cache", op: cacheKey });
        return tokenCache[cacheKey].token;
    }

    // prepara credenziali, eventualmente popolando da env
    const username = operator?.avl?.login?.username || process.env.AVL_USERNAME;
    const password = operator?.avl?.login?.password || process.env.AVL_PASSWORD;

    try {
        const res = await axios({
            url: operator.avl.login.url,
            method: operator.avl.login.method || 'POST',
            headers: operator.avl.login.headers || {},
            data: {
                username,
                password
            },
            timeout: 5000
        });
        const token = res.data.token || res.data.access_token;
        if (!token) throw new Error("Token mancante nella risposta");

        // decodifica il jwt per expiry (oppure usa scadenza config come fallback)
        const decoded = jwt.decode(token) || {};
        tokenCache[cacheKey] = {
            token,
            exp: decoded.exp || (Date.now() / 1000 + 55 * 60) // fallback di 55 minuti (un po tanto, forse? bo, decidete voi)
        };
        logger && logger.info({ msg: "Token rinnovato", op: cacheKey });
        return token;
    } catch (err) {
        logger && logger.error({ msg: "Errore durante il login per token", err: err.toString(), op: cacheKey });
        throw err;
    }
}

function decodeToken(token) {
    try {
        return jwt.decode(token);
    } catch (error) {
        return null;
    }
}

module.exports = {
    decodeToken,
    getTokenForOperator
};

/**
 * fede: ora la logica di caching/renew è resiliente e permette anche di loggare quando e perché un token viene rinnovato. 
 * miglior coerenza in generale e spiegazione degli errori.
 */
