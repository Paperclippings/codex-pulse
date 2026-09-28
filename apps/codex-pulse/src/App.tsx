import { BridgethingClient } from '@bridgething/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { daemonUrl } from './daemon';
import './pulse.css';

type UsageWindow = { usedPercent: number; windowDurationMins: number; resetsAt: number } | null;
type Thread = { id: string; title: string; updatedAt: number; state: 'running' | 'idle'; needsYou?: boolean };
type TokenDay = { day: string; inputTokens: number; cachedInputTokens?: number; outputTokens: number; totalTokens: number };
type Snapshot = {
  type: 'snapshot';
  fetchedAt: number;
  threads: Thread[];
  needsYouThreads?: Thread[];
  usage: { primary: UsageWindow; secondary: UsageWindow; error?: string };
  tokenDays?: TokenDay[];
  attention: number | null;
  error?: string;
};

const demo: Snapshot = {
  type: 'snapshot',
  fetchedAt: Date.now(),
  threads: [
    { id: '1', title: 'Build a Car Thing dashboard', updatedAt: Date.now(), state: 'running' },
    { id: '2', title: 'Review checkout flow', updatedAt: Date.now() - 7 * 60_000, state: 'idle', needsYou: true },
    { id: '3', title: 'Plan September launch', updatedAt: Date.now() - 20 * 60_000, state: 'idle' },
  ],
  needsYouThreads: [{ id: '2', title: 'Review checkout flow', updatedAt: Date.now() - 7 * 60_000, state: 'idle', needsYou: true }],
  usage: {
    primary: { usedPercent: 37, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 7200 },
    secondary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 172800 },
  },
  tokenDays: [2, 1, 0].map((offset, index) => {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    return { day: date.toLocaleDateString('en-CA'), inputTokens: [69000, 92000, 108000][index], cachedInputTokens: [58000, 81000, 97000][index], outputTokens: [11000, 18000, 24000][index], totalTokens: [80000, 110000, 132000][index] };
  }),
  attention: 1,
};

