import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import * as reader from '../src/digest/reader.js';
import * as heartbeat from '../src/heartbeat.js';
import { readStatus } from '../src/status.js';

let dir: string;
const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: '' };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rig-board-'));
  config.runsDir = dir;
});
afterEach(() => {
  vi.restoreAllMocks();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('digest board links', () => {
  it('links both fixture nights with validated event counts, newest first', async () => {
    for (const night of ['2026-10-27', '2026-10-28']) {
      copyFileSync(join('runs', `${night}.jsonl`), join(dir, `${night}.jsonl`));
    }
    writeFileSync(join(dir, 'notes.txt'), 'not a night');
    const status = readStatus(config);
    expect(status.nights).toEqual(['2026-10-28', '2026-10-27']);
    expect(status.nightCounts).toEqual({
      '2026-10-28': { ok: 10, retry: 4, fail: 1 },
      '2026-10-27': { ok: 7, retry: 0, fail: 0 },
    });
    const res = await createApp(config).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a> · validated log events: ok 10 / retry 4 / fail 1');
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a> · validated log events: ok 7 / retry 0 / fail 0');
    expect(html.indexOf('/digest/2026-10-28')).toBeLessThan(html.indexOf('/digest/2026-10-27'));
    expect(html).not.toContain('notes.txt');
  });

  it('keeps the empty board and baseline status fields', async () => {
    const beat = { at: '2026-10-30T09:00:00+01:00', pid: 123, laneId: 'lane-07' };
    vi.spyOn(heartbeat, 'lastBeat').mockReturnValue(beat);
    expect(readStatus(config)).toEqual({
      adapter: config.adapter, installed: config.installed, lastBeat: beat, nights: [], nightCounts: {},
    });
    const res = await createApp(config).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing in runs/');
    expect(html).toContain('<th>adapter</th><td>shim</td>');
    expect(html).toContain(`<th>installed</th><td>${config.installed}</td>`);
    expect(html).toContain(`${beat.at} · pid ${beat.pid}`);
    expect(html).not.toContain('href="/digest/');
  });

  it('shows zero counts for an empty night and none for a missing heartbeat', async () => {
    writeFileSync(join(dir, '2026-10-28.jsonl'), '');
    vi.spyOn(heartbeat, 'lastBeat').mockReturnValue(null);
    const html = await (await createApp(config).request('/')).text();
    expect(html).toContain('validated log events: ok 0 / retry 0 / fail 0');
    expect(html).toContain('<span class="warn">none</span>');
  });

  it('renders unavailable counts when a listed file disappears before reading', async () => {
    writeFileSync(join(dir, '2026-10-28.jsonl'), '');
    vi.spyOn(reader, 'readNight').mockImplementationOnce((runsDir, night) => {
      rmSync(join(runsDir, `${night}.jsonl`));
      return reader.readNight(runsDir, night);
    });
    const res = await createApp(config).request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<a href="/digest/2026-10-28">2026-10-28</a> · validated log events: —');
  });

  it('allows a missing runs directory but propagates other filesystem errors', () => {
    expect(readStatus({ ...config, runsDir: join(dir, 'missing') }).nights).toEqual([]);
    const file = join(dir, 'not-a-directory');
    writeFileSync(file, '');
    expect(() => readStatus({ ...config, runsDir: file })).toThrow();
    mkdirSync(join(dir, '2026-10-28.jsonl'));
    expect(() => readStatus(config)).toThrow();
  });
});
