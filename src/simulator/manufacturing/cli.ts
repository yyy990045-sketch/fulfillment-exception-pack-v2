/**
 * `npm run simulator:manufacturing` —— 运行 Factory Simulator。
 *
 * 它不是 fixture loader：Simulator 按**时间**产生事件，并且每条事件来自不同的真实系统。
 *
 *   npm run simulator:manufacturing                                  # 默认 normal，1x 速度（1 工业日 ≈ 1 秒）
 *   npm run simulator:manufacturing -- --scenario production-shortfall --speed 100
 *   npm run simulator:manufacturing -- --transport mqtt              # 真实 broker（需 OPEN_SUPOS_MQTT_URL）
 *   npm run simulator:manufacturing -- --workspace .preview/my-demo --json
 *
 * 输出**绝不含**任何 secret：MQTT 端点只保留 protocol://host。
 *
 * 真值边界：这是 SIMULATED INDUSTRIAL ENVIRONMENT 的数据源。
 * 即使 publish 成功，也只证明仿真链路成立，不证明真实工厂已接入。
 */
import { createSimulatorTransport, playbackSeconds, type SimulatorTransportKind } from "./transport.js";
import { DEFAULT_SIMULATION_SEED, resolveScenario, SIMULATION_SCENARIOS, SIMULATION_SCENARIO_IDS } from "./scenarios.js";
import { runIndustrialSimulation } from "./runner.js";
import { openIsolatedSimulationWorkspace } from "./workspace.js";
import { SIMULATION_EPOCH_ISO } from "./emitter.js";

export type SimulatorCliOptions = {
  scenario: string;
  seed: string;
  speed: number;
  transport: SimulatorTransportKind;
  workspace: string;
  out: string | null;
  json: boolean;
  quiet: boolean;
};

function valueOf(argv: string[], flag: string) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function parseSimulatorArgs(argv: string[]): SimulatorCliOptions {
  const scenario = valueOf(argv, "--scenario") ?? "normal";
  if (!SIMULATION_SCENARIO_IDS.includes(scenario as never)) {
    throw new Error(`UNKNOWN_SIMULATION_SCENARIO:${scenario}:expected=${SIMULATION_SCENARIO_IDS.join("|")}`);
  }
  const transport = (valueOf(argv, "--transport") ?? "local") as SimulatorTransportKind;
  if (!["local", "inmem", "mqtt"].includes(transport)) throw new Error(`UNSUPPORTED_SIMULATOR_TRANSPORT:${transport}`);
  const speedRaw = valueOf(argv, "--speed");
  const speed = speedRaw === undefined ? 1 : Number(speedRaw);
  if (!Number.isFinite(speed) || speed < 0) throw new Error(`INVALID_SIMULATOR_SPEED:${speedRaw}`);
  return {
    scenario,
    seed: valueOf(argv, "--seed") ?? DEFAULT_SIMULATION_SEED,
    speed,
    transport,
    workspace: valueOf(argv, "--workspace") ?? `.preview/simulator-${scenario}`,
    out: valueOf(argv, "--out") ?? null,
    json: argv.includes("--json"),
    quiet: argv.includes("--quiet"),
  };
}

export async function runSimulatorCli(options: SimulatorCliOptions) {
  const scenario = resolveScenario(options.scenario);
  const workspace = openIsolatedSimulationWorkspace(options.workspace);
  try {
    const sleep = options.speed > 0
      ? (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
      : undefined;
    const run = await runIndustrialSimulation({
      store: workspace.store,
      scenario,
      transport: createSimulatorTransport(options.transport),
      seed: options.seed,
      speed: options.speed,
      ...(sleep ? { sleep } : {}),
      ...(options.quiet
        ? {}
        : { onMessage: ({ topic }: { topic: string }) => process.stderr.write(`  → ${topic}\n`) }),
    });

    const payload = {
      environment: "SIMULATED INDUSTRIAL ENVIRONMENT" as const,
      scenario: run.scenario,
      scenarioLabel: run.scenarioLabel,
      narrative: scenario.narrative,
      seed: run.seed,
      transport: run.transport,
      contextId: run.contextId,
      businessKey: run.businessKey,
      unsRootPath: run.unsRootPath,
      simulatedEpoch: SIMULATION_EPOCH_ISO,
      simulatedSpanMinutes: run.timing.spanMinutes,
      simulatedFirstOccurredAt: run.timing.firstOccurredAt,
      simulatedLastOccurredAt: run.timing.lastOccurredAt,
      playbackSeconds: playbackSeconds(run.timing.spanMinutes, options.speed),
      messageCount: run.messageCount,
      topicCount: run.topics.length,
      topicSamples: run.topics.slice(0, 3),
      sync: run.sync,
      canonicalEventCount: run.canonicalEvents.length,
      eventCount: run.eventCount,
      evidenceCount: run.evidenceCount,
      evaluationCount: run.evaluationCount,
      matchedRuleCount: run.matchedRuleCount,
      notMatchedRuleCount: run.notMatchedRuleCount,
      exceptionCount: run.exceptionCount,
      exceptionCodes: run.exceptionCodes,
      sourceSystems: run.sourceSystems,
      truthfulness: {
        environment: "simulated_industrial_environment",
        realFactory: false,
        realMes: false,
        realErp: false,
        realQms: false,
        realWms: false,
      },
    };

    if (options.out) workspace.writeArtifact(`${options.out}.json`, JSON.stringify(payload, null, 2));
    if (!options.quiet && !options.json) {
      console.log(`SIMULATED INDUSTRIAL ENVIRONMENT  scenario=${run.scenario} seed=${run.seed} transport=${run.transport.kind}`);
      console.log(`  ${run.scenarioLabel}`);
      console.log(`  ${scenario.narrative}`);
      console.log(`  context=${run.businessKey} (${run.contextId})  uns=${run.unsRootPath}`);
      console.log(`  events=${run.messageCount} topics=${run.topics.length} canonical=${run.canonicalEvents.length} evidence=${run.evidenceCount}`);
      console.log(`  evaluations=${run.evaluationCount} exceptions=${run.exceptionCount} ${run.exceptionCodes.join(",") || "none"}`);
      console.log(`  sourceSystems=${run.sourceSystems.join(",")}`);
    }
    if (options.json) console.log(JSON.stringify(payload, null, 2));
    return payload;
  } finally {
    workspace.close();
  }
}

export function simulatorScenarioCatalog() {
  return SIMULATION_SCENARIOS.map((item) => ({
    scenario: item.id,
    label: item.label,
    businessKey: item.businessKey,
    expectedExceptionCodes: item.expectation.exceptionCodes,
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseSimulatorArgs(process.argv.slice(2));
  const result = await runSimulatorCli(options);
  process.exit(result.sync.status === "succeeded" ? 0 : 1);
}
