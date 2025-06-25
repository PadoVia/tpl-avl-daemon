const config = require('./config.json');
const { fetchVehiclesForOperator } = require('./tools');

async function startPolling() {
  for (const operator of config.operators) {
    if (!operator.enable || !operator.avl?.enable) continue;
    
    setInterval(async () => {
      try {
        await fetchVehiclesForOperator(operator);
      } catch (err) {
        console.error(`Error polling ${operator.name}:`, err);
      }
    }, (config.default_polling_interval || 60) * 1000);
  }
}

startPolling();
