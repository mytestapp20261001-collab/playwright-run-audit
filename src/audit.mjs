import { parseJSON } from './json.mjs';
import { VERSION, PLAYWRIGHT_VERSIONS, STATUSES, requireThat as check, keys, id, integer, planCheck, samePlan, testCheck, testKey } from './format.mjs';

function receipt(text) {
  check(typeof text === 'string' && Buffer.byteLength(text) <= 64 * 1024 * 1024, 'Receipt exceeds size limit');
  check(text.endsWith('\n'), 'Receipt is truncated or lacks final newline');
  const lines = text.slice(0, -1).split('\n');
  check(lines.length <= 1000000 && lines.every(line => line.length > 0 && line.length <= 8 * 1024 * 1024), 'Invalid receipt lines');
  const records = lines.map(parseJSON);
  const header = records.shift();
  keys(header, ['type', 'version', 'producer', 'playwrightVersion', 'plan', 'shardId']);
  check(header.type === 'header' && header.version === VERSION && header.producer === 'playwright-run-audit/1', 'Unsupported receipt header');
  check(PLAYWRIGHT_VERSIONS.includes(header.playwrightVersion), 'Unverified Playwright version');
  planCheck(header.plan); id(header.shardId);
  check(header.plan.expectedShardIds.includes(header.shardId), 'Unplanned shard');
  let inventory = null, end = null, eventCount = 0;
  const attempts = new Map();
  for (const record of records) {
    check(!end, 'Records after end');
    if (record.type === 'inventory') {
      keys(record, ['type', 'tests']);
      check(inventory === null && eventCount === 0 && Array.isArray(record.tests), 'Invalid inventory');
      inventory = new Map();
      for (const test of record.tests) {
        testCheck(test); const key = testKey(test);
        check(!inventory.has(key), 'Duplicate inventory test');
        inventory.set(key, test);
      }
    } else if (record.type === 'attempt') {
      keys(record, ['type', 'test', 'retry', 'status', 'expectedStatus', 'explicitSkip']);
      testCheck(record.test); integer(record.retry);
      check(STATUSES.includes(record.status) && STATUSES.includes(record.expectedStatus) && typeof record.explicitSkip === 'boolean', 'Invalid attempt status');
      check(!record.explicitSkip || record.status === 'skipped', 'Invalid skip annotation');
      const key = testKey(record.test);
      check(inventory?.has(key), 'Undiscovered test');
      const previous = attempts.get(key) ?? [];
      check(record.retry === previous.length, 'Duplicate or out-of-order retry');
      previous.push(record); attempts.set(key, previous); eventCount++;
    } else if (record.type === 'end') {
      keys(record, ['type', 'status', 'attemptCount', 'globalErrors']);
      check(['passed', 'failed', 'timedout', 'interrupted'].includes(record.status), 'Invalid end status');
      integer(record.attemptCount); integer(record.globalErrors);
      check(inventory !== null && record.attemptCount === eventCount, 'End count mismatch');
      end = record;
    } else throw new Error('Unknown receipt record');
  }
  return { header, inventory, attempts, end };
}

// Input strings make this deterministic and easy to embed; no network or filesystem here.
export function audit(plan, texts, { unfinalized = false } = {}) {
  const result = {
    version: VERSION, completeness: 'unknown', outcome: 'unknown', exitCode: 2,
    counts: { shards: 0, discovered: 0, executed: 0, expected: 0, unexpected: 0, flaky: 0, explicitSkipped: 0, unreported: 0, interrupted: 0 },
    findings: [], shards: [],
  };
  try {
    if (plan !== null) planCheck(plan);
    const receipts = texts.map(receipt).sort((a, b) => a.header.shardId.localeCompare(b.header.shardId, 'en'));
    const seen = new Set();
    const effectivePlan = plan ?? receipts[0]?.header.plan;
    for (const r of receipts) {
      check(!seen.has(r.header.shardId), 'Duplicate shard receipt'); seen.add(r.header.shardId);
      check(effectivePlan && samePlan(effectivePlan, r.header.plan), 'Mixed run identity, attempt, environment or shard plan');
      if (receipts.length > 1) check(r.header.playwrightVersion === receipts[0].header.playwrightVersion, 'Mixed Playwright versions');
    }
    if (unfinalized) result.findings.push('Unfinalized reporter output present');
    if (!plan) result.findings.push('No external plan: completeness is unknown');
    if (plan) for (const shard of [...plan.expectedShardIds].sort()) if (!seen.has(shard)) result.findings.push(`Missing shard: ${shard}`);
    for (const r of receipts) {
      const shard = { id: r.header.shardId, discovered: r.inventory?.size ?? 0, endStatus: r.end?.status ?? null };
      result.shards.push(shard); result.counts.shards++; result.counts.discovered += shard.discovered;
      if (!r.inventory) result.findings.push(`Missing inventory: ${shard.id}`);
      if (!r.end) result.findings.push(`Missing end receipt: ${shard.id}`);
      if (r.end && ['interrupted', 'timedout'].includes(r.end.status)) result.findings.push(`Incomplete run status: ${shard.id}/${r.end.status}`);
      for (const key of r.inventory?.keys() ?? []) {
        const attempts = r.attempts.get(key) ?? [];
        const final = attempts.at(-1);
        if (attempts.some(a => a.status !== 'skipped')) result.counts.executed++;
        if (!final) { result.counts.unreported++; continue; }
        if (attempts.some(a => a.status === 'interrupted')) { result.counts.interrupted++; continue; }
        if (final.status === 'skipped') {
          if (final.explicitSkip && final.expectedStatus === 'skipped') {
            result.counts.explicitSkipped++;
            if (attempts.some(a => a.status !== 'skipped' && a.status !== a.expectedStatus)) result.counts.flaky++;
          }
          else result.counts.unreported++;
          continue;
        }
        const matched = final.status === final.expectedStatus;
        if (!matched) result.counts.unexpected++;
        else if (attempts.some(a => a.status !== 'skipped' && a.status !== a.expectedStatus)) result.counts.flaky++;
        else result.counts.expected++;
      }
    }
    if (result.counts.unreported) result.findings.push('Discovered tests without an explicit terminal result or explicit skip');
    if (result.counts.interrupted) result.findings.push('Interrupted test attempts');
    const unexpected = result.counts.unexpected > 0 || receipts.some(r => r.end?.status === 'failed' || r.end?.globalErrors > 0);
    result.outcome = unexpected ? 'unexpected' : (result.counts.flaky ? 'flaky' : 'expected');
    result.completeness = !plan ? 'unknown' : result.findings.length ? 'incomplete' : 'complete';
    if (result.completeness !== 'complete' && !unexpected) result.outcome = 'unknown';
    result.exitCode = result.completeness !== 'complete' ? 2 : unexpected ? 1 : 0;
    result.findings.sort();
    return result;
  } catch (error) {
    // Only fixed validator messages are exposed, never raw input or stack paths.
    return { version: VERSION, completeness: 'invalid', outcome: 'unknown', exitCode: 3, findings: [error.message] };
  }
}
