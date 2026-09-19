import { describe, expect, it } from "vitest";
import {
  contextStatusLabel,
  outcomeStatusLabel,
  resolutionStatusLabel,
  severityLabel,
  severityTone,
} from "./presentation.js";

describe("shared product presentation", () => {
  it("maps business enums to Chinese labels and consistent severity tones", () => {
    expect(severityLabel("critical")).toBe("严重");
    expect(severityLabel("high")).toBe("高");
    expect(severityLabel("medium")).toBe("中");
    expect(severityLabel("low")).toBe("低");
    expect(severityLabel("unknown")).toBe("未知等级");
    expect(severityTone("critical")).toBe("danger");
    expect(severityTone("high")).toBe("danger");
    expect(severityTone("medium")).toBe("warning");
  });

  it("uses one label source for resolution, context, and outcome statuses", () => {
    expect(resolutionStatusLabel("pending_approval")).toBe("待审批");
    expect(resolutionStatusLabel("closed")).toBe("已结案");
    expect(resolutionStatusLabel("unknown")).toBe("状态未记录");
    expect(contextStatusLabel("active")).toBe("进行中");
    expect(outcomeStatusLabel("target_met")).toBe("目标达成");
    expect(outcomeStatusLabel("insufficient_evidence")).toBe("证据不足");
  });
});
