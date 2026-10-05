# playwright-run-audit

A small **offline evidence auditor** for explicitly planned Playwright shards. It answers: “Did every expected shard finish, and did every test it discovered produce a terminal result or explicit skip?” It keeps completeness separate from test outcomes.

Useful when a collected report looks green but a shard, process, or result may be missing. Dependency-free auditor; optional public-API Playwright reporter; no service or account.

> Completeness is relative to each shard's **post-selection discovered inventory**. A plan or inventory captured after filtering cannot prove that the intended tests were selected. This tool does not independently verify your grep, projects, source revision, or CI matrix. Use a unique run ID and environment label, and create the plan before launching shards.

## Quick example

Requires Node.js 22 or 24. The auditor itself needs no npm install. To run the synthetic, browser-free Playwright example:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node examples/two-shards.mjs
```

This launches two real Playwright shards and retains a fresh `.audit-example-*/` directory containing the plan and receipts. Expected summary: `Completeness: complete; outcome: expected; exit: 0`.

Remove one shard receipt and rerun the command printed below with that directory: the result becomes incomplete, exit 2. Keep original evidence when auditing an actual run.

```sh
node src/cli.mjs --plan path/to/plan.json --receipts path/to/receipts
node src/cli.mjs --plan path/to/plan.json --receipts path/to/receipts --json
```

The receipt directory must contain only this run's `.jsonl` and `.jsonl.partial` files. It is not recursively searched. Missing files are missing evidence, not successful tests. Files are never modified by the auditor.

## Add the reporter without replacing your reporters

Prepare a plan before the run; use non-sensitive identifiers:

```json
{
  "version": 1,
  "runId": "build-123-revision-abcd",
  "attempt": 1,
  "environment": "ubuntu-chromium",
  "expectedShardIds": ["one", "two"]
}
```

The array is ordered: `one` maps to Playwright shard 1/2, `two` to 2/2. Use a separate run/environment plan for a different CI matrix variant, and increment the attempt for a whole-run retry. Never combine old and new run attempts.

Playwright resolves the reporter module path relative to its config file. This reporter's relative `planFile` and `outputFile` options instead use the directory where you **launch Playwright** (`process.cwd()`). The ESM example below makes those options absolute, anchored beside the config, so launching with `--config tests/playwright.config.mjs` from a parent directory does not change them. For other module formats, supply equivalent absolute paths.

In shard one's existing ESM Playwright config, append the reporter. Put the plan and fresh receipt directory beside that config:

```js
import { fileURLToPath } from 'node:url';

