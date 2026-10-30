import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  owner: string | null;
  status: DigestRow['lastStatus'];
  error?: string;
};

function isRunEvent(value: unknown): value is RunEvent {
  if (typeof value !== 'object' || value === null) return false;
  if (!('at' in value) || typeof value.at !== 'string') return false;
  const at = value.at;
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(at)) return false;
  if (at !== at.trim() || !Number.isFinite(Date.parse(at))) return false;
  // Date.parse normalizes impossible dates such as February 30.
  if (new Date(at.slice(0, 10)).toISOString().slice(0, 10) !== at.slice(0, 10)) return false;
  return 'job' in value && typeof value.job === 'string' && value.job.trim().length > 0
    && 'owner' in value && (value.owner === null || typeof value.owner === 'string')
    && 'status' in value && (value.status === 'ok' || value.status === 'retry' || value.status === 'fail')
    && (!('error' in value) || typeof value.error === 'string');
}

export const readNight: ReadNight = (runsDir, night) => {
  if (night.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const events: RunEvent[] = [];
  let badLines = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      badLines++;
      continue;
    }
    if (isRunEvent(value)) events.push(value);
    else badLines++;
  }

  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const rows = new Map<string, DigestRow>();
  const counts = { ok: 0, retry: 0, fail: 0 };
  for (const event of events) {
    counts[event.status]++;
    let row = rows.get(event.job);
    if (!row) {
      row = {
        job: event.job, owner: event.owner, runs: 0, retries: 0,
        lastStatus: event.status, lastError: null, firstAt: event.at, lastAt: event.at,
      };
      rows.set(event.job, row);
    }
    row.runs++;
    if (event.status === 'retry') row.retries++;
    row.owner = event.owner;
    row.lastStatus = event.status;
    if (event.error !== undefined) row.lastError = event.error;
    row.lastAt = event.at;
  }
  return {
    rows: [...rows.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0),
    badLines,
    counts,
  };
};
