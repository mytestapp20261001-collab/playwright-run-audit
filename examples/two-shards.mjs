// A real local two-shard run. No browsers, network requests or uploads.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(root, '.audit-example-'));
const receipts = path.join(dir, 'receipts'); fs.mkdirSync(receipts);
const planFile = path.join(dir, 'plan.json');
fs.writeFileSync(planFile, JSON.stringify({ version: 1, runId: path.basename(dir), attempt: 1, environment: 'local-demo', expectedShardIds: ['one', 'two'] }, null, 2));
fs.writeFileSync(path.join(dir, 'demo.spec.mjs'), `import { test, expect } from '@playwright/test';
  test('first', () => expect(2 + 2).toBe(4));
  test('second', () => expect('audit').toContain('dit'));
`);
for (const [index, shardId] of ['one', 'two'].entries()) {
  const config = path.join(dir, `${shardId}.config.mjs`);
  fs.writeFileSync(config, `export default {
    testDir: ${JSON.stringify(dir)}, testMatch:'*.spec.mjs', fullyParallel:true, workers:1,
    outputDir:${JSON.stringify(path.join(dir, 'test-output'))}, shard:{current:${index + 1},total:2},
    reporter:[['list'],[${JSON.stringify(path.join(root, 'src/reporter.mjs'))},
      ${JSON.stringify({ planFile, shardId, outputFile: path.join(receipts, shardId + '.jsonl') })}]]
  };`);
  const child = spawnSync(process.execPath, [path.join(root, 'node_modules/playwright/cli.js'), 'test', '--config', config], { stdio: 'inherit', timeout: 30000 });
  if (child.status !== 0) process.exitCode = 1;
}
console.log(`Receipts retained in ${receipts}`);
const checked = spawnSync(process.execPath, [path.join(root, 'src/cli.mjs'), '--plan', planFile, '--receipts', receipts], { stdio: 'inherit' });
if (checked.status !== 0) process.exitCode = checked.status ?? 3;
