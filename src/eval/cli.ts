import { evaluateAll } from "./run.js";

const report = evaluateAll();
console.log(JSON.stringify(report, null, 2));
if (report.failures.length || report.negativeFailures.length) {
  process.exitCode = 1;
}
