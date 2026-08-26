const { startConnections } = require('./src/runConnections');
const config = require('./config/config.json');

startConnections(config).catch((e) => {
  console.error(e);
  process.exit(1);
});
