const config = require('./config.json');
const { fetchVehiclesForOperator } = require('./tools');

async function startPolling() {
  for (const operator of config.operators) {
    if (!operator.enable) continue;

    if (operator.avl?.enable) {
        setInterval(async () => {
        try {
            await fetchVehiclesForOperator(operator, true);
        } catch (err) {
            console.error(`Error polling AVL ${operator.name}:`, err);
        }
        }, (config.default_polling_interval || 60) * 1000);
    }

    if (operator.gtfsrt?.enable){
        setInterval(async () => {
        try {
            await fetchVehiclesForOperator(operator, false);
        } catch (err) {
            console.error(`Error polling GTFS-RT ${operator.name}:`, err);
        }
        }, (config.default_polling_interval || 60) * 1000);
    }

  }
}

startPolling();
