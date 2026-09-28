import { asJson, defineExtension, json } from '@bridgething/extension';

type Thread = { id: string; title: string; updatedAt: number; state: 'running' | 'idle'; needsYou: boolean };
type UsageWindow = { usedPercent: number; windowDurationMins: number; resetsAt: number } | null;
type TokenDay = { day: string; inputTokens: number; outputTokens: number; totalTokens: number };
type Snapshot = {
  type: 'snapshot';
  fetchedAt: number;
  threads: Thread[];
  needsYouThreads: Thread[];
  usage: { primary: UsageWindow; secondary: UsageWindow; error?: string };
  tokenDays: TokenDay[];
  attention: number | null;
  error?: string;
};

// Read the current Mac user's local Codex data.
const home = Deno.env.get('HOME');
if (!home) throw new Error('HOME is unavailable');
const codexRoot = `${home}/.codex`;
const codexBinary = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';

async function sqlite(path: string, query: string): Promise<Record<string, unknown>[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const output = await new Deno.Command('/usr/bin/sqlite3', {
        args: ['-readonly', '-json', path, query],
        stdout: 'piped',
        stderr: 'piped',
      }).output();
      if (!output.success) throw new Error(`${path}: ${new TextDecoder().decode(output.stderr).trim() || 'sqlite3 failed'}`);
      const body = new TextDecoder().decode(output.stdout).trim();
      return body ? JSON.parse(body) as Record<string, unknown>[] : [];
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  return [];
}

async function readThreads(): Promise<{ threads: Thread[]; needsYouThreads: Thread[]; attention: number }> {
  const [rows, turns, questions] = await Promise.all([
    sqlite(codexRoot + '/state_5.sqlite', "SELECT id, COALESCE(NULLIF(name, ''), NULLIF(title, ''), 'Untitled') AS title, updated_at AS updatedAt FROM threads WHERE archived = 0 AND thread_source = 'user' ORDER BY updated_at DESC LIMIT 1000"),
    sqlite(codexRoot + '/thread_history_1.sqlite', "SELECT t.thread_id AS id, t.status FROM thread_turns t JOIN (SELECT thread_id, MAX(rollout_ordinal) AS last_ordinal FROM thread_turns GROUP BY thread_id) latest ON latest.thread_id = t.thread_id AND latest.last_ordinal = t.rollout_ordinal"),
    sqlite(codexRoot + '/thread_history_1.sqlite', "SELECT q.thread_id AS id FROM thread_items q WHERE q.item_type = 'agentMessage' AND json_array_length(json_extract(q.item_json, '$.questions')) > 0 AND q.created_at_ms > COALESCE((SELECT MAX(u.created_at_ms) FROM thread_items u WHERE u.thread_id = q.thread_id AND u.item_type = 'userMessage'), 0) GROUP BY q.thread_id"),
  ]);
  const activeIds = new Set(rows.map(row => String(row.id)));
  const waitingIds = new Set(questions.map(row => String(row.id)));
  const stateById = new Map(turns.map(row => [String(row.id), String(row.status)]));
  const toThread = (row: Record<string, unknown>): Thread => ({
    id: String(row.id),
    title: String(row.title),
    updatedAt: Number(row.updatedAt),
    state: stateById.get(String(row.id)) === 'inProgress' ? 'running' : 'idle',
    needsYou: waitingIds.has(String(row.id)),
  });
  const threads = rows.slice(0, 12).map(toThread);
  const needsYouThreads = rows.filter(row => waitingIds.has(String(row.id))).slice(0, 30).map(toThread);
  return { threads, needsYouThreads, attention: [...waitingIds].filter(id => activeIds.has(id)).length };
}

const tokenFileCache = new Map<string, { modified: number; size: number; records: { timestamp: string; input: number; output: number; total: number }[] }>();

async function tokenRecords(path: string) {
  const stat = await Deno.stat(path);
  const cached = tokenFileCache.get(path);
  const modified = stat.mtime?.getTime() ?? 0;
  if (cached?.modified === modified && cached.size === stat.size) return cached.records;
  const records: { timestamp: string; input: number; output: number; total: number }[] = [];
  const file = await Deno.open(path, { read: true });
  try {
    const reader = file.readable.pipeThrough(new TextDecoderStream()).getReader();
    let pending = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += value;
      let end: number;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (!line.includes('"type":"token_usage_record"')) continue;
        try {
          const record = JSON.parse(line) as { timestamp: string; payload?: { usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } } };
          const usage = record.payload?.usage;
          if (usage && Number.isFinite(usage.total_tokens)) records.push({
            timestamp: record.timestamp,
            input: usage.input_tokens ?? 0,
            output: usage.output_tokens ?? 0,
            total: usage.total_tokens ?? 0,
          });
        } catch { /* ignore incomplete rollout lines */ }
      }
    }
  } finally { try { file.close(); } catch { /* readable closes the file */ } }
  tokenFileCache.set(path, { modified, size: stat.size, records });
  return records;
}

