# Runtime Screenshot Regression Fix

## Goal

Use the real running browser and API as the acceptance source for the reported Context, Operations, and Solution Pack regressions.

## Required Outcomes

- Verify Context Header DOM, geometry, and runtime bundle before changing presentation.
- Verify Operations Header geometry at 1440 and 1600 widths without Shell overlap.
- Make Pack to Context ownership explicit and persistent so installed packs return `boundContexts` after a cold start.
- Keep RuleEvaluation contribution limited to compatibility and conflict detection.
- Capture 1600x900 runtime screenshots for Context, Operations, and Workspace.

## Non-goals

- No Authorization refactor.
- No new page, dashboard, visual redesign, AI provider, rule, or Solution Pack.
