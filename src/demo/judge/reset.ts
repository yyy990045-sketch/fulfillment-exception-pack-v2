/**
 * `npm run demo:judge:reset` —— 只清理 judge 专属工作区。
 *
 * 路径安全检查在 `assertSafeJudgeWorkspace` 里，任何一条不满足就拒绝删除：
 * 必须位于 <repo>/.preview/ 之内、不能是 .preview 本身、不能是仓库根 / HOME / 根目录、
 * 不能是 .sqlite 文件、不能是逃出 .preview 的符号链接。
 *
 * 默认数据库、生产数据库与用户自定义数据库都不在删除范围内。
 */
import { JUDGE_WORKSPACE_DIR, resetJudgeWorkspace } from "./workspace.js";

function valueOf(argv: string[], flag: string) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

const argv = process.argv.slice(2);
const target = valueOf(argv, "--workspace") ?? JUDGE_WORKSPACE_DIR;
try {
  const result = resetJudgeWorkspace(target);
  console.log(`JUDGE_WORKSPACE_RESET ok=${result.removed} root=${result.rootDir}`);
  console.log("只删除了 judge 专属工作区；默认库 / 生产库 / 自定义库未被触碰。");
} catch (error) {
  console.error(`JUDGE_WORKSPACE_RESET_REFUSED ${error instanceof Error ? error.message : String(error)}`);
  console.error("该路径不在 judge 工作区安全范围内，已拒绝删除。");
  process.exit(1);
}