async function readTokenDays(): Promise<TokenDay[]> {
  const days = Array.from({ length: 3 }, (_, offset) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    return date.toLocaleDateString('en-CA');
  }).reverse();
  const totals = new Map(days.map(day => [day, { day, inputTokens: 0, outputTokens: 0, totalTokens: 0 }]));
  const utcDates = new Set<string>();
  for (let offset = 0; offset < 5; offset++) {
    const date = new Date(Date.now() - offset * 86_400_000);
    utcDates.add(`${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`);
  }
  for (const date of utcDates) {
    const directory = `${codexRoot}/sessions/${date}`;
    try {
      for await (const entry of Deno.readDir(directory)) {
        if (!entry.isFile || !entry.name.endsWith('.jsonl')) continue;
        for (const record of await tokenRecords(`${directory}/${entry.name}`)) {
          const day = new Date(record.timestamp).toLocaleDateString('en-CA');
          const total = totals.get(day);
          if (!total) continue;
          total.inputTokens += record.input;
          total.outputTokens += record.output;
          total.totalTokens += record.total;
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  return days.map(day => totals.get(day)!);
}

function parseWindow(value: unknown): UsageWindow {
  if (!value || typeof value !== 'object') return null;
  const window = value as Record<string, unknown>;
  if (typeof window.usedPercent !== 'number') return null;
  return {
    usedPercent: window.usedPercent,
    windowDurationMins: Number(window.windowDurationMins),
    resetsAt: Number(window.resetsAt),
  };
}

async function readUsage(): Promise<Snapshot['usage']> {
  const child = new Deno.Command(codexBinary, {
    args: ['app-server', '--stdio'],
    stdin: 'piped', stdout: 'piped', stderr: 'null',
  }).spawn();
  const writer = child.stdin.getWriter();
  const requests = [
    { method: 'initialize', id: 1, params: { clientInfo: { name: 'codex-pulse', title: 'Codex Pulse', version: '0.1.0' } } },
    { method: 'initialized', params: {} },
    { method: 'account/rateLimits/read', id: 2 },
  ];
  await writer.write(new TextEncoder().encode(requests.map(value => JSON.stringify(value)).join('\n') + '\n'));
  const reader = child.stdout.getReader();
  let pending = '';
  try {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const read = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Codex usage request timed out')), Math.max(1, deadline - Date.now()))),
      ]);
      if (read.done) break;
      pending += new TextDecoder().decode(read.value);
      while (pending.includes('\n')) {
        const index = pending.indexOf('\n');
        const line = pending.slice(0, index);
        pending = pending.slice(index + 1);
        if (!line.trim()) continue;
        let message: Record<string, unknown>;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id !== 2) continue;
        if (message.error) throw new Error(JSON.stringify(message.error));
        const result = message.result as Record<string, unknown>;
        const byId = result.rateLimitsByLimitId as Record<string, Record<string, unknown>> | undefined;
        const limits = byId?.codex ?? result.rateLimits as Record<string, unknown> | undefined;
        return { primary: parseWindow(limits?.primary), secondary: parseWindow(limits?.secondary) };
      }
    }
    throw new Error('Codex usage response unavailable');
  } finally {
    try { child.kill(); } catch { /* already exited */ }
    try { await writer.close(); } catch { /* already exited */ }
  }
}

let timer: number | undefined;
defineExtension({
  start(ctx) {
    let latest: Snapshot | undefined;
    let updating = false;
    async function update() {
      if (updating) return;
      updating = true;
      try {
        const [threads, usage, tokenDays] = await Promise.allSettled([readThreads(), readUsage(), readTokenDays()]);
        latest = {
          type: 'snapshot', fetchedAt: Date.now(),
          threads: threads.status === 'fulfilled' ? threads.value.threads : [],
          needsYouThreads: threads.status === 'fulfilled' ? threads.value.needsYouThreads : [],
          usage: usage.status === 'fulfilled' ? usage.value : { primary: null, secondary: null, error: String(usage.reason) },
          tokenDays: tokenDays.status === 'fulfilled' ? tokenDays.value : [],
          // Pending prompts are inferred from local, unanswered question items.
          attention: threads.status === 'fulfilled' ? threads.value.attention : null,
          error: threads.status === 'rejected' ? String(threads.reason) : undefined,
        };
        ctx.broadcast(json(latest));
      } finally {
        updating = false;
      }
    }
    ctx.on('device', event => {
      if (event.type !== 'connected' && event.type !== 'active') return;
      if (latest) event.device.send(json(latest));
      void update();
    });
    ctx.on('message', (device, message) => {
      const payload = asJson<{ type?: string }>(message);
      if (payload?.type === 'refresh') {
        if (latest) device.send(json(latest));
        void update();
      }
    });
    timer = setInterval(() => void update(), 60_000);
    void update();
    ctx.log.info('Codex Pulse started');
  },
  stop() {
    clearInterval(timer);
  },
});
