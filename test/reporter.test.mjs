import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Reporter from '../src/reporter.mjs';
import { audit } from '../src/audit.mjs';

const plan = { version: 1, runId: 'unit', attempt: 0, environment: 'unit', expectedShardIds: ['one'] };
function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-unit-'));
  const planFile = path.join(dir, 'plan.json'); fs.writeFileSync(planFile, JSON.stringify(plan));
  const receipts = path.join(dir, 'receipts'); fs.mkdirSync(receipts);
  try { fn({ dir, planFile, receipts, outputFile: path.join(receipts, 'one.jsonl') }); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); process.exitCode = 0; }
}
const tc = { id: 'id', repeatEachIndex: 0, expectedStatus: 'passed' };
const config = { version: '1.63.0', shard: null };
test('reporter writes and seals, ignores payloads, CLI text and JSON agree', () => fixture(opts => {
  const reporter = new Reporter({ ...opts, shardId: 'one' });
  reporter.onBegin(config, { allTests: () => [tc] });
  assert.ok(fs.existsSync(opts.outputFile + '.partial')); assert.ok(!fs.existsSync(opts.outputFile));
  reporter.onTestEnd(tc, { retry: 0, status: 'passed', stdout: ['PRIVATE'], attachments: ['PRIVATE'] });
  reporter.onEnd({ status: 'passed' });
  const text = fs.readFileSync(opts.outputFile, 'utf8');
  assert.ok(!text.includes('PRIVATE')); assert.ok(!fs.existsSync(opts.outputFile + '.partial'));
  assert.equal(audit(plan, [text]).exitCode, 0);
  for (const extra of [[], ['--json']]) {
    const cli = spawnSync(process.execPath, ['src/cli.mjs', '--plan', opts.planFile, '--receipts', opts.receipts, ...extra], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr); assert.match(cli.stdout, /complete/);
  }
}));
test('partial closed-looking output remains incomplete in CLI', () => fixture(opts => {
  const reporter = new Reporter({ ...opts, shardId: 'one' });
  reporter.onBegin(config, { allTests: () => [tc] }); reporter.onTestEnd(tc, { retry: 0, status: 'passed' }); reporter.onEnd({ status: 'passed' });
  fs.renameSync(opts.outputFile, opts.outputFile + '.partial');
  const cli = spawnSync(process.execPath, ['src/cli.mjs', '--plan', opts.planFile, '--receipts', opts.receipts, '--json'], { encoding: 'utf8' });
  assert.equal(cli.status, 2); assert.match(cli.stdout, /Unfinalized/);
}));
test('write failure stops final publication and forces reporter failure', () => fixture(opts => {
  const reporter = new Reporter({ ...opts, shardId: 'one' });
  reporter.onBegin(config, { allTests: () => [tc] }); fs.closeSync(reporter.fd);
  reporter.onTestEnd(tc, { retry: 0, status: 'passed' });
  assert.equal(reporter.onEnd({ status: 'passed' }).status, 'failed');
  assert.ok(!fs.existsSync(opts.outputFile));
  assert.equal(audit(plan, [fs.readFileSync(opts.outputFile + '.partial', 'utf8')]).exitCode, 2);
}));
test('existing outputs, unsupported version and shard mismatch fail closed', () => fixture(opts => {
  for (const cfg of [{ ...config, version: '1.61.0' }, { ...config, shard: { total: 2, current: 1 } }]) {
    const reporter = new Reporter({ ...opts, shardId: 'one' }); reporter.onBegin(cfg, { allTests: () => [tc] });
    assert.equal(reporter.onEnd({ status: 'passed' }).status, 'failed');
    assert.ok(!fs.existsSync(opts.outputFile));
  }
  fs.writeFileSync(opts.outputFile, 'prior-run');
  const reporter = new Reporter({ ...opts, shardId: 'one' }); reporter.onBegin(config, { allTests: () => [tc] });
  assert.equal(reporter.onEnd({ status: 'passed' }).status, 'failed'); assert.equal(fs.readFileSync(opts.outputFile, 'utf8'), 'prior-run');
}));
test('CLI invalid input and unplanned directory files rejected', () => fixture(opts => {
  fs.writeFileSync(path.join(opts.receipts, 'secret.txt'), 'private');
  const cli = spawnSync(process.execPath, ['src/cli.mjs', '--plan', opts.planFile, '--receipts', opts.receipts, '--json'], { encoding: 'utf8' });
  assert.equal(cli.status, 3); assert.ok(!cli.stdout.includes('private'));
}));
