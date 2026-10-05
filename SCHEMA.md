# Protocol version 1

The validator in `src/format.mjs` and `src/audit.mjs` is authoritative. Every JSON object has exactly the listed fields; additional or duplicate keys are invalid. Files use UTF-8 JSONL with a final newline, no empty lines and no BOM.

## Plan

Fields: `version: 1`, `runId: string`, `attempt: integer >= 0`, `environment: string`, `expectedShardIds: nonempty string[]`.

Identity strings match `[A-Za-z0-9_.:/-]{1,256}`. Integers are nonnegative JavaScript safe integers. Shard IDs are unique and ordered by the runner's 1-based shard index. The plan labels an intended run; it does not enumerate or authenticate source files, selection or tests.

## Header (first record)

Fields: `type: "header"`, `version: 1`, `producer: "playwright-run-audit/1"`, `playwrightVersion: "1.62.0" | "1.63.0"`, `plan: Plan`, `shardId: string`.

Each file represents one shard invocation. Its plan must exactly match the external plan's identity and ordered shard IDs. The receipt's shard ID must be planned. Duplicate shard files and mixed Playwright versions are invalid.

## Inventory (at most once, before attempts)

Fields: `type: "inventory"`, `tests: TestIdentity[]`.

A TestIdentity has exactly `id: string` (public Playwright test ID) and `repeatEachIndex: integer >= 0`. It is unique within the shard. The same identity may appear on different shards, for example a setup dependency. An empty array is allowed; this alone does not establish correct test selection. Missing inventory makes evidence incomplete.

## Attempt (zero or more, after inventory)

Fields: `type: "attempt"`, `test: TestIdentity`, `retry: integer >= 0`, `status: Status`, `expectedStatus: Status`, `explicitSkip: boolean`.

Status is `passed`, `failed`, `timedOut`, `skipped`, or `interrupted`. Attempt test identities must be discovered. Each test's retry indices must start at zero and increase by exactly one, with no duplicates/gaps. Attempts for different tests may interleave.

`expectedStatus` is captured at test end so runtime `test.fail()`/`test.skip()` changes are retained. `explicitSkip` can only be true for a skipped result; an accounted explicit skip also requires expectedStatus `skipped`. A skip with no explicit skip evidence is unreported execution. Any interrupted attempt makes evidence incomplete. A final unexpected status makes outcome unexpected; a matching final result after an earlier mismatch is flaky.

## End (at most once, last record)

Fields: `type: "end"`, `status: "passed" | "failed" | "timedout" | "interrupted"`, `attemptCount: integer >= 0`, `globalErrors: integer >= 0`.

`attemptCount` must match the actual attempt record count. `globalErrors` counts onError callbacks without recording their contents. Missing end is incomplete. Global `timedout`/`interrupted` is incomplete even when every discovered test has a result. The end status is the value received by this reporter, not a certificate of final process exit after other reporters/hooks. Failed end/global errors are an unexpected run outcome, independently of test-level counts.

## Filesystem publication

A `.jsonl.partial` name is unfinalized regardless of its contents. A `.jsonl` name is published only after synchronous writes, fsync and close, using an exclusive hard link and unlink of the partial name. The CLI marks any partial input incomplete and rejects unrelated directory entries. The embeddable `audit(plan, texts, {unfinalized})` function consumes supplied text and requires the caller to preserve that unfinalized-file flag. It cannot inspect filenames itself.

## Audit output

Always: `version: 1`, `completeness: "complete" | "incomplete" | "unknown" | "invalid"`, `outcome: "expected" | "flaky" | "unexpected" | "unknown"`, `exitCode: 0 | 1 | 2 | 3`, `findings: string[]`.

For valid input only: `counts` (shards, discovered, executed, expected, unexpected, flaky, explicitSkipped, unreported, interrupted) and `shards` (id, discovered, endStatus). Counts are test instances, except shards. Executed overlaps outcome counts. A failure followed by explicit skip counts as both flaky and explicitSkipped. Earlier executions followed by a skip still count as executed. Interrupted/unreported are not successful outcomes. Incomplete evidence can retain an observed unexpected outcome; otherwise outcome is unknown. Exit precedence is invalid, incomplete/unknown, complete-unexpected, complete-expected/flaky.
