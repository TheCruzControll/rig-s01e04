import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readNight } from '../src/digest/reader.js';
import type { DigestRow } from '../src/digest/types.js';

const night = '2026-10-28';
const firstAt = '2026-10-28T01:00:00+01:00';
const lastAt = '2026-10-28T02:00:00+01:00';

describe('digest routes', () => {
  let runsDir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
    app = createApp({ adapter: 'shim', installed: '', beatEverySeconds: 60, runsDir });
  });
  afterEach(() => { rmSync(runsDir, { recursive: true, force: true }); });

  const writeNight = (text: string) => writeFileSync(join(runsDir, `${night}.jsonl`), text);
  const requestBoth = () => Promise.all([
    app.request(`/digest/${night}`),
    app.request(`/api/digest/${night}`),
  ]);

  it('serves the exact shared rows in job order with matching HTML fields and warnings', async () => {
    writeNight([
      { at: firstAt, job: 'zebra', owner: 'rook', status: 'retry' },
      { at: lastAt, job: 'alpha', owner: null, status: 'ok' },
      { at: firstAt, job: 'zebra', owner: 'rook', status: 'retry' },
      { at: firstAt, job: 'zebra', owner: 'rook', status: 'retry' },
      { at: lastAt, job: 'zebra', owner: 'rook', status: 'fail', error: 'disk full' },
      { at: firstAt, job: 'middle', owner: 'rook', status: 'retry' },
      { at: lastAt, job: 'middle', owner: 'rook', status: 'retry' },
    ].map(event => JSON.stringify(event)).join('\n'));

    const [page, api] = await requestBoth();
    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(api.headers.get('content-type')).toContain('application/json');
    const rows: DigestRow[] = await api.json();
    expect(rows).toEqual([
      { job: 'alpha', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstAt: lastAt, lastAt },
      { job: 'middle', owner: 'rook', runs: 2, retries: 2, lastStatus: 'retry', lastError: null, firstAt, lastAt },
      { job: 'zebra', owner: 'rook', runs: 4, retries: 3, lastStatus: 'fail', lastError: 'disk full', firstAt, lastAt },
    ]);
    expect(rows).toEqual(readNight(runsDir, night)?.rows);

    const html = await page.text();
    const tableRows = [...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)]
      .flatMap(match => [...match[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)])
      .map(match => [...match[1].matchAll(/<(?:th|td)\b[^>]*>(.*?)<\/(?:th|td)>/g)]
        .map(cell => cell[1]));
    expect(tableRows).toEqual(rows.map(row => [
      row.job, row.owner ?? '—', String(row.runs),
      `${row.retries}${row.retries >= 3 ? ' (high retries)' : ''}`,
      row.lastStatus, row.lastError ?? '—', row.firstAt, row.lastAt,
    ]));
    expect(html).toContain('<td class="warn">3 (high retries)</td>');
    expect(html).toContain('<td class="warn">fail</td>');
    expect(html).toContain('<td>2</td><td>retry</td>');
    expect(html.match(/class="warn"/g)).toHaveLength(2);
  });

  it('returns 404 from both routes when the night has no file', async () => {
    const responses = await requestBoth();
    expect(responses.map(response => response.status)).toEqual([404, 404]);
  });

  it('renders nothing ran and returns no rows for an empty night', async () => {
    writeNight('');
    const [page, api] = await requestBoth();
    expect([page.status, api.status]).toEqual([200, 200]);
    const html = await page.text();
    expect(html).toContain('nothing ran');
    expect(html).toContain('bad lines: 0');
    expect(html).not.toContain('<table>');
    expect(await api.json()).toEqual([]);
  });

  it('counts malformed lines while retaining the valid row in both routes', async () => {
    writeNight([
      '{broken',
      JSON.stringify({ at: firstAt, job: 'survivor', owner: null, status: 'ok' }),
      JSON.stringify({ job: 'invalid shape' }),
      '',
    ].join('\n'));
    const [page, api] = await requestBoth();
    expect([page.status, api.status]).toEqual([200, 200]);
    const html = await page.text();
    expect(html).toContain('bad lines: 2');
    expect(html).toContain('<th scope="row">survivor</th><td>—</td>');
    expect(html).not.toContain('nothing ran');
    expect(await api.json()).toEqual([
      { job: 'survivor', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstAt, lastAt: firstAt },
    ]);
  });
});
