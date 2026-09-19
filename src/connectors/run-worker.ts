import { openV2SqliteStore } from "../domain/v2/index.js";
import { drainConnectorOutbox, registerBuiltInConnectors } from "./index.js";

registerBuiltInConnectors();
const store = openV2SqliteStore();
const result = await drainConnectorOutbox(store, {
  workerId: process.env.CONNECTOR_WORKER_ID || `connector-worker-${process.pid}`,
});
console.log(JSON.stringify(result, null, 2));
