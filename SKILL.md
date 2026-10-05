---
name: playwright-run-audit
description: Audit local explicitly planned Playwright shard receipts for completeness separately from outcomes.
---

# Audit a local Playwright run

Use when the task is to check a collection of run-audit sidecars for missing shards, missing test results or interrupted runs. This skill only concerns that local audit task.

1. Locate the independently prepared version-1 plan and all receipts for the same run, attempt and environment. Do not mix run retries or CI matrix variants. Keep `.partial` files and collection failures visible.
2. Check README compatibility and protocol limits. Do not execute unfamiliar test code merely to inspect an artifact.
3. Run `node src/cli.mjs --plan PLAN --receipts DIRECTORY --json` from this tool's checkout. It reads local files and performs no network requests or mutations. Quote paths safely when building a shell command.
4. Report completeness and outcomes separately, with observed counts and exit code. Exit 0 permits flaky outcomes and explicit skips; neither means every test passed on its first execution.
5. Exit 2 means missing/unfinished/unknown evidence. Find the missing artifact or original job result if already authorized; do not invent a cause or relabel absent results as passed. Exit 3 means invalid or incompatible inputs and is not a trustworthy test total.
6. State that discovered inventory follows selection. This audit cannot prove correct grep/project/source selection, artifact authenticity, or meaningful assertions. Preserve original runner and CI job status.

For ordinary report merging or CI dependency gating, use Playwright's native merge-reports or an established job gate instead. Adding the optional reporter must preserve existing reporters and use fresh output paths. Do not upload receipts or share run identifiers unless the task authorizes that destination.
