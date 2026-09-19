# Plan

1. Make `factSelectors.label` required and populate Manufacturing and Finance labels.
2. Use presentation labels in Pack Workbench facts.
3. Add idempotent tenant-wide backfill during Store bootstrap after migrations and pack registration.
4. Test upgraded legacy DBs, no-candidate contexts, and ambiguous candidates.
5. Rebuild the live runtime, verify `/workspace`, capture the screenshot, and run regression.
