// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// Keep the executable Node/SQLite proof in CI's normal Vitest discovery as
// well as allowing a dependency-free direct run during local incident repair.
describe('security and migration regressions', () => {
  it('passes the synthetic SQLite authorization/CAS/migration matrix', () => {
    const output = execFileSync(process.execPath, ['worker/ae/securityMigration.regression.mjs'], {
      cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(output).toBe('PASS 71 SQLite security/migration assertions\n');
  });
});
