import fs from 'node:fs';
import { parseJSON } from './json.mjs';
import { VERSION, PLAYWRIGHT_VERSIONS, planCheck, requireThat as check, id } from './format.mjs';

export default class AuditReporter {
  constructor(options = {}) {
    this.options = options;
    this.failed = false; this.fd = undefined; this.attemptCount = 0; this.globalErrors = 0;
  }
  printsToStdio() { return false; }
  fail() { this.failed = true; process.exitCode = 1; }
  write(record) {
    if (this.failed) return;
    try { fs.writeFileSync(this.fd, JSON.stringify(record) + '\n', { encoding: 'utf8' }); }
    catch { this.fail(); }
  }
  onBegin(config, suite) {
    try {
      const plan = planCheck(parseJSON(fs.readFileSync(this.options.planFile, 'utf8')));
      id(this.options.shardId);
      check(plan.expectedShardIds.includes(this.options.shardId), 'Unplanned shard');
      check(PLAYWRIGHT_VERSIONS.includes(config.version), 'Unverified Playwright version');
      // Ordered shard IDs are an explicit mapping to Playwright's 1-based shard index.
      check(config.shard ? config.shard.total === plan.expectedShardIds.length &&
        plan.expectedShardIds[config.shard.current - 1] === this.options.shardId :
        plan.expectedShardIds.length === 1, 'Shard configuration mismatch');
      this.partialFile = this.options.outputFile + '.partial';
      this.fd = fs.openSync(this.partialFile, 'wx', 0o600);
      check(!fs.existsSync(this.options.outputFile), 'Output already exists');
      this.write({ type: 'header', version: VERSION, producer: 'playwright-run-audit/1', playwrightVersion: config.version, plan, shardId: this.options.shardId });
      this.write({ type: 'inventory', tests: suite.allTests().map(test => this.identity(test)) });
    } catch { this.fail(); }
  }
  identity(test) { return { id: test.id, repeatEachIndex: test.repeatEachIndex }; }
  onTestEnd(test, result) {
    const explicitSkip = result.status === 'skipped' && test.expectedStatus === 'skipped';
    this.write({ type: 'attempt', test: this.identity(test), retry: result.retry, status: result.status, expectedStatus: test.expectedStatus, explicitSkip });
    this.attemptCount++;
  }
  onError() { this.globalErrors++; }
  onEnd(result) {
    this.write({ type: 'end', status: result.status, attemptCount: this.attemptCount, globalErrors: this.globalErrors });
    try {
      if (this.fd !== undefined) { fs.fsyncSync(this.fd); fs.closeSync(this.fd); this.fd = undefined;
        if (!this.failed) {
          // Exclusive hard link publishes only a closed, fsynced file; never replace a previous run.
          fs.linkSync(this.partialFile, this.options.outputFile);
          fs.unlinkSync(this.partialFile);
        } }
    } catch { this.fail(); }
    if (this.failed) return { status: 'failed' };
  }
}
