// -----------------------------------------------------------------------------
// Entry point of the Mobiliteit.lu external integration.
//
// Brings the buses, trams and trains of Luxembourg into Gladys through the
// official real-time API of the Administration des transports publics (the
// one behind mobiliteit.lu, a personal key):
//   - devices: one per followed stop, with the next passages, the waits, the
//     delay in real time and the count of traffic messages (src/device.js);
//   - scene triggers: departure soon, departure cancelled, departure delayed,
//     new traffic message;
//   - scene action: read the next passages of a stop;
//   - dashboard widgets: departures, traffic messages.
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
createApp(gladys);

// --- Startup -----------------------------------------------------------------------
logger.info(`Starting the Mobiliteit.lu integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
