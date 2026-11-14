import { useEffect, useMemo, useState } from "react";
import { api, fmt } from "../api";
import { LineChart, Legend } from "../components/Charts";
import { Markdown, Thinking, toast } from "../components/Bits";
import { CAUSE_LABELS } from "../../shared/types";
import type { SessionDetail, SessionSummary, Settings, StutterCause } from "../../shared/types";

export function Sessions({ settings, onAsk }: { settings: Settings; onAsk: (q: string) => void }) {
  const [list, setList] = useState<SessionSummary[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    api.listSessions().then((l) => {
      setList(l);
      if (l.length) setSel(l[0].id);
    });
  }, []);
  useEffect(() => {
    if (sel) api.getSession(sel).then(setDetail);
  }, [sel]);

  const analyze = async () => {
    if (!detail) return;
    setAnalyzing(true);
    try {
      const text = await api.analyzeSession(detail.id);
      setDetail({ ...detail, analysis: text });
      setList((l) => l?.map((s) => (s.id === detail.id ? { ...s, analysis: text } : s)) ?? l);
    } catch (e: any) {
      toast(e?.message ?? "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const remove = async () => {
    if (!detail) return;
    await api.deleteSession(detail.id);
    const l = (list ?? []).filter((s) => s.id !== detail.id);
    setList(l);
    setDetail(null);
    setSel(l[0]?.id ?? null);
  };

  if (list && !list.length)
    return (
      <div className="page">
        <h1>Sessions</h1>
        <section className="panel empty">
          <h2>No sessions yet</h2>
          <p>Play a game for at least 30 seconds and its FPS, frame times and stutters show up here.</p>
        </section>
      </div>
    );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Sessions</h1>
          <p className="sub">Every game you play, second by second.</p>
        </div>
      </div>
      <div className="sessions">
        <section className="panel" style={{ padding: 8 }} role="listbox" aria-label="Sessions">
          {list?.map((s) => (
            <button key={s.id} className="session-item" role="option" aria-selected={s.id === sel} onClick={() => setSel(s.id)}>
              <span className="g">{s.game}</span>
              <span className="m">
                <span>{fmt.when(s.start)}</span>
                <span>{fmt.dur(s.end - s.start)}</span>
                {s.avgFps != null && <span>{s.avgFps} FPS</span>}
              </span>
            </button>
          ))}
        </section>
        {detail && <Detail s={detail} analyzing={analyzing} canAnalyze={settings.aiReady} onAnalyze={analyze} onDelete={remove} onAsk={onAsk} />}
      </div>
    </div>
  );
}

