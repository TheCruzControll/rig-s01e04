export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: 'ok' | 'retry' | 'fail';
  lastError: string | null;
  // Preserve the log's original timestamp offsets.
  firstAt: string;
  lastAt: string;
};

export type DigestNight = {
  rows: DigestRow[];
  badLines: number;
  // Count valid log events, not just each job's final status.
  counts: { ok: number; retry: number; fail: number };
};

/** Synchronous readNight contract: null means missing; an empty file yields empty rows. */
export type ReadNight = (runsDir: string, night: string) => DigestNight | null;