function windowLabel(value: UsageWindow, fallback: string) {
  if (!value) return <div className="usage-card"><span>{fallback}</span><strong>—</strong><small>not reported</small></div>;
  const remaining = Math.max(0, Math.round(100 - value.usedPercent));
  const duration = value.windowDurationMins;
  const label = duration >= 10_080 ? 'WEEKLY' : duration >= 60 ? Math.round(duration / 60) + '-HOUR' : duration + '-MINUTE';
  return (
    <div className="usage-card">
      <span>{label}</span>
      <strong>{remaining}<em>%</em></strong>
      <div className="meter"><i style={{ width: remaining + '%' }} /></div>
      <small>resets {new Date(value.resetsAt * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</small>
    </div>
  );
}

export default function App() {
  const client = useMemo(() => new BridgethingClient({ url: daemonUrl() }), []);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(new URLSearchParams(location.search).has('demo') ? demo : null);
  const [connected, setConnected] = useState(false);
  const [screen, setScreen] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const offConnection = client.on(() => setConnected(client.connectionState === 'open'));
    const offForward = client.forward.onJson(message => {
      if (message && typeof message === 'object' && (message as Snapshot).type === 'snapshot') {
        setSnapshot(message as Snapshot);
      }
    });
    setConnected(client.connectionState === 'open');
    void client.forward.json({ type: 'refresh' }).catch(() => {});
    return () => { offConnection(); offForward(); };
  }, [client]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || !['1', '2', '3', '4'].includes(event.key)) return;
      setScreen(Number(event.key) - 1);
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const running = snapshot?.threads.filter(thread => thread.state === 'running') ?? [];
  const others = snapshot?.threads.filter(thread => thread.state !== 'running') ?? [];
  const rows = [...running, ...others].slice(0, 4);
  const waiting = snapshot?.needsYouThreads ?? snapshot?.threads.filter(thread => thread.needsYou) ?? [];
  const tokenDays = snapshot?.tokenDays ?? [];
  const today = tokenDays.at(-1);
  const maxTokens = Math.max(1, ...tokenDays.map(day => day.totalTokens));
  const compact = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}m` : value >= 1000 ? `${(value / 1000).toFixed(value >= 100_000 ? 0 : 1)}k` : String(value);
  const threadRow = (thread: Thread) => <div className="thread" key={thread.id}>
    <i className={thread.needsYou ? 'waiting' : thread.state} />
    <span>{thread.title}</span>
    <b className={thread.needsYou ? 'waiting' : ''}>{thread.needsYou ? 'NEEDS YOU' : thread.state === 'running' ? 'RUNNING' : 'IDLE'}</b>
  </div>;
  const scrollList = (event: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) event.currentTarget.scrollTop += event.deltaX;
  };
  const startSwipe = (event: React.TouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY };
  };
  const endSwipe = (event: React.TouchEvent<HTMLElement>) => {
    const start = touchStart.current;
    touchStart.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 55 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    setScreen(current => Math.max(0, Math.min(3, current + (deltaX < 0 ? 1 : -1))));
  };

  return (
    <main className="pulse" onTouchStart={startSwipe} onTouchEnd={endSwipe} onTouchCancel={() => { touchStart.current = null; }}>
      <header>
        <div className="brand">CODEX <span className="brand-light">PULSE</span></div>
        <nav aria-label="Pulse screens">{['OVERVIEW', 'LIMITS', 'CHATS', 'NEEDS YOU'].map((name, index) => <button key={name} className={screen === index ? 'selected' : ''} onClick={() => setScreen(index)} aria-label={`Screen ${index + 1}: ${name}`}><b>{index + 1}</b><span>{name}</span></button>)}</nav>
        <div className="connection"><i className={connected ? 'online' : ''} />{connected ? 'MAC CONNECTED' : 'WAITING FOR MAC'}</div>
      </header>
      {screen === 0 && <>
      <section className="summary">
        <div className="summary-main">
          <div className="eyebrow">AGENT ACTIVITY</div>
          <div className="hero"><strong>{running.length}</strong><span>RUNNING</span></div>
          <div className="attention">
            <span className="attention-dot" />
            <b>NEEDS YOU</b>
            <strong>{snapshot?.attention ?? '—'}</strong>
            <small>{snapshot?.attention === null || snapshot?.attention === undefined ? 'status unavailable' : 'unanswered prompts'}</small>
          </div>
        </div>
        <div className="usage">
          <div className="eyebrow">CODEX LIMITS <span>REMAINING</span></div>
          <div className="usage-grid">
            {windowLabel(snapshot?.usage.primary ?? null, 'USAGE WINDOW')}
          </div>
        </div>
      </section>
      <section className="threads">
        <div className="section-head"><span>RECENT TASKS</span><span>{snapshot ? new Date(snapshot.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'NO DATA'}</span></div>
        {rows.length ? rows.map(threadRow) : <div className="empty">{snapshot?.error ?? 'Connect BridgeThing Desktop to show Codex activity.'}</div>}
      </section>
      </>}
      {screen === 1 && <section className="screen-content limits-screen">
        <div className="screen-title"><div className="eyebrow">CODEX LIMITS</div><h1>Usage & limits</h1></div>
        <div className="limit-grid">{windowLabel(snapshot?.usage.primary ?? null, 'USAGE WINDOW')}{snapshot?.usage.secondary
          ? windowLabel(snapshot.usage.secondary, 'SECONDARY WINDOW')
          : <div className="usage-card"><span>TODAY · PROCESSED</span><strong>{compact(today?.totalTokens ?? 0)}</strong><small>{today?.cachedInputTokens === undefined ? 'cache breakdown unavailable' : `${compact(today.cachedInputTokens)} cached input`}</small></div>}</div>
        <div className="section-head token-heading"><span>RECORDED TOKENS · THIS MAC</span><span>PROCESSED TOTAL INCLUDES CACHE</span></div>
        <div className="token-days">{tokenDays.length ? tokenDays.map(day => {
          const cached = Math.max(0, Math.min(day.totalTokens, day.cachedInputTokens ?? 0));
          const other = Math.max(0, day.totalTokens - cached);
          return <div className="token-day" key={day.day}>
            <span>{new Date(`${day.day}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            <div className="token-bar"><i className="cached" style={{ width: `${cached / maxTokens * 100}%` }} /><i className="uncached" style={{ width: `${other / maxTokens * 100}%` }} /></div>
            <strong>{compact(day.totalTokens)}</strong>
            <small>{day.cachedInputTokens === undefined ? 'cache breakdown unavailable' : `cached input ${compact(cached)} · uncached input + output ${compact(other)}`}</small>
          </div>;
        }) : <div className="empty">Local token history unavailable.</div>}</div>
        <p className="hint">Local session counts include reused cached input. Limit percentages come from Codex.</p>
      </section>}
      {screen === 2 && <section className="screen-content">
        <div className="screen-title"><div className="eyebrow">RECENT TASKS</div><h1>Chats <span>{snapshot?.threads.length ?? 0} shown</span></h1></div>
        <div className="long-list" onWheel={scrollList}>{snapshot?.threads.length ? [...running, ...others].map(threadRow) : <div className="empty">{snapshot?.error ?? 'No recent chats reported.'}</div>}</div>
      </section>}
      {screen === 3 && <section className="screen-content">
        <div className="screen-title"><div className="eyebrow">ACTION QUEUE</div><h1>Needs you <span>{snapshot?.attention ?? '—'} waiting</span></h1></div>
        <div className="long-list" onWheel={scrollList}>{waiting.length ? waiting.map(threadRow) : <div className="empty">{snapshot?.attention == null ? 'Prompt status unavailable.' : 'Nothing needs your reply right now.'}</div>}</div>
      </section>}
      <footer><span>{screen + 1} / 4</span> {snapshot?.error ? 'Codex history retrying…' : 'Swipe ← → between screens'} <span>•</span> Presets 1–4 jump directly</footer>
    </main>
  );
}
