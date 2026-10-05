// Real Playwright runner integration; no browser download or external target.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { audit } from '../src/audit.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(root, '.integration-output-'));
const runner = path.join(root, 'node_modules/playwright/cli.js');
const reporter = path.join(root, 'src/reporter.mjs');
const version = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@playwright/test/package.json'))).version;
let runs = 0;
function prepare(name, source, { shards = 1, extra = '', setup = false } = {}) {
  const dir = path.join(work, name); fs.mkdirSync(dir);
  const receipts = path.join(dir, 'receipts'); fs.mkdirSync(receipts);
  const plan = { version: 1, runId: name, attempt: 1, environment: 'synthetic-integration', expectedShardIds: Array.from({ length: shards }, (_, i) => String(i + 1)) };
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan));
  fs.writeFileSync(path.join(dir, 'main.case.mjs'), `import { test, expect } from '@playwright/test';\n${source}`);
  if (setup) fs.writeFileSync(path.join(dir, 'setup.spec.mjs'), `import { test } from '@playwright/test'; test('setup', () => {});`);
  const configs = [];
  for (let i = 1; i <= shards; i++) {
    const config = path.join(dir, `config-${i}.mjs`); configs.push(config);
    fs.writeFileSync(config, `export default {
      testDir: ${JSON.stringify(dir)}, testMatch: '*.case.mjs', workers: 1, fullyParallel: true,
      outputDir: ${JSON.stringify(path.join(dir, 'runner-output-' + i))},
      shard: {current: ${i}, total: ${shards}},
      reporter: [['dot'], [${JSON.stringify(reporter)}, {planFile: ${JSON.stringify(path.join(dir, 'plan.json'))}, shardId: '${i}', outputFile: ${JSON.stringify(path.join(receipts, i + '.jsonl'))}}]],
      ${setup ? "projects: [{name:'setup', testMatch:'setup.spec.mjs', repeatEach:1}, {name:'main', testMatch:'*.case.mjs', dependencies:['setup']}]," : ''}
      ${extra}
    };`);
  }
  return { dir, receipts, plan, configs };
}
function run(scenario, expectedStatus) {
  for (const config of scenario.configs) {
    const process = spawnSync(globalThis.process.execPath, [runner, 'test', '--config', config], { cwd: root, encoding: 'utf8', timeout: 30000 }); runs++;
    assert.equal(process.status, expectedStatus, process.stdout + process.stderr);
  }
  const names = fs.readdirSync(scenario.receipts);
  const texts = names.map(name => fs.readFileSync(path.join(scenario.receipts, name), 'utf8'));
  return audit(scenario.plan, texts, { unfinalized: names.some(name => name.endsWith('.partial')) });
}
try {
  const complete = prepare('two-shards', `
    test('pass', async ({}, info) => { console.log('SYNTHETIC-NOT-CAPTURED'); await info.attach('synthetic', {body:Buffer.from('SYNTHETIC-NOT-CAPTURED')}); });
    test('retry', ({}, info) => { expect(info.retry).toBe(1); });
    test('expected failure', () => { test.fail(); expect(1).toBe(2); });
    test.skip('explicit skip', () => {});
    test('runtime skip', () => { test.skip(true); });
  `, { shards: 2, setup: true, extra: 'repeatEach: 2, retries: 1,' });
  const result = run(complete, 0);
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.equal(result.counts.discovered, 12); assert.equal(result.counts.executed, 8);
  assert.equal(result.counts.flaky, 2); assert.equal(result.counts.explicitSkipped, 4);
  for (const file of fs.readdirSync(complete.receipts)) assert.ok(!fs.readFileSync(path.join(complete.receipts, file), 'utf8').includes('SYNTHETIC-NOT-CAPTURED'));
  const partial = fs.readFileSync(path.join(complete.receipts, '1.jsonl'), 'utf8');
  assert.equal(audit(complete.plan, [partial]).exitCode, 2);
  const retrySkip = run(prepare('retry-skip', `test('fail then skip', ({}, info) => { test.skip(info.retry > 0); expect(1).toBe(2); });`, { extra: 'retries: 1,' }), 0);
  assert.equal(retrySkip.outcome, 'flaky'); assert.equal(retrySkip.counts.explicitSkipped, 1);
  const failure = run(prepare('failure', `test('failure', () => expect(1).toBe(2));`), 1);
  assert.equal(failure.exitCode, 1); assert.equal(failure.completeness, 'complete');
  const unexpectedPass = run(prepare('unexpected-pass', `test('unexpected pass', () => { test.fail(); });`), 1);
  assert.equal(unexpectedPass.counts.unexpected, 1); assert.equal(unexpectedPass.exitCode, 1);
  const serial = run(prepare('serial-skip', `test.describe.serial('serial', () => { test('first', () => expect(1).toBe(2)); test('not run', () => {}); });`), 1);
  assert.equal(serial.exitCode, 2); assert.equal(serial.counts.unreported, 1);
  const timedout = run(prepare('timeout', `test('wait', async () => { await new Promise(resolve => setTimeout(resolve, 10000)); });`, { extra: 'globalTimeout: 1500,' }), 1);
  assert.equal(timedout.exitCode, 2, JSON.stringify(timedout));
  const badOutput = prepare('write-failure', `test('pass', () => {});`);
  // A preexisting partial file prevents exclusive creation; success cannot overwrite earlier evidence.
  fs.writeFileSync(path.join(badOutput.receipts, '1.jsonl.partial'), 'old');
  assert.notEqual(run(badOutput, 1).exitCode, 0);
  if (process.platform === 'win32') throw new Error('SIGKILL integration requires POSIX');
  const killed = prepare('killed', `test('wait', async () => { await new Promise(resolve => setTimeout(resolve, 10000)); });`);
  const child = spawn(process.execPath, [runner, 'test', '--config', killed.configs[0]], { cwd: root, detached: true, stdio: 'ignore' });
  const finished = new Promise(resolve => child.on('exit', (code, signal) => resolve({code, signal})));
  const deadline = Date.now() + 15000;
  while (true) {
    const file = path.join(killed.receipts, '1.jsonl.partial');
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('"type":"inventory"')) break;
    if (Date.now() > deadline || child.exitCode !== null) throw new Error('Runner did not reach discovery');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  process.kill(-child.pid, 'SIGKILL'); await finished; runs++;
  const killedReceipt = fs.readFileSync(path.join(killed.receipts, '1.jsonl.partial'), 'utf8');
  assert.equal(audit(killed.plan, [killedReceipt], { unfinalized: true }).exitCode, 2);
  console.log(`Verified Playwright ${version}: ${runs} real runner invocations, two shards, repeats, dependencies, retries, expected/unexpected outcomes, skips, timeout, SIGKILL and reporter write failure`);
} finally { fs.rmSync(work, { recursive: true, force: true }); }