function Detail({ s, analyzing, canAnalyze, onAnalyze, onDelete, onAsk }: { s: SessionDetail; analyzing: boolean; canAnalyze: boolean; onAnalyze: () => void; onDelete: () => void; onAsk: (q: string) => void }) {
  // Downsample to ~400 points so long sessions stay fast to draw.
  const data = useMemo(() => {
    const step = Math.max(1, Math.ceil(s.points.length / 400));
    const pts = [];
    for (let i = 0; i < s.points.length; i += step) {
      const c = s.points.slice(i, i + step);
      const avg = (k: "fps" | "cpu" | "gpu" | "low1") => {
        const v = c.map((p) => p[k]).filter((x): x is number => x != null);
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
      };
      pts.push({ sec: (c[0].t - s.start) / 1000, fps: avg("fps"), low1: avg("low1"), cpu: avg("cpu"), gpu: avg("gpu") });
    }
    return pts;
  }, [s]);
  const times = data.map((d) => d.sec);
  const markers = s.stutterEvents.map((e) => ({ sec: (e.t - s.start) / 1000, label: `${e.frametimeMs} ms, ${e.cause ? CAUSE_LABELS[e.cause].toLowerCase() : "hitch"}${e.why ? `: ${e.why}` : ""}` }));
  const causes = (Object.entries(s.causes ?? {}) as [StutterCause, number][]).sort((a, b) => b[1] - a[1]);
  const maxCause = causes[0]?.[1] ?? 1;
  const hasFps = s.avgFps != null;
  const smooth = s.avgFps != null && s.low1 != null ? s.low1 / s.avgFps : null;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2 style={{ fontSize: 22 }}>{s.game}</h2>
            <p className="sub small">{fmt.when(s.start)}, {fmt.dur(s.end - s.start)}</p>
          </div>
          <button className="btn ghost sm" onClick={onDelete}>Delete session</button>
        </div>
        {s.anomaly && <div className="notice" style={{ marginBottom: 14 }}>{s.anomaly}</div>}
        <div className="stats">
          <Stat k="Average FPS" v={s.avgFps ?? "–"} />
          <Stat k="1% low" v={s.low1 ?? "–"} tone={smooth != null && smooth < 0.5 ? "warn" : undefined} />
          <Stat k="Stutters" v={s.stutters} tone={s.stutters > 20 ? "warn" : undefined} />
          <Stat k="Hottest CPU" v={s.maxCpuTemp != null ? `${s.maxCpuTemp}°` : "–"} tone={(s.maxCpuTemp ?? 0) >= 90 ? "crit" : undefined} />
          <Stat k="Hottest GPU" v={s.maxGpuTemp != null ? `${s.maxGpuTemp}°` : "–"} tone={(s.maxGpuTemp ?? 0) >= 85 ? "crit" : undefined} />
        </div>
        {(s.pingAvg != null || s.energyWh != null || s.driver) && (
          <p className="muted small" style={{ margin: "12px 0 0" }}>
            {[s.pingAvg != null ? `Ping ${s.pingAvg} ms` : null, s.energyWh ? `Used ${(s.energyWh / 1000).toFixed(2)} kWh` : null, s.driver ? `GPU driver ${s.driver}` : null].filter(Boolean).join(". ")}
          </p>
        )}
      </section>

      {hasFps && (
        <section className="panel">
          <div className="panel-head">
            <h2>Frame rate</h2>
            <Legend items={[{ name: "FPS", color: "var(--ink)" }, { name: "1% low", color: "var(--muted)" }, { name: "Stutter", color: "var(--warn)", marker: true }]} />
          </div>
          <div style={{ paddingBottom: 20 }}>
            <LineChart
              label="Frame rate over the session"
              times={times}
              series={[
                { name: "FPS", color: "var(--ink)", values: data.map((d) => d.fps), unit: "" },
                { name: "1% low", color: "var(--muted)", values: data.map((d) => d.low1), unit: "" },
              ]}
              markers={markers}
            />
          </div>
        </section>
      )}

      {causes.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>What caused the stutters</h2>
            <span className="muted small">{s.stutters} total</span>
          </div>
          {causes.map(([c, n]) => (
            <div key={c} className="cause-row">
              <span>{CAUSE_LABELS[c]}</span>
              <span className="track"><span className="fill" style={{ display: "block", width: `${(n / maxCause) * 100}%` }} /></span>
              <span className="n">{n}</span>
            </div>
          ))}
        </section>
      )}

      <Snapshots s={s} />

      <section className="panel">
        <div className="panel-head">
          <h2>CPU and GPU load</h2>
          <Legend items={[{ name: "CPU", color: "var(--cpu)" }, { name: "GPU", color: "var(--gpu)" }]} />
        </div>
        <div style={{ paddingBottom: 20 }}>
          <LineChart
            label="CPU and GPU load over the session"
            times={times}
            max={100}
            height={170}
            series={[
              { name: "CPU", color: "var(--cpu)", values: data.map((d) => d.cpu), unit: "%" },
              { name: "GPU", color: "var(--gpu)", values: data.map((d) => d.gpu), unit: "%" },
            ]}
            markers={markers}
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>What Rigmind found</h2>
          <div className="row">
            {s.analysis && <button className="btn sm" onClick={() => onAsk(`About my ${s.game} session (id ${s.id}): `)}>Ask a follow-up</button>}
            <button className="btn sm" disabled={!canAnalyze || analyzing} onClick={onAnalyze}>{s.analysis ? "Analyze again" : "Analyze session"}</button>
          </div>
        </div>
        {analyzing ? <Thinking /> : s.analysis ? <Markdown text={s.analysis} /> : <p className="muted" style={{ margin: 0 }}>{canAnalyze ? "Rigmind will look at every stutter and what else was happening on your PC at that moment." : "Set up an AI engine in Settings to get an explanation of this session."}</p>}
      </section>
    </div>
  );
}

function Stat({ k, v, tone }: { k: string; v: string | number; tone?: "warn" | "crit" }) {
  return (
    <div className="stat">
      <div className="v" style={tone ? { color: `var(--${tone})` } : undefined}>{v}</div>
      <div className="k">{k}</div>
    </div>
  );
}

function Snapshots({ s }: { s: SessionDetail }) {
  const withSnap = s.stutterEvents.filter((e) => e.snapshot);
  const [imgs, setImgs] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<string, string | null> = {};
      for (const e of withSnap.slice(0, 12)) out[e.snapshot!] = await api.getSnapshot(s.id, e.snapshot!);
      if (alive) setImgs(out);
    })();
    return () => {
      alive = false;
    };
  }, [s.id]);
  if (!withSnap.length) return null;
  return (
    <section className="panel">
      <div className="panel-head"><h2>What was on screen</h2><span className="muted small">Screenshots taken at big stutters</span></div>
      <div className="snaps">
        {withSnap.slice(0, 12).map((e) => (
          <figure key={e.snapshot}>
            {imgs[e.snapshot!] ? <img src={imgs[e.snapshot!]!} alt={`Screen at ${e.frametimeMs} ms stutter`} /> : <div className="snap-ph" />}
            <figcaption>{Math.floor((e.t - s.start) / 60000)}:{String(Math.floor(((e.t - s.start) / 1000) % 60)).padStart(2, "0")}, {e.frametimeMs} ms{e.cause ? `, ${CAUSE_LABELS[e.cause].toLowerCase()}` : ""}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
