// UI-only tests deliberately replace the service boundary. Authentication has
// separate real HTTP and Python tests; production has no bypass switch.
module.exports = () => {
  const service = require('../backend-service.cjs');
  service.createBackendService = () => ({
    start() {}, close() {},
    request:(route, options) => global.fetch(`http://127.0.0.1:8765${route}`, options),
  });
};
