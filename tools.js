const path = require('path');
const { retry } = require('./utils');
const { saveVehiclesByPlate } = require('./redisClient');
const { addToken, getToken } = require('./tokenManager');

async function fetchVehiclesForOperator(operator) {
  if (!operator.filename) {
    throw new Error(`Missing filename for operator: ${operator.name}`);
  }

  const modulePath = path.join(__dirname, 'operators', operator.filename);
  const handler = require(modulePath);

  let token = getToken(operator.slug);

  if (!token) {
    console.log(`No token found for operator ${operator.name}, logging in...`);
    token = await retry(() => handler.login(operator.avl.login), 3, 1000);
    addToken(operator.slug, token);
  }

  const vehicles = await retry(() => handler.fetchVehicles(token, operator.avl.vehicles), 3, 1000);
  await saveVehiclesByPlate(vehicles, operator.slug);
}

module.exports = {
  fetchVehiclesForOperator
};