export default {
  // Keep your existing test configuration.
  shard: { current: 1, total: 2 },
  reporter: [
    ['list'], // Keep your own existing reporters here.
    ['./path/to/playwright-run-audit/src/reporter.mjs', {
      planFile: fileURLToPath(new URL('./audit-plan.json', import.meta.url)),
      shardId: 'one',
      outputFile: fileURLToPath(new URL('./fresh-receipts/one.jsonl', import.meta.url))
    }]
  ]
};
```

Create a new, empty `fresh-receipts/` directory for each invocation. Never reuse the same run ID + attempt for a second invocation; a prior receipt cannot identify a new launch. Configure shard two with `current: 2`, `shardId: 'two'`, and a different output file. Do not use `--reporter` to override this configuration. The reporter rejects existing outputs and mismatched shard counts/positions, and supports exactly Playwright **1.62.0 and 1.63.0**. Other versions fail closed until tested and added. Integration tests use the real runner and public Reporter/TestCase APIs; no browser installation is needed.

If ordinary test output says the tests passed but the process exits 1 and no receipt appears, do not count that as a successful audit. Reporter setup failures can be silent; first check the plan/output path bases and that the fresh output directory exists, then inspect the runner status and audit verdict.

Transfer all receipts, including `.partial` files, into a dedicated local directory. Retain the independently prepared plan. The tool does not download CI artifacts, run untrusted tests, or discover browser profiles for you.

## Verdicts and exit codes

| Exit | Completeness | Meaning |
| --- | --- | --- |
| 0 | complete | All planned shards and discovered tests accounted for; expected or flaky outcomes |
| 1 | complete | Evidence complete, but unexpected test outcome, global error, or failed runner status |
| 2 | incomplete / unknown | Missing shard/inventory/end/result, interrupted/timed-out run, unfinalized file, or no external plan |
| 3 | invalid | Invalid input, truncation, duplicate shard/key/retry, mixed provenance, or unverified version |

JSON output is versioned and has separate `completeness`, `outcome`, `counts`, `findings`, and per-shard end status. On invalid input, counts are omitted so partial parsing cannot masquerade as a trustworthy total.

- A retry that passes or explicitly skips after an unexpected attempt remains **flaky**, even when exit 0. Playwright's failed end status (including `failOnFlakyTests`) remains exit 1
- Expected failures count as expected; an unexpected pass counts as unexpected
- Explicit skip/fixme and runtime skip are accounted for; **skipped attempts never count as execution**. A test that failed before a later explicit skip still counts as executed and flaky
- A runner-generated skip, such as a test blocked by a failed serial predecessor, leaves execution incomplete
- Test instances use `(shard ID, Playwright test ID, repeatEachIndex)`; setup dependencies legitimately repeated on different shards remain separate instances
- `executed` means at least one non-skipped result was reported, not proof that a test body or assertion ran
- Individual test timeouts are unexpected outcomes; global timeout/interruption makes run completeness incomplete
- A missing plan is unknown even if all supplied files look successful

The auditor never diagnoses “OOM” or another cause from an absent result. It reports missing evidence.

## Reliability boundaries

Receipts begin as exclusive `.jsonl.partial` files. The reporter appends synchronously, fsyncs and closes the file, then creates the final filename using an exclusive same-filesystem hard link and removes the partial name. A reporter write/finalization failure makes the runner fail and leaves missing/partial/invalid evidence. Any remaining `.partial` prevents exit 0, even if it contains an end record. Use a local filesystem supporting hard links; unsupported filesystems fail closed.

Do not rename partial receipts to finalized names. Keep collection failures visible, use an always-run CI collection step if appropriate, and retain the original runner/job exit status as an independent gate. Append this reporter last where practical. Its end status is the value delivered to its own onEnd callback; other reporters and later exit hooks can still override process status or fail. This tool cannot certify the final process exit code. A power loss, lost artifact, edited receipt, or faulty collection system can lose evidence. These files are not signed and cannot prove authenticity or durability after hardware failure.

Strict versioned parsing rejects unknown fields and duplicate JSON object keys. Limits: 64 MiB/file, 8 MiB/line, 1,000,000 lines/file, and 10,000 planned shards. This is a local trusted-artifact utility, not a hardened service for arbitrary large hostile uploads. JSONL order within a file is significant; input-file order is not.

The reporter records only supplied run labels, opaque Playwright IDs, repeat/retry indices, statuses and counts. It does not copy test titles, source paths, errors, stdout/stderr, environment dumps, screenshots, attachment contents, cookies or credentials. Do not put secrets into run/environment/shard labels. Ordinary Playwright reporters and your test code have their own data behavior.

## When existing tools are a better fit

For routine CI success gating, preserve runner exit codes and job dependencies; [alls-green](https://github.com/re-actors/alls-green) is an established dependency-job gate. For combining available Playwright reports, use native [blob reports and merge-reports](https://playwright.dev/docs/test-sharding#merging-reports-from-multiple-shards). This repository is narrower: auditing an explicitly planned collection of local sidecar receipts. It does not replace native reporting, validate test assertions, or establish source/test-selection coverage.

The implementation uses documented [Reporter](https://playwright.dev/docs/api/class-reporter), [TestCase](https://playwright.dev/docs/api/class-testcase), [TestResult](https://playwright.dev/docs/api/class-testresult), and [FullConfig](https://playwright.dev/docs/api/class-fullconfig) APIs. API/version references checked October 5, 2026. No upstream source code is copied.

## Develop and verify

```sh
node --test test/*.test.mjs
npm ci --ignore-scripts --no-audit --no-fund
npm run test:integration
```

Unit and regression tests cover missing/duplicate/mixed shards, interrupted/truncated evidence, skips, retry outcomes, expected failures, repeated tests, strict parsing, input order, CLI behavior and reporter failures. The real integration harness covers two shards, repeated tests, setup dependencies, dynamic/static skips, retries, expected failures/unexpected passes, serial cascades, global timeout, SIGKILL after discovery, and reporter output failure. Integration requires a POSIX host.

CI runs the same checks on Node 22 and 24 with both documented Playwright versions. It uses standard Ubuntu public runners, read-only contents permission, SHA-pinned official actions, no persisted checkout credentials, no cache and no uploaded artifacts. No credentials or paid service are required.

See [SCHEMA.md](SCHEMA.md) for the exact protocol and [SKILL.md](SKILL.md) for a short local-agent workflow. Original code under [MIT](LICENSE).

## Creator disclosure

Prepared by the creator of [MyTest](https://mytest.app). This is an optional promotional link. The auditor works independently; no visit, account, or MyTest usage is required. There is no tracking or referral parameter in the link.
