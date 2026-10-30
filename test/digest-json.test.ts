import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('digest JSON', () => {
  let runsDir: string;
  beforeEach(() => { runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-json-')); });
  afterEach(() => { rmSync(runsDir, { recursive: true, force: true }); });

  const request = () => createApp({
    adapter: 'shim', installed: '', beatEverySeconds: 60, runsDir,
  }).request('/api/digest/2026-10-28');

  it('returns only the shared reader rows as JSON', async () => {
    const at = '2026-10-28T08:00:00+01:00';
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), [
      JSON.stringify({ at, job: 'zebra', owner: null, status: 'ok' }),
      JSON.stringify({ at, job: 'alpha', owner: 'rook', status: 'fail', error: 'failed' }),
    ].join('\n'));
    const res = await request();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual([
      { job: 'alpha', owner: 'rook', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'failed', firstAt: at, lastAt: at },
      { job: 'zebra', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstAt: at, lastAt: at },
    ]);
  });

  it('returns an empty array for an empty night', async () => {
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), '');
    const res = await request();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('returns 404 for a missing night', async () => {
    expect((await request()).status).toBe(404);
  });
});
