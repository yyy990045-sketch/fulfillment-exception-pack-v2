import { openV2SqliteStore } from "../../domain/v2/index.js";
import { OpenSupOSAdapter } from "./adapter.js";
import { startConfiguredOpenSupOSInbound } from "./runtime.js";

const store = openV2SqliteStore();
const adapter = new OpenSupOSAdapter(store);
const result = await startConfiguredOpenSupOSInbound(adapter);
console.log(JSON.stringify({ status: result.status }, null, 2));
