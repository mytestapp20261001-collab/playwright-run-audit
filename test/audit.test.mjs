import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../src/audit.mjs';
import { parseJSON } from '../src/json.mjs';

const plan = { version: 1, runId: 'synthetic-run', attempt: 1, environment: 'linux-ci', expectedShardIds: ['one', 'two'] };
const one = { ...plan, expectedShardIds: ['one'] };
const t = (id = 'test-a', repeatEachIndex = 0) => ({ id, repeatEachIndex });
const a = (test = t(), status = 'passed', expectedStatus = 'passed', retry = 0) => ({ type: 'attempt', test, retry, status, expectedStatus, explicitSkip: status === 'skipped' && expectedStatus === 'skipped' });
function records(shardId = 'one', options = {}) {
  const { tests = [t()], attempts = [a()], status = 'passed', globalErrors = 0, end = true, inventory = true, p = plan } = options;
  return [
    { type: 'header', version: 1, producer: 'playwright-run-audit/1', playwrightVersion: '1.63.0', plan: p, shardId },
    ...(inventory ? [{ type: 'inventory', tests }] : []),
    ...attempts,
    ...(end ? [{ type: 'end', status, attemptCount: attempts.length, globalErrors }] : []),
  ];
}
const jsonl = records => records.map(record => JSON.stringify(record)).join('\n') + '\n';
const run = options => audit(one, [jsonl(records('one', { ...options, p: one }))]);

test('complete expected; file order invariant; duplicate IDs across shard scopes valid', () => {
  const inputs = [jsonl(records()), jsonl(records('two'))];
  assert.equal(audit(plan, inputs).exitCode, 0);
  assert.deepEqual(audit(plan, inputs), audit(plan, inputs.reverse()));
  assert.equal(audit(plan, inputs).counts.executed, 2);
});
test('complete unexpected retains completeness', () => {
  const r = run({ attempts: [a(t(), 'failed')], status: 'failed' });
  assert.equal(r.exitCode, 1); assert.equal(r.completeness, 'complete'); assert.equal(r.counts.unexpected, 1);
});
test('missing shard is incomplete; duplicate shard invalid', () => {
  const r = jsonl(records());
  assert.equal(audit(plan, [r]).exitCode, 2);
  assert.equal(audit(plan, [r, r]).exitCode, 3);
});
for (const field of ['runId', 'attempt', 'environment', 'expectedShardIds']) test(`mixed ${field} invalid`, () => {
  const p = { ...plan, [field]: field === 'attempt' ? 2 : field === 'expectedShardIds' ? ['two', 'one'] : 'other' };
  assert.equal(audit(plan, [jsonl(records()), jsonl(records('two', { p }))]).exitCode, 3);
});
test('missing external plan remains unknown even with complete receipts', () => {
  const r = audit(null, [jsonl(records()), jsonl(records('two'))]);
  assert.equal(r.exitCode, 2); assert.equal(r.completeness, 'unknown');
});
test('missing inventory, killed after discovery and missing results are incomplete', () => {
  assert.equal(run({ inventory: false, attempts: [], end: false }).exitCode, 2);
  assert.equal(run({ attempts: [], end: false }).exitCode, 2);
  assert.equal(run({ attempts: [] }).exitCode, 2);
});
for (const status of ['interrupted', 'timedout']) test(`run ${status} is incomplete`, () => assert.equal(run({ status }).exitCode, 2));
test('interrupted test is incomplete even with passed run status', () => assert.equal(run({ attempts: [a(t(), 'interrupted')] }).exitCode, 2));
test('retry pass remains flaky; fail-on-flaky status preserved', () => {
  const options = { attempts: [a(t(), 'failed'), a(t(), 'passed', 'passed', 1)] };
  assert.equal(run(options).outcome, 'flaky'); assert.equal(run(options).counts.flaky, 1);
  assert.equal(run({ ...options, status: 'failed' }).exitCode, 1);
});
test('expected failure and unexpected pass are distinct', () => {
  assert.equal(run({ attempts: [a(t(), 'failed', 'failed')] }).exitCode, 0);
  assert.equal(run({ attempts: [a(t(), 'passed', 'failed')], status: 'failed' }).exitCode, 1);
});
test('explicit skip accounted, never counted as executed; unreported skip incomplete', () => {
  const r = run({ attempts: [a(t(), 'skipped', 'skipped')] });
  assert.equal(r.exitCode, 0); assert.equal(r.counts.explicitSkipped, 1); assert.equal(r.counts.executed, 0);
  assert.equal(run({ attempts: [a(t(), 'skipped')] }).exitCode, 2);
});
test('repeatEach identity preserved; duplicate inventory rejected', () => {
  const tests = [t(), t('test-a', 1)];
  assert.equal(run({ tests, attempts: tests.map(test => a(test)) }).counts.executed, 2);
  assert.equal(run({ tests: [t(), t()] }).exitCode, 3);
});
test('global errors and run failure never produce green', () => {
  assert.equal(run({ globalErrors: 1 }).exitCode, 1);
  assert.equal(run({ status: 'failed' }).exitCode, 1);
});
test('unfinalized file cannot be green even if all records exist', () => assert.equal(audit(plan, [jsonl(records()), jsonl(records('two'))], { unfinalized: true }).exitCode, 2));
test('malformed, truncated, blank, duplicate-key and incompatible records rejected', () => {
  const good = jsonl(records('one', { p: one }));
  for (const bad of ['', '{\n', good.slice(0, -1), good + '\n', good.replace('"version":1', '"version":1,"version":1'), good.replace('1.63.0', '2.0.0')]) assert.equal(audit(one, [bad]).exitCode, 3);
});
test('unknown fields, no inventory, bogus counts, post-end data and duplicate retry rejected', () => {
  const base = records('one', { p: one });
  const cases = [
    [ { ...base[0], surprise: 1 }, ...base.slice(1) ],
    [base[0], base[2], base[3]],
    [...base.slice(0, -1), { ...base.at(-1), attemptCount: 2 }],
    [...base, base[2]],
    [...base.slice(0, -1), base[2], { ...base.at(-1), attemptCount: 2 }],
  ];
  for (const records of cases) assert.equal(audit(one, [jsonl(records)]).exitCode, 3);
});
test('every record removal from successful receipt is non-green', () => {
  const base = records('one', { p: one });
  for (let i = 0; i < base.length; i++) assert.notEqual(audit(one, [jsonl(base.filter((_, j) => i !== j))]).exitCode, 0);
});
test('JSON parser respects escapes, primitives, rejects invalid syntax and nesting', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(parseJSON('{"escaped":"a\\\"b","items":[1,true,null]}'))), { escaped: 'a"b', items: [1, true, null] });
  for (const text of ['01', '[1,]', '{"x":1,}', '1e999', '{"x":1,"x":2}', '[', '[NaN]', '"line\nline"', '['.repeat(66) + ']'.repeat(66)]) assert.throws(() => parseJSON(text));
});

test('failure then explicit skip remains flaky as in Playwright', () => {
  const r = run({ attempts: [a(t(), 'failed'), a(t(), 'skipped', 'skipped', 1)] });
  assert.equal(r.outcome, 'flaky'); assert.equal(r.counts.flaky, 1);
  assert.equal(r.counts.explicitSkipped, 1); assert.equal(r.counts.executed, 1);
});
