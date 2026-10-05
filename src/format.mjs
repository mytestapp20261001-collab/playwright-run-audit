export const VERSION = 1;
export const PLAYWRIGHT_VERSIONS = ['1.62.0', '1.63.0'];
export const STATUSES = ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'];
export function requireThat(condition, message) { if (!condition) throw new Error(message); }
export function keys(value, names) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === [...names].sort().join('|'), 'Unexpected object fields');
}
export function id(value) {
  requireThat(typeof value === 'string' && /^[A-Za-z0-9_.:/-]{1,256}$/.test(value), 'Invalid identity');
}
export function integer(value) { requireThat(Number.isSafeInteger(value) && value >= 0, 'Invalid integer'); }
export function planCheck(plan) {
  keys(plan, ['version', 'runId', 'attempt', 'environment', 'expectedShardIds']);
  requireThat(plan.version === VERSION, 'Unsupported plan version');
  id(plan.runId); id(plan.environment); integer(plan.attempt);
  requireThat(Array.isArray(plan.expectedShardIds) && plan.expectedShardIds.length > 0 && plan.expectedShardIds.length <= 10000, 'Invalid shard plan');
  plan.expectedShardIds.forEach(id);
  requireThat(new Set(plan.expectedShardIds).size === plan.expectedShardIds.length, 'Duplicate planned shard');
  return plan;
}
export function samePlan(a, b) {
  return a.runId === b.runId && a.attempt === b.attempt && a.environment === b.environment &&
    JSON.stringify(a.expectedShardIds) === JSON.stringify(b.expectedShardIds);
}
export function testKey(test) { return JSON.stringify([test.id, test.repeatEachIndex]); }
export function testCheck(test) {
  keys(test, ['id', 'repeatEachIndex']); id(test.id); integer(test.repeatEachIndex);
}
