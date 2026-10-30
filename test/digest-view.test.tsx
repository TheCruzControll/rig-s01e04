import { describe, expect, it } from 'vitest';
import type { DigestNight } from '../src/digest/types.js';
import { DigestPage } from '../src/views/digest.js';

const row = {
  job: 'backup', owner: null, runs: 4, retries: 3, lastStatus: 'fail' as const,
  lastError: '<disk full> & retry failed',
  firstAt: '2026-10-28T01:00:00+05:30', lastAt: '2026-10-28T02:00:00-04:00',
};

function render(digest: DigestNight) {
  return (<DigestPage night="2026-10-28" digest={digest} />).toString();
}

describe('digest view', () => {
  it('shows every field, preserves offsets/order and marks retry/fail states without truncation', () => {
    const longError = row.lastError.repeat(30);
    const html = render({
      rows: [{ ...row, lastError: longError }, {
        ...row, job: 'cleanup', owner: 'rook', runs: 1, retries: 2,
        lastStatus: 'ok', lastError: null,
      }],
      badLines: 1, counts: { ok: 1, retry: 3, fail: 1 },
    });
    for (const heading of ['job', 'owner', 'runs', 'retries', 'last status', 'last error', 'first at', 'last at']) {
      expect(html).toContain(`<th scope="col">${heading}</th>`);
    }
    expect(html).toContain('<th scope="row">backup</th><td>—</td><td>4</td>');
    expect(html).toContain('<td class="warn">3 (high retries)</td>');
    expect(html).toContain('<td class="warn">fail</td>');
    expect(html).toContain('<td>rook</td><td>1</td><td>2</td><td>ok</td><td>—</td>');
    expect(html).toContain('&lt;disk full&gt; &amp; retry failed'.repeat(30));
    expect(html).toContain(row.firstAt);
    expect(html).toContain(row.lastAt);
    expect(html).toContain('bad lines: 1');
    expect(html).toContain('role="region" aria-label="Job digest; scroll horizontally for all columns" tabindex="0"');
    expect(html.indexOf('scope="row">backup')).toBeLessThan(html.indexOf('scope="row">cleanup'));
  });

  it('renders an empty night with its bad-line count', () => {
    const html = render({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
    expect(html).toContain('nothing ran');
    expect(html).toContain('bad lines: 0');
    expect(html).not.toContain('<table>');
  });
});
