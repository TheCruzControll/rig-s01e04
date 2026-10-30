import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const event = { at: '2026-10-28T23:00:00+01:00', job: 'job', owner: 'rook', status: 'ok' };
let dir: string;
function writeEvents(events: unknown[]) {
  writeFileSync(join(dir, `${night}.jsonl`), events.map(value => JSON.stringify(value)).join('\n'));
}
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rig-reader-')); });
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe('readNight', () => {
  it('reads the real fixture without changing it', () => {
    const path = join('runs', `${night}.jsonl`);
    const before = readFileSync(path);
    const digest = readNight('runs', night);
    expect(digest?.rows.map(row => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.badLines).toBe(1);
    expect(digest?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest?.rows[0].owner).toBeNull();
    expect(digest?.rows[1]).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok',
      lastError: 'upstream 503', firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(readFileSync(path)).toEqual(before);
  });

  it('distinguishes missing files from empty or blank files', () => {
    expect(readNight(dir, night)).toBeNull();
    expect(readNight(join(dir, 'missing'), night)).toBeNull();
    for (const text of ['', '\n  \r\n\t\n']) {
      writeFileSync(join(dir, `${night}.jsonl`), text);
      expect(readNight(dir, night)).toEqual({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
    }
  });

  it.each(['../2026-10-28', '2026-10-28/../x', '/2026-10-28', '2026-1-28', '2026-10-28.jsonl', '2026-10-28\n', ''])('rejects invalid night %j before I/O', invalid => {
    // A non-directory runsDir would throw ENOTDIR if a read were attempted.
    const file = join(dir, 'not-a-directory');
    writeFileSync(file, '');
    expect(readNight(file, invalid)).toBeNull();
  });

  it('propagates non-ENOENT filesystem errors', () => {
    const file = join(dir, 'not-a-directory');
    writeFileSync(file, '');
    expect(() => readNight(file, night)).toThrow();
    mkdirSync(join(dir, `${night}.jsonl`));
    expect(() => readNight(dir, night)).toThrow();
  });

  it('counts malformed JSON and invalid event shapes, retaining null owners', () => {
    const { owner: _owner, ...withoutOwner } = event;
    const invalid: unknown[] = [
      null, [], 42, 'text', {}, withoutOwner,
      { ...event, at: 'yesterday' }, { ...event, at: '2026-10-28T23:00:00' },
      { ...event, at: '2026-02-30T23:00:00Z' }, { ...event, at: '2026-10-28T24:00:00Z' },
      { ...event, at: 3 }, { ...event, job: '' }, { ...event, job: '  ' }, { ...event, job: 3 },
      { ...event, owner: 3 }, { ...event, status: 'unknown' }, { ...event, error: null },
    ];
    writeEvents([...invalid, { ...event, owner: null }]);
    writeFileSync(join(dir, `${night}.jsonl`), `${readFileSync(join(dir, `${night}.jsonl`), 'utf8')}\n{broken\n\n`);
    const digest = readNight(dir, night);
    expect(digest?.badLines).toBe(invalid.length + 1);
    expect(digest?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(digest?.rows).toEqual([{
      job: 'job', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
      firstAt: event.at, lastAt: event.at,
    }]);
  });

  it('orders events by instant, preserves offsets, and retains the latest recorded error after recovery', () => {
    writeEvents([
      { ...event, at: '2026-10-28T11:00:00Z', owner: null },
      { ...event, at: '2026-10-28T10:30:00Z', status: 'fail', error: 'new error' },
      { ...event, at: '2026-10-28T12:00:00+02:00', status: 'retry', error: 'old error' },
      { ...event, at: '2026-10-28T04:00:00-05:00', owner: 'first' },
      { ...event, job: 'AAA', at: '2026-10-28T09:00:00.123Z' },
    ]);
    const digest = readNight(dir, night);
    expect(digest?.counts).toEqual({ ok: 3, retry: 1, fail: 1 });
    expect(digest?.rows.map(row => row.job)).toEqual(['AAA', 'job']);
    expect(digest?.rows[1]).toEqual({
      job: 'job', owner: null, runs: 4, retries: 1, lastStatus: 'ok', lastError: 'new error',
      firstAt: '2026-10-28T04:00:00-05:00', lastAt: '2026-10-28T11:00:00Z',
    });
  });

  it('breaks equal-timestamp ties by file order and keeps an explicitly empty error', () => {
    writeEvents([
      { ...event, owner: 'first', status: 'fail', error: 'error' },
      { ...event, owner: null, error: '' },
    ]);
    expect(readNight(dir, night)?.rows[0]).toMatchObject({ owner: null, lastStatus: 'ok', lastError: '', runs: 2 });
  });
});
