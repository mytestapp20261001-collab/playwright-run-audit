#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { audit } from './audit.mjs';
import { parseJSON } from './json.mjs';

const args = process.argv.slice(2);
let planFile = null, receiptDir = null, json = false;
let result;
try {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') { if (json) throw Error(); json = true; }
    else if (args[i] === '--plan' && !planFile) planFile = args[++i];
    else if (args[i] === '--receipts' && !receiptDir) receiptDir = args[++i];
    else throw Error();
  }
  if (!receiptDir) throw Error();
  const read = file => {
    if (!fs.statSync(file).isFile() || fs.statSync(file).size > 64 * 1024 * 1024) throw Error();
    return fs.readFileSync(file, 'utf8');
  };
  const entries = fs.readdirSync(receiptDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  if (entries.some(entry => !entry.isFile() || !/^.+\.jsonl(?:\.partial)?$/.test(entry.name))) throw Error();
  result = audit(planFile ? parseJSON(read(planFile)) : null, entries.map(entry => read(path.join(receiptDir, entry.name))), { unfinalized: entries.some(entry => entry.name.endsWith('.partial')) });
} catch {
  result = { version: 1, completeness: 'invalid', outcome: 'unknown', exitCode: 3, findings: ['Invalid arguments, unreadable input, invalid JSON, or unexpected receipt directory entry'] };
}
if (json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`Completeness: ${result.completeness}; outcome: ${result.outcome}; exit: ${result.exitCode}`);
  if (result.counts) console.log(`Discovered: ${result.counts.discovered}; executed: ${result.counts.executed}; explicit skips: ${result.counts.explicitSkipped}; flaky: ${result.counts.flaky}; unexpected: ${result.counts.unexpected}`);
  for (const finding of result.findings) console.log(`- ${finding}`);
}
process.exitCode = result.exitCode;
