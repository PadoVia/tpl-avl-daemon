const jwt = require('jsonwebtoken');

const tokens = new Map();

function addToken(slug, jwtToken) {
  if (!slug || !jwtToken) throw new Error("Slug and token are required");

  const decoded = jwt.decode(jwtToken);

  if (!decoded || !decoded.exp) {
    throw new Error("Token is not a valid JWT or missing 'exp'");
  }

  const expiresAt = decoded.exp * 1000; // `exp` è in secondi
  tokens.set(slug, { token: jwtToken, expiresAt });
}

function getToken(slug) {
  const entry = tokens.get(slug);

  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    tokens.delete(slug);
    return null; // scaduto
  }

  return entry.token;
}

function deleteToken(slug) {
  tokens.delete(slug);
}

function clearTokens() {
  tokens.clear();
}

function getAllTokens() {
  return Array.from(tokens.entries()).map(([slug, { token, expiresAt }]) => ({
    slug,
    token,
    expiresAt
  }));
}

module.exports = {
  addToken,
  getToken,
  deleteToken,
  clearTokens,
  getAllTokens
};
