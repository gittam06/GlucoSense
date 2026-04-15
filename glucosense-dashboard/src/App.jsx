import { useState, useEffect, useRef, useCallback, useMemo } from "react";

const MAX_HISTORY = 30;

// ─── IndexedDB (unchanged) ─────────────────────────────────
const DB_NAME = "GlucoSenseDB", DB_VER = 2;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("patients")) db.createObjectStore("patients", { keyPath: "id" });
      if (!db.objectStoreNames.contains("readings")) {
        const s = db.createObjectStore("readings", { keyPath: "id", autoIncrement: true });
        s.createIndex("patientId", "patientId", { unique: false });
      }
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function dbAll(st) { const db = await openDB(); return new Promise((r, j) => { const q = db.transaction(st, "readonly").objectStore(st).getAll(); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); }); }
async function dbPut(st, d) { const db = await openDB(); return new Promise((r, j) => { const q = db.transaction(st, "readwrite").objectStore(st).put(d); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); }); }
async function dbDel(st, k) { const db = await openDB(); return new Promise((r, j) => { const q = db.transaction(st, "readwrite").objectStore(st).delete(k); q.onsuccess = () => r(); q.onerror = () => j(q.error); }); }
async function dbIdx(st, ix, v) { const db = await openDB(); return new Promise((r, j) => { const q = db.transaction(st, "readonly").objectStore(st).index(ix).getAll(v); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); }); }

// ─── Helpers (unchanged) ──────────────────────────────────
const ACTIVITIES = [
  { id: "fasting", label: "Fasting", icon: "🌅", color: "#8b5cf6" },
  { id: "before_breakfast", label: "Before breakfast", icon: "🍳", color: "#f59e0b" },
  { id: "after_breakfast", label: "After breakfast", icon: "☀️", color: "#f97316" },
  { id: "before_lunch", label: "Before lunch", icon: "🥗", color: "#10b981" },
  { id: "after_lunch", label: "After lunch", icon: "🍛", color: "#06b6d4" },
  { id: "before_dinner", label: "Before dinner", icon: "🌙", color: "#3b82f6" },
  { id: "after_dinner", label: "After dinner", icon: "🍽️", color: "#6366f1" },
  { id: "after_exercise", label: "After exercise", icon: "🏃", color: "#ec4899" },
  { id: "random", label: "Random", icon: "🕐", color: "#64748b" },
];

const MEAL_PAIRS = [
  { before: "before_breakfast", after: "after_breakfast", label: "Breakfast", icon: "🍳" },
  { before: "before_lunch", after: "after_lunch", label: "Lunch", icon: "🥗" },
  { before: "before_dinner", after: "after_dinner", label: "Dinner", icon: "🌙" },
];

const glucoseZone = (val) => {
  if (val < 70) return { label: "Low", color: "#f59e0b" };
  if (val <= 140) return { label: "Normal", color: "#10b981" };
  if (val <= 200) return { label: "Elevated", color: "#f97316" };
  return { label: "High", color: "#ef4444" };
};

const calcEA1c = (avg) => (avg + 46.7) / 28.7;
const a1cZone = (a) => {
  if (a < 5.7) return { label: "Normal", color: "#10b981" };
  if (a < 6.5) return { label: "Pre-diabetic", color: "#f59e0b" };
  return { label: "Diabetic range", color: "#ef4444" };
};

const fmt = (ms) => !ms ? "--:--" : new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtDate = (ts) => new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
const fmtFull = (ts) => new Date(ts).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const toDS = (ts) => new Date(ts).toISOString().slice(0, 10);
const ago = (ms) => { if (!ms) return ""; const s = Math.floor((Date.now() - ms) / 1000); if (s < 5) return "just now"; if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s / 60)}m ago`; return `${Math.floor(s / 3600)}h ago`; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function useWindowSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => { const fn = () => setSize({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener("resize", fn); return () => window.removeEventListener("resize", fn); }, []);
  return size;
}

// ─── Sparkline (unchanged) ─────────────────────────────────
function Sparkline({ data, color, width = 100, height = 28 }) {
  if (data.length < 2) return null;
  const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - mn) / rng) * (height - 4) - 2}`).join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block", marginTop: 4 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
      <circle cx={width} cy={height - ((data[data.length - 1] - mn) / rng) * (height - 4) - 2} r="2" fill={color} />
    </svg>
  );
}

// ─── Gauge (unchanged) ─────────────────────────────────────
function Gauge({ value, size }) {
  const z = glucoseZone(value);
  const c = Math.max(40, Math.min(300, value));
  const a = ((c - 40) / 260) * 240 - 120;
  const r = size * 0.36, cx = size / 2, cy = size / 2 + 8;
  const arc = (s, e) => { const rd = (x) => ((x - 90) * Math.PI) / 180; return `M ${cx + r * Math.cos(rd(s))} ${cy + r * Math.sin(rd(s))} A ${r} ${r} 0 ${e - s > 180 ? 1 : 0} 1 ${cx + r * Math.cos(rd(e))} ${cy + r * Math.sin(rd(e))}`; };
  const nr = ((a - 90) * Math.PI) / 180, nl = r - 14;
  const fs = Math.max(18, size * 0.13);
  return (
    <svg width="100%" viewBox={`0 0 ${size} ${size}`}>
      <path d={arc(-120, 120)} fill="none" stroke="#1e293b" strokeWidth="11" strokeLinecap="round" />
      <path d={arc(-120, -51)} fill="none" stroke="#f59e0b" strokeWidth="11" strokeLinecap="round" opacity="0.45" />
      <path d={arc(-51, 72)} fill="none" stroke="#10b981" strokeWidth="11" strokeLinecap="round" opacity="0.45" />
      <path d={arc(72, 96)} fill="none" stroke="#f97316" strokeWidth="11" strokeLinecap="round" opacity="0.45" />
      <path d={arc(96, 120)} fill="none" stroke="#ef4444" strokeWidth="11" strokeLinecap="round" opacity="0.45" />
      <line x1={cx} y1={cy} x2={cx + nl * Math.cos(nr)} y2={cy + nl * Math.sin(nr)} stroke={z.color} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="5" fill={z.color} /><circle cx={cx} cy={cy} r="2" fill="#0f172a" />
      <text x={cx} y={cy + fs * 1.1} textAnchor="middle" fill="#e2e8f0" fontSize={fs} fontWeight="700" fontFamily="'JetBrains Mono',monospace">{value > 0 ? value.toFixed(0) : "---"}</text>
      <text x={cx} y={cy + fs * 1.1 + 15} textAnchor="middle" fill="#64748b" fontSize="10" fontFamily="'JetBrains Mono',monospace">mg/dL</text>
      <rect x={cx - 26} y={cy + fs * 1.1 + 22} width="52" height="17" rx="4" fill={z.color} opacity="0.15" />
      <text x={cx} y={cy + fs * 1.1 + 34} textAnchor="middle" fill={z.color} fontSize="9" fontWeight="600">{value > 0 ? z.label : "IDLE"}</text>
    </svg>
  );
}

// ─── Vital Card (unchanged) ────────────────────────────────
function Card({ label, value, unit, icon, color, hist, small }) {
  const p = small ? "10px 12px" : "14px 16px"; const vs = small ? 20 : 28; const ls = small ? 9 : 11;
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: p, display: "flex", flexDirection: "column", gap: small ? 2 : 4, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: -16, right: -16, width: 56, height: 56, borderRadius: "50%", background: color, opacity: 0.04 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: small ? 12 : 14 }}>{icon}</span>
        <span style={{ color: "#94a3b8", fontSize: ls, fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
        <span style={{ color: "#f1f5f9", fontSize: vs, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{value > 0 ? (Number.isInteger(value) ? value : value.toFixed(1)) : "---"}</span>
        <span style={{ color: "#64748b", fontSize: small ? 9 : 11, fontFamily: "'JetBrains Mono',monospace" }}>{unit}</span>
      </div>
      {hist && hist.length > 1 && <Sparkline data={hist} color={color} width={small ? 70 : 96} height={small ? 20 : 26} />}
    </div>
  );
}

// ─── Chart (unchanged) ─────────────────────────────────────
function Chart({ readings, height, showActivity }) {
  if (readings.length < 2) return (
    <div style={{ width: "100%", height, display: "flex", alignItems: "center", justifyContent: "center", color: "#334155", fontSize: 12, fontFamily: "'JetBrains Mono',monospace", border: "1px dashed #1e293b", borderRadius: 8 }}>Waiting for readings...</div>
  );
  const W = 600, P = { t: 14, r: 14, b: 24, l: 40 };
  const w = W - P.l - P.r, h = height - P.t - P.b;
  const vals = readings.map(r => r.glucose); const lo = Math.max(40, Math.min(...vals) - 10), hi = Math.max(...vals) + 10;
  const xS = i => P.l + (i / (readings.length - 1)) * w; const yS = v => P.t + h - ((v - lo) / (hi - lo)) * h;
  const ln = readings.map((r, i) => `${i ? "L" : "M"} ${xS(i)} ${yS(r.glucose)}`).join(" ");
  const ar = ln + ` L ${xS(readings.length - 1)} ${P.t + h} L ${xS(0)} ${P.t + h} Z`;
  const zy = v => Math.max(P.t, Math.min(P.t + h, yS(v)));
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${height}`} style={{ display: "block" }}>
      <rect x={P.l} y={zy(300)} width={w} height={zy(200) - zy(300)} fill="#ef4444" opacity="0.04" />
      <rect x={P.l} y={zy(200)} width={w} height={zy(140) - zy(200)} fill="#f97316" opacity="0.04" />
      <rect x={P.l} y={zy(140)} width={w} height={zy(70) - zy(140)} fill="#10b981" opacity="0.05" />
      <rect x={P.l} y={zy(70)} width={w} height={zy(40) - zy(70)} fill="#f59e0b" opacity="0.04" />
      {[70, 100, 140, 200].filter(v => v >= lo && v <= hi).map(v => (
        <g key={v}><line x1={P.l} y1={yS(v)} x2={P.l + w} y2={yS(v)} stroke="#1e293b" strokeDasharray="3 3" />
        <text x={P.l - 4} y={yS(v) + 3} textAnchor="end" fill="#475569" fontSize="9" fontFamily="'JetBrains Mono',monospace">{v}</text></g>
      ))}
      <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#06b6d4" stopOpacity="0.2" /><stop offset="100%" stopColor="#06b6d4" stopOpacity="0" /></linearGradient></defs>
      <path d={ar} fill="url(#ag)" />
      <path d={ln} fill="none" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {readings.map((r, i) => { const act = showActivity && ACTIVITIES.find(a => a.id === r.activity); return <circle key={i} cx={xS(i)} cy={yS(r.glucose)} r="3" fill={act ? act.color : "#0f172a"} stroke={act ? act.color : glucoseZone(r.glucose).color} strokeWidth="1.5" />; })}
      {readings.filter((_, i) => i % Math.max(1, Math.floor(readings.length / 5)) === 0).map(r => (
        <text key={readings.indexOf(r)} x={xS(readings.indexOf(r))} y={height - 3} textAnchor="middle" fill="#475569" fontSize="8" fontFamily="'JetBrains Mono',monospace">{showActivity ? fmtDate(r.timestamp) : fmt(r.timestamp)}</text>
      ))}
    </svg>
  );
}

// ─── Status Badge (unchanged) ──────────────────────────────
function Status({ s }) {
  const m = { connected: { c: "#10b981", l: "Live" }, connecting: { c: "#f59e0b", l: "Connecting..." }, disconnected: { c: "#ef4444", l: "Offline" } }[s] || { c: "#ef4444", l: "Offline" };
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 14, background: "#0f172a", border: `1px solid ${m.c}30` }}>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: m.c, boxShadow: s === "connected" ? `0 0 6px ${m.c}` : "none" }} />
      <span style={{ color: m.c, fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono',monospace" }}>{m.l}</span>
    </div>
  );
}

// ─── HbA1c Card (unchanged) ────────────────────────────────
function HbA1cCard({ readings, compact }) {
  if (readings.length < 5) return (
    <div style={{ ...crd, padding: compact ? 10 : 14 }}><div style={lbl}>Estimated HbA1c</div>
      <div style={{ color: "#475569", fontSize: 11, marginTop: 6, fontFamily: "'JetBrains Mono',monospace" }}>Need 5+ readings. Currently: {readings.length}.</div></div>
  );
  const avg = readings.reduce((s, r) => s + r.glucose, 0) / readings.length;
  const eA1c = calcEA1c(avg); const zone = a1cZone(eA1c);
  const days = Math.max(1, Math.ceil((Date.now() - readings[0].timestamp) / 86400000));
  return (
    <div style={{ ...crd, padding: compact ? 10 : 16, borderColor: zone.color + "40" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={lbl}>Estimated HbA1c (eA1c)</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 6 }}>
            <span style={{ fontSize: compact ? 28 : 36, fontWeight: 700, color: zone.color, fontFamily: "'JetBrains Mono',monospace" }}>{eA1c.toFixed(1)}</span>
            <span style={{ fontSize: 14, color: "#64748b", fontFamily: "'JetBrains Mono',monospace" }}>%</span>
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 4, padding: "3px 8px", borderRadius: 10, background: zone.color + "15", border: `1px solid ${zone.color}30` }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: zone.color }} /><span style={{ color: zone.color, fontSize: 10, fontWeight: 600 }}>{zone.label}</span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: "#64748b", fontSize: 10, fontFamily: "'JetBrains Mono',monospace" }}>Based on</div>
          <div style={{ color: "#94a3b8", fontSize: 14, fontWeight: 600, fontFamily: "'JetBrains Mono',monospace" }}>{readings.length} readings</div>
          <div style={{ color: "#64748b", fontSize: 10, fontFamily: "'JetBrains Mono',monospace" }}>over {days} day{days > 1 ? "s" : ""}</div>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden" }}>
          <div style={{ flex: 5.7, background: "#10b981" }} /><div style={{ flex: 0.8, background: "#f59e0b" }} /><div style={{ flex: 3.5, background: "#ef4444" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
          {["4.0%", "5.7%", "6.5%", "10%"].map(t => <span key={t} style={{ fontSize: 8, color: "#64748b", fontFamily: "'JetBrains Mono',monospace" }}>{t}</span>)}
        </div>
        <div style={{ position: "relative", height: 8 }}>
          <div style={{ position: "absolute", left: `${Math.min(95, Math.max(2, ((eA1c - 4) / 6) * 100))}%`, transform: "translateX(-50%)" }}>
            <div style={{ width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderBottom: `6px solid ${zone.color}` }} />
          </div>
        </div>
      </div>
      <div style={{ color: "#475569", fontSize: 9, marginTop: 8, lineHeight: 1.5, fontFamily: "'JetBrains Mono',monospace" }}>
        eA1c = (avg glucose + 46.7) / 28.7 · Avg: {avg.toFixed(0)} mg/dL<br />Same formula as Dexcom & Libre · ⚠ ±0.6% margin vs lab test
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  NEW: Time-in-Range Donut
// ═══════════════════════════════════════════════════════════
function TimeInRange({ readings, size = 140 }) {
  if (readings.length < 3) return null;
  const low = readings.filter(r => r.glucose < 70).length;
  const normal = readings.filter(r => r.glucose >= 70 && r.glucose <= 140).length;
  const elevated = readings.filter(r => r.glucose > 140 && r.glucose <= 200).length;
  const high = readings.filter(r => r.glucose > 200).length;
  const total = readings.length;
  const segments = [
    { pct: normal / total, color: "#10b981", label: "Normal" },
    { pct: elevated / total, color: "#f97316", label: "Elevated" },
    { pct: high / total, color: "#ef4444", label: "High" },
    { pct: low / total, color: "#f59e0b", label: "Low" },
  ].filter(s => s.pct > 0);

  const r = size * 0.38, cx = size / 2, cy = size / 2, sw = 14;
  let cumAngle = -90;

  return (
    <div style={{ textAlign: "center" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e293b" strokeWidth={sw} />
        {segments.map((seg, i) => {
          const angle = seg.pct * 360;
          const startRad = (cumAngle * Math.PI) / 180;
          const endRad = ((cumAngle + angle) * Math.PI) / 180;
          const largeArc = angle > 180 ? 1 : 0;
          const x1 = cx + r * Math.cos(startRad), y1 = cy + r * Math.sin(startRad);
          const x2 = cx + r * Math.cos(endRad), y2 = cy + r * Math.sin(endRad);
          cumAngle += angle;
          return <path key={i} d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`} fill="none" stroke={seg.color} strokeWidth={sw} strokeLinecap="round" />;
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="#e2e8f0" fontSize="20" fontWeight="700" fontFamily="'JetBrains Mono',monospace">{((normal / total) * 100).toFixed(0)}%</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="'JetBrains Mono',monospace">in range</text>
      </svg>
      <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
        {segments.map(s => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: s.color }} />
            <span style={{ fontSize: 9, color: "#94a3b8", fontFamily: "'JetBrains Mono',monospace" }}>{s.label} {(s.pct * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  NEW: Meal Comparison (Before vs After)
// ═══════════════════════════════════════════════════════════
function MealComparison({ readings, compact }) {
  const pairs = MEAL_PAIRS.map(mp => {
    const before = readings.filter(r => r.activity === mp.before);
    const after = readings.filter(r => r.activity === mp.after);
    if (before.length === 0 && after.length === 0) return null;
    const avgB = before.length ? before.reduce((s, r) => s + r.glucose, 0) / before.length : 0;
    const avgA = after.length ? after.reduce((s, r) => s + r.glucose, 0) / after.length : 0;
    const spike = avgB > 0 && avgA > 0 ? avgA - avgB : null;
    return { ...mp, avgB, avgA, spike, countB: before.length, countA: after.length };
  }).filter(Boolean);

  if (pairs.length === 0) return (
    <div style={{ ...crd, padding: 14, textAlign: "center", color: "#475569", fontSize: 11, fontFamily: "'JetBrains Mono',monospace" }}>
      Record "before" and "after" meal readings to see comparisons
    </div>
  );

  const maxVal = Math.max(...pairs.flatMap(p => [p.avgB, p.avgA].filter(v => v > 0)), 180);

  return (
    <div style={crd}>
      <div style={lbl}>Before vs after meals</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 10 }}>
        {pairs.map(p => (
          <div key={p.label}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 14 }}>{p.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{p.label}</span>
              {p.spike !== null && (
                <span style={{ fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono',monospace", color: p.spike > 40 ? "#ef4444" : p.spike > 20 ? "#f97316" : "#10b981", marginLeft: "auto" }}>
                  {p.spike > 0 ? "+" : ""}{p.spike.toFixed(0)} mg/dL
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {/* Before bar */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: "#64748b", marginBottom: 2, fontFamily: "'JetBrains Mono',monospace" }}>Before ({p.countB})</div>
                <div style={{ background: "#1e293b", borderRadius: 4, height: 22, position: "relative", overflow: "hidden" }}>
                  {p.avgB > 0 && (
                    <div style={{ width: `${(p.avgB / maxVal) * 100}%`, height: "100%", background: "linear-gradient(90deg, #3b82f6, #60a5fa)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", fontFamily: "'JetBrains Mono',monospace" }}>{p.avgB.toFixed(0)}</span>
                    </div>
                  )}
                </div>
              </div>
              {/* After bar */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: "#64748b", marginBottom: 2, fontFamily: "'JetBrains Mono',monospace" }}>After ({p.countA})</div>
                <div style={{ background: "#1e293b", borderRadius: 4, height: 22, position: "relative", overflow: "hidden" }}>
                  {p.avgA > 0 && (
                    <div style={{ width: `${(p.avgA / maxVal) * 100}%`, height: "100%", background: p.spike !== null && p.spike > 40 ? "linear-gradient(90deg, #ef4444, #f87171)" : "linear-gradient(90deg, #f97316, #fb923c)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", fontFamily: "'JetBrains Mono',monospace" }}>{p.avgA.toFixed(0)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {p.spike !== null && p.spike > 40 && (
              <div style={{ fontSize: 9, color: "#ef4444", marginTop: 4, fontFamily: "'JetBrains Mono',monospace" }}>
                ⚠ Spike of {p.spike.toFixed(0)} mg/dL exceeds recommended 40 mg/dL post-meal rise
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 8, color: "#475569", marginTop: 10, fontFamily: "'JetBrains Mono',monospace" }}>
        Healthy post-meal spike: under 40 mg/dL · ADA target: under 180 mg/dL after meals
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  NEW: Activity Breakdown
// ═══════════════════════════════════════════════════════════
function ActivityBreakdown({ readings }) {
  const groups = ACTIVITIES.map(a => {
    const rs = readings.filter(r => r.activity === a.id);
    if (rs.length === 0) return null;
    const avg = rs.reduce((s, r) => s + r.glucose, 0) / rs.length;
    return { ...a, count: rs.length, avg };
  }).filter(Boolean);

  if (groups.length === 0) return null;

  return (
    <div style={crd}>
      <div style={lbl}>Average by activity</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
        {groups.sort((a, b) => b.avg - a.avg).map(g => {
          const z = glucoseZone(g.avg);
          return (
            <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, width: 20, textAlign: "center" }}>{g.icon}</span>
              <span style={{ fontSize: 10, color: "#94a3b8", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.label}</span>
              <span style={{ fontSize: 10, color: "#64748b", fontFamily: "'JetBrains Mono',monospace" }}>{g.count}x</span>
              <div style={{ width: 60, height: 6, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, (g.avg / 200) * 100)}%`, height: "100%", background: z.color, borderRadius: 3 }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: z.color, fontFamily: "'JetBrains Mono',monospace", minWidth: 32, textAlign: "right" }}>{g.avg.toFixed(0)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  NEW: Glucose Variability Stats (for HbA1c page)
// ═══════════════════════════════════════════════════════════
function VariabilityStats({ readings }) {
  if (readings.length < 5) return null;
  const vals = readings.map(r => r.glucose);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const std = Math.sqrt(vals.reduce((s, v) => s + (v - avg) ** 2, 0) / vals.length);
  const cv = (std / avg) * 100;
  const gmi = calcEA1c(avg);

  const cvZone = cv < 36 ? { label: "Stable", color: "#10b981" } : { label: "Unstable", color: "#f59e0b" };

  // Daily averages for trend
  const dailyMap = {};
  readings.forEach(r => {
    const day = toDS(r.timestamp);
    if (!dailyMap[day]) dailyMap[day] = [];
    dailyMap[day].push(r.glucose);
  });
  const dailyAvgs = Object.entries(dailyMap).sort().map(([day, vals]) => ({
    day, avg: vals.reduce((a, b) => a + b, 0) / vals.length
  }));

  return (
    <div style={crd}>
      <div style={lbl}>Glucose variability</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
        <div style={{ background: "#020617", borderRadius: 8, padding: 10, textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#06b6d4", fontFamily: "'JetBrains Mono',monospace" }}>{std.toFixed(1)}</div>
          <div style={{ fontSize: 8, color: "#64748b" }}>Std Dev (mg/dL)</div>
        </div>
        <div style={{ background: "#020617", borderRadius: 8, padding: 10, textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: cvZone.color, fontFamily: "'JetBrains Mono',monospace" }}>{cv.toFixed(1)}%</div>
          <div style={{ fontSize: 8, color: "#64748b" }}>CV ({cvZone.label})</div>
        </div>
        <div style={{ background: "#020617", borderRadius: 8, padding: 10, textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: a1cZone(gmi).color, fontFamily: "'JetBrains Mono',monospace" }}>{gmi.toFixed(1)}%</div>
          <div style={{ fontSize: 8, color: "#64748b" }}>GMI</div>
        </div>
      </div>
      <div style={{ fontSize: 9, color: "#475569", marginTop: 8, lineHeight: 1.5, fontFamily: "'JetBrains Mono',monospace" }}>
        CV (Coefficient of Variation) under 36% = stable glucose · GMI = Glucose Management Indicator (same as eA1c)
      </div>
      {dailyAvgs.length >= 2 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, marginBottom: 4 }}>Daily average trend</div>
          <Sparkline data={dailyAvgs.map(d => d.avg)} color="#8b5cf6" width={250} height={40} />
        </div>
      )}
    </div>
  );
}

// ─── Shared styles (unchanged) ─────────────────────────────
const crd = { background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: 16 };
const lbl = { color: "#94a3b8", fontSize: 11, fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 4 };
const inp = { background: "#020617", border: "1px solid #334155", borderRadius: 7, padding: "8px 12px", color: "#e2e8f0", fontFamily: "'JetBrains Mono',monospace", fontSize: 12, outline: "none", width: "100%" };
const btn = (c = "#06b6d4") => ({ background: c, border: "none", borderRadius: 7, color: "#fff", padding: "8px 16px", cursor: "pointer", fontWeight: 600, fontSize: 12, fontFamily: "'JetBrains Mono',monospace" });
const btnO = (c = "#06b6d4") => ({ background: "transparent", border: `1px solid ${c}`, borderRadius: 7, color: c, padding: "7px 15px", cursor: "pointer", fontWeight: 600, fontSize: 12, fontFamily: "'JetBrains Mono',monospace" });

// ════════════════════════════════════════════════════════════
//  MAIN APP
// ════════════════════════════════════════════════════════════
export default function App() {
  const { w: ww } = useWindowSize();
  const mob = ww < 580; const tab = ww >= 580 && ww < 900;

  const [wsUrl, setWsUrl] = useState("ws://192.168.1.16:81");
  const [st, setSt] = useState("disconnected");
  const [liveReadings, setLiveReadings] = useState([]);
  const [latest, setLatest] = useState({ glucose: 0, heartRate: 0, spO2: 0, ratio: 0, variability: 0, timestamp: 0 });
  const [ev, setEv] = useState("");
  const ws = useRef(null); const rc = useRef(null);
  const [, tick] = useState(0);

  const [page, setPage] = useState("scan");
  const [patients, setPatients] = useState([]);
  const [activePat, setActivePat] = useState(null);
  const [savedReadings, setSavedReadings] = useState([]);
  const [activity, setActivity] = useState("random");
  const activityRef = useRef("random");
  useEffect(() => { activityRef.current = activity; }, [activity]);
  const [notes, setNotes] = useState("");
  const [scanning, setScanning] = useState(false);
  const [pendingReading, setPendingReading] = useState(null);
  const [showAddPat, setShowAddPat] = useState(false);
  const [newName, setNewName] = useState(""); const [newAge, setNewAge] = useState("");
  const [newGender, setNewGender] = useState("1"); const [newWeight, setNewWeight] = useState(""); const [newHeight, setNewHeight] = useState("");
  const [histView, setHistView] = useState("list");
  const [dateFrom, setDateFrom] = useState(""); const [dateTo, setDateTo] = useState("");
  const [setup, setSetup] = useState(false);

  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 5000); return () => clearInterval(t); }, []);

  useEffect(() => {
    (async () => {
      const p = await dbAll("patients"); setPatients(p);
      const s = localStorage.getItem("gs_ap");
      if (s && p.find(x => x.id === s)) setActivePat(s); else if (p.length) setActivePat(p[0].id);
      const u = localStorage.getItem("gs_ws"); if (u) setWsUrl(u);
    })();
  }, []);

  useEffect(() => {
    if (!activePat) { setSavedReadings([]); return; }
    localStorage.setItem("gs_ap", activePat);
    (async () => { const r = await dbIdx("readings", "patientId", activePat); setSavedReadings(r.sort((a, b) => a.timestamp - b.timestamp)); })();
  }, [activePat]);

  const connectRef = useRef(null);

  const connect = useCallback(() => {
    // Clear any pending reconnect
    if (rc.current) { clearTimeout(rc.current); rc.current = null; }
    // Detach and close old socket so its onclose won't trigger reconnect
    if (ws.current) {
      ws.current.onopen = null;
      ws.current.onclose = null;
      ws.current.onmessage = null;
      ws.current.onerror = null;
      ws.current.close();
      ws.current = null;
    }
    setSt("connecting"); localStorage.setItem("gs_ws", wsUrl);
    try {
      const s = new WebSocket(wsUrl); ws.current = s;
      s.onopen = () => { setSt("connected"); setEv("Connected"); };
      s.onmessage = (e) => { try { const d = JSON.parse(e.data); if (d.type === "reading") { d.timestamp = Date.now(); setLatest(d); setLiveReadings(p => [...p.slice(-MAX_HISTORY + 1), d]); setEv(""); const tempEntry = { id: uid(), patientId: "temp", timestamp: d.timestamp, glucose: d.glucose, heartRate: d.heartRate || 0, spO2: d.spO2 || 0, ratio: d.ratio || 0, variability: d.variability || 0, activity: d.activity || activityRef.current || "random", notes: "Auto-simulator" }; setSavedReadings(prev => [...prev, tempEntry].sort((a, b) => a.timestamp - b.timestamp)); setScanning(false); setPendingReading(null); } else if (d.type === "event") setEv(d.message); } catch {} };
      s.onclose = () => {
        setSt("disconnected");
        rc.current = setTimeout(() => { if (connectRef.current) connectRef.current(); }, 5000);
      };
      s.onerror = () => s.close();
    } catch { setSt("disconnected"); }
  }, [wsUrl]);

  // Keep connectRef in sync so onclose always calls the latest version
  useEffect(() => { connectRef.current = connect; }, [connect]);


  useEffect(() => () => {
    if (rc.current) { clearTimeout(rc.current); rc.current = null; }
    if (ws.current) {
      ws.current.onopen = null;
      ws.current.onclose = null;
      ws.current.onmessage = null;
      ws.current.onerror = null;
      ws.current.close();
      ws.current = null;
    }
  }, []);

  const addPatient = async () => {
    if (!newName.trim()) return;
    const h = parseFloat(newHeight);
    const w = parseFloat(newWeight);
    let bmi = 0;
    if (h > 0 && w > 0) bmi = +(w / ((h / 100) ** 2)).toFixed(1);
    const p = { id: uid(), name: newName.trim(), age: newAge || "", gender: newGender, weight: newWeight, height: newHeight, bmi, createdAt: Date.now() };
    await dbPut("patients", p); setPatients(prev => [...prev, p]); setActivePat(p.id);
    setNewName(""); setNewAge(""); setNewGender("1"); setNewWeight(""); setNewHeight(""); setShowAddPat(false);
  };

  const deletePat = async (id) => {
    if (!confirm("Delete patient and all readings?")) return;
    await dbDel("patients", id); const r = await dbIdx("readings", "patientId", id);
    for (const x of r) await dbDel("readings", x.id);
    setPatients(prev => prev.filter(p => p.id !== id));
    if (activePat === id) { const rem = patients.filter(p => p.id !== id); setActivePat(rem.length ? rem[0].id : null); }
  };

  const startScan = () => {
    if (!activePat) { alert("Add a patient first"); return; }
    if (st !== "connected") { alert("Connect to ESP32 simulator or real hardware in Settings first"); return; }
    
    const p = patients.find(x => x.id === activePat);
    if (p && ws.current) {
        ws.current.send(JSON.stringify({
            type: "setContext",
            age: parseInt(p.age) || 40,
            gender: parseInt(p.gender) || 1,
            bmi: parseFloat(p.bmi) || 24.5,
            weight: parseFloat(p.weight) || 70,
            height: parseFloat(p.height) || 170
        }));
    }
    
    setScanning(true); setPendingReading(null);
  };

  const saveReading = async () => {
    if (!pendingReading || !activePat) return;
    const entry = { patientId: activePat, timestamp: Date.now(), glucose: pendingReading.glucose, heartRate: pendingReading.heartRate || 0, spO2: pendingReading.spO2 || 0, ratio: pendingReading.ratio || 0, variability: pendingReading.variability || 0, activity, notes: notes.trim() };
    const id = await dbPut("readings", entry); entry.id = id;
    setSavedReadings(prev => [...prev, entry].sort((a, b) => a.timestamp - b.timestamp));
    setPendingReading(null); setNotes("");
  };

  const delReading = async (id) => { await dbDel("readings", id); setSavedReadings(prev => prev.filter(r => r.id !== id)); };

  const filtered = useMemo(() => {
    let r = savedReadings;
    if (dateFrom) { const ts = new Date(dateFrom).setHours(0, 0, 0, 0); r = r.filter(x => x.timestamp >= ts); }
    if (dateTo) { const ts = new Date(dateTo).setHours(23, 59, 59, 999); r = r.filter(x => x.timestamp <= ts); }
    return r;
  }, [savedReadings, dateFrom, dateTo]);

  const stats = useMemo(() => {
    if (!filtered.length) return null;
    const v = filtered.map(r => r.glucose);
    const avg = v.reduce((a, b) => a + b, 0) / v.length;
    const inR = v.filter(x => x >= 70 && x <= 140).length;
    const eA1c = calcEA1c(avg);
    return { avg, min: Math.min(...v), max: Math.max(...v), count: v.length, pctIR: ((inR / v.length) * 100).toFixed(0), eA1c, a1cZ: a1cZone(eA1c) };
  }, [filtered]);

  const activePatData = patients.find(p => p.id === activePat);
  const stColor = { connected: "#10b981", connecting: "#f59e0b", disconnected: "#ef4444" }[st] || "#ef4444";
  const pad = mob ? "8px" : tab ? "14px" : "20px"; const gap = mob ? 8 : 12;

  const NAV = [
    { id: "scan", icon: "🩸", label: "Scan" },
    { id: "history", icon: "📋", label: "History" },
    { id: "hba1c", icon: "🧬", label: "HbA1c" },
    { id: "patients", icon: "👥", label: "Patients" },
    { id: "settings", icon: "⚙️", label: "Settings" },
  ];

  return (
    <div style={{ width: "100%", height: "100vh", maxHeight: "100dvh", background: "#020617", color: "#e2e8f0", fontFamily: "'Outfit',system-ui,sans-serif", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Outfit:wght@300;400;500;600;700&display=swap');
        @keyframes fadeIn { from { opacity:0; transform:translateY(5px) } to { opacity:1; transform:translateY(0) } }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:.4} }
        button:active { transform:scale(0.97) } input:focus { border-color:#06b6d4!important }`}</style>

      {/* Header (unchanged) */}
      <header style={{ padding: mob ? "8px 10px" : "10px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #1e293b", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: "linear-gradient(135deg,#06b6d4,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>🩸</div>
          <div><div style={{ fontSize: mob ? 14 : 17, fontWeight: 700, lineHeight: 1.1 }}>GlucoSense</div><div style={{ color: "#475569", fontSize: 8, fontFamily: "'JetBrains Mono',monospace" }}>ESP32 + MAX30105</div></div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {activePatData && <div style={{ background: "#1e293b", padding: "3px 8px", borderRadius: 10, fontSize: 9, fontFamily: "'JetBrains Mono',monospace", color: "#94a3b8" }}>👤 {activePatData.name}</div>}
          <Status s={st} />
        </div>
      </header>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: pad }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", gap }}>

          {/* ══════ SCAN PAGE (unchanged) ══════ */}
          {page === "scan" && (
            <>
              {!activePat ? (
                <div style={{ ...crd, textAlign: "center", padding: 28 }}><div style={{ fontSize: 28, marginBottom: 6 }}>👤</div><div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 12 }}>Add a patient to start scanning</div><button onClick={() => setPage("patients")} style={btn()}>Add patient</button></div>
              ) : (
                <>
                  <div style={crd}><div style={lbl}>Activity</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
                      {ACTIVITIES.map(a => (
                        <button key={a.id} onClick={() => setActivity(a.id)} style={{ padding: "5px 10px", borderRadius: 16, border: activity === a.id ? `2px solid ${a.color}` : "1px solid #334155", background: activity === a.id ? a.color + "18" : "transparent", color: activity === a.id ? a.color : "#94a3b8", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 3, fontWeight: activity === a.id ? 600 : 400 }}>
                          <span style={{ fontSize: 12 }}>{a.icon}</span>{mob ? "" : a.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ ...crd, display: "flex", flexDirection: mob ? "column" : "row", alignItems: "center", gap: 14, padding: 18 }}>
                    <div style={{ flexShrink: 0 }}><Gauge value={pendingReading ? pendingReading.glucose : latest.glucose} size={mob ? 160 : tab ? 170 : 196} />{latest.timestamp > 0 && <div style={{ color: "#64748b", fontSize: 9, fontFamily: "'JetBrains Mono',monospace", textAlign: "center", marginTop: 2 }}>{ago(latest.timestamp)}</div>}</div>
                    <div style={{ flex: 1, width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
                      {scanning ? (
                        <div style={{ textAlign: "center", padding: 14 }}><div style={{ fontSize: 26, animation: "pulse 1.5s infinite" }}>🫳</div><div style={{ color: "#7dd3fc", fontSize: 12, marginTop: 6, fontFamily: "'JetBrains Mono',monospace" }}>Place finger on sensor...</div></div>
                      ) : pendingReading ? (
                        <>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                            {[{ v: pendingReading.heartRate || "--", u: "BPM", c: "#f43f5e" }, { v: pendingReading.spO2 ? pendingReading.spO2.toFixed(1) : "--", u: "SpO2%", c: "#3b82f6" }, { v: pendingReading.ratio ? pendingReading.ratio.toFixed(3) : "--", u: "Ratio", c: "#8b5cf6" }].map(x => (
                              <div key={x.u} style={{ background: "#020617", borderRadius: 7, padding: 8, textAlign: "center" }}><div style={{ color: x.c, fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{x.v}</div><div style={{ color: "#64748b", fontSize: 8 }}>{x.u}</div></div>
                            ))}
                          </div>
                          <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)..." style={inp} />
                          <div style={{ display: "flex", gap: 6 }}><button onClick={saveReading} style={{ ...btn("#10b981"), flex: 1 }}>✓ Save reading</button><button onClick={() => setPendingReading(null)} style={btnO("#ef4444")}>✕</button></div>
                        </>
                      ) : (
                        <div style={{ textAlign: "center", padding: 14 }}><button onClick={startScan} style={{ ...btn(), fontSize: 14, padding: "12px 30px", borderRadius: 22, background: "linear-gradient(135deg,#06b6d4,#0891b2)" }}>Start scan</button><div style={{ color: "#475569", fontSize: 9, marginTop: 6, fontFamily: "'JetBrains Mono',monospace" }}>{st === "connected" ? "Place finger then tap scan" : "Connect in Settings first"}</div></div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: mob ? 6 : 8 }}>
                    <Card label="Heart Rate" value={latest.heartRate} unit="bpm" icon="💓" color="#f43f5e" hist={liveReadings.map(r => r.heartRate)} small={mob} />
                    <Card label="SpO₂" value={latest.spO2} unit="%" icon="🫁" color="#3b82f6" hist={liveReadings.map(r => r.spO2)} small={mob} />
                    <Card label="R Ratio" value={latest.ratio} unit="" icon="📊" color="#8b5cf6" hist={liveReadings.map(r => r.ratio)} small={mob} />
                    <Card label="Saved" value={savedReadings.length} unit="total" icon="📋" color="#06b6d4" small={mob} />
                  </div>
                  {stats && (
                    <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr 1fr" : "1fr 1fr 1fr 1fr 1fr", gap: 6 }}>
                      {[{ l: "Average", v: stats.avg.toFixed(0), u: "mg/dL", c: "#06b6d4" }, { l: "eA1c", v: stats.eA1c.toFixed(1), u: "%", c: stats.a1cZ.color }, { l: "In range", v: stats.pctIR, u: "%", c: "#10b981" }, ...(mob ? [] : [{ l: "Range", v: `${stats.min}–${stats.max}`, u: "", c: "#f59e0b" }, { l: "Readings", v: stats.count, u: "", c: "#8b5cf6" }])].map(s => (
                        <div key={s.l} style={{ ...crd, padding: 8, textAlign: "center" }}><div style={{ color: s.c, fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{s.v}<span style={{ fontSize: 9, color: "#64748b" }}> {s.u}</span></div><div style={{ color: "#64748b", fontSize: 8 }}>{s.l}</div></div>
                      ))}
                    </div>
                  )}
                  {liveReadings.length >= 2 && (
                    <div style={{ ...crd, padding: mob ? "10px 8px" : "14px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}><span style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8" }}>Live trend</span>
                        <div style={{ display: "flex", gap: 8 }}>{[{ l: "Normal", c: "#10b981" }, { l: "High", c: "#f97316" }, { l: "Critical", c: "#ef4444" }].map(z => (<div key={z.l} style={{ display: "flex", alignItems: "center", gap: 3 }}><div style={{ width: 5, height: 5, borderRadius: 1, background: z.c, opacity: 0.7 }} /><span style={{ color: "#64748b", fontSize: 8, fontFamily: "'JetBrains Mono',monospace" }}>{z.l}</span></div>))}</div>
                      </div>
                      <Chart readings={liveReadings} height={mob ? 130 : tab ? 160 : 190} />
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ══════ HISTORY PAGE (UPGRADED) ══════ */}
          {page === "history" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                <h2 style={{ fontSize: 15, fontWeight: 600 }}>History</h2>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => setHistView("list")} style={{ ...btnO(histView === "list" ? "#06b6d4" : "#334155"), padding: "4px 10px", fontSize: 10 }}>List</button>
                  <button onClick={() => setHistView("graph")} style={{ ...btnO(histView === "graph" ? "#06b6d4" : "#334155"), padding: "4px 10px", fontSize: 10 }}>Graph</button>
                  <button onClick={() => setHistView("meals")} style={{ ...btnO(histView === "meals" ? "#06b6d4" : "#334155"), padding: "4px 10px", fontSize: 10 }}>Meals</button>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ color: "#64748b", fontSize: 10 }}>From</span>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...inp, width: "auto", padding: "4px 8px", fontSize: 11 }} />
                <span style={{ color: "#64748b", fontSize: 10 }}>To</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...inp, width: "auto", padding: "4px 8px", fontSize: 11 }} />
                {[{ l: "Today", d: 0 }, { l: "7D", d: 7 }, { l: "30D", d: 30 }, { l: "90D", d: 90 }, { l: "All", d: -1 }].map(q => (
                  <button key={q.l} onClick={() => { if (q.d === -1) { setDateFrom(""); setDateTo(""); } else { const n = new Date(); setDateTo(toDS(n)); setDateFrom(q.d === 0 ? toDS(n) : toDS(new Date(n.getTime() - q.d * 86400000))); } }} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid #334155", background: "transparent", color: "#64748b", fontSize: 9, cursor: "pointer", fontWeight: 600, fontFamily: "'JetBrains Mono',monospace" }}>{q.l}</button>
                ))}
              </div>

              {!filtered.length ? (
                <div style={{ ...crd, textAlign: "center", padding: 28, color: "#475569" }}>No readings in this range</div>
              ) : (
                <>
                  {/* UPGRADED: Stats + Donut side by side */}
                  <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr auto", gap: 10 }}>
                    {stats && (
                      <div style={{ ...crd, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: 12, alignContent: "center" }}>
                        {[
                          { l: "Average", v: stats.avg.toFixed(0) + " mg/dL", c: "#06b6d4" },
                          { l: "Range", v: `${stats.min}–${stats.max}`, c: "#f59e0b" },
                          { l: "eA1c", v: stats.eA1c.toFixed(1) + "%", c: stats.a1cZ.color },
                          { l: "In range", v: stats.pctIR + "%", c: "#10b981" },
                        ].map(s => (
                          <div key={s.l} style={{ textAlign: "center" }}>
                            <div style={{ color: s.c, fontSize: 18, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{s.v}</div>
                            <div style={{ color: "#64748b", fontSize: 9 }}>{s.l}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* NEW: Donut chart */}
                    <div style={{ ...crd, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
                      <TimeInRange readings={filtered} size={mob ? 120 : 140} />
                    </div>
                  </div>

                  {/* NEW: Activity breakdown */}
                  <ActivityBreakdown readings={filtered} />

                  {/* Graph view */}
                  {histView === "graph" && (
                    <div style={crd}>
                      <Chart readings={filtered} height={mob ? 180 : 240} showActivity />
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                        {ACTIVITIES.filter(a => filtered.some(r => r.activity === a.id)).map(a => (
                          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 3 }}><div style={{ width: 6, height: 6, borderRadius: "50%", background: a.color }} /><span style={{ color: "#64748b", fontSize: 8, fontFamily: "'JetBrains Mono',monospace" }}>{a.label}</span></div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* NEW: Meals comparison view */}
                  {histView === "meals" && <MealComparison readings={filtered} compact={mob} />}

                  {/* List view */}
                  {histView === "list" && [...filtered].reverse().map(r => {
                    const act = ACTIVITIES.find(a => a.id === r.activity); const z = glucoseZone(r.glucose);
                    return (
                      <div key={r.id} style={{ ...crd, padding: "9px 12px", display: "flex", alignItems: "center", gap: 8, animation: "fadeIn .2s ease-out" }}>
                        <div style={{ width: 3, height: 32, borderRadius: 2, background: z.color, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <span style={{ fontSize: 16, fontWeight: 700, color: z.color, fontFamily: "'JetBrains Mono',monospace" }}>{r.glucose.toFixed(0)}</span>
                            <span style={{ fontSize: 9, color: "#64748b", fontFamily: "'JetBrains Mono',monospace" }}>mg/dL</span>
                            {act && <span style={{ fontSize: 10 }}>{act.icon}</span>}
                            <span style={{ fontSize: 8, color: "#64748b", fontFamily: "'JetBrains Mono',monospace" }}>{act ? act.label : ""}</span>
                          </div>
                          <div style={{ fontSize: 8, color: "#475569", fontFamily: "'JetBrains Mono',monospace", marginTop: 1 }}>
                            {fmtFull(r.timestamp)}{r.heartRate > 0 && ` · ${r.heartRate}bpm`}{r.spO2 > 0 && ` · SpO2 ${r.spO2.toFixed(1)}%`}{r.notes && ` · ${r.notes}`}
                          </div>
                        </div>
                        <button onClick={() => delReading(r.id)} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 13, padding: 3 }}>×</button>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}

          {/* ══════ HBA1C PAGE (UPGRADED) ══════ */}
          {page === "hba1c" && (
            <>
              <h2 style={{ fontSize: 15, fontWeight: 600 }}>HbA1c Estimation</h2>
              {!activePat ? (
                <div style={{ ...crd, textAlign: "center", padding: 28, color: "#475569" }}>Select a patient first</div>
              ) : (
                <>
                  <HbA1cCard readings={savedReadings} compact={mob} />

                  {/* NEW: Variability stats */}
                  <VariabilityStats readings={savedReadings} />

                  {/* NEW: Meal impact on HbA1c */}
                  {savedReadings.length >= 5 && <MealComparison readings={savedReadings} compact={mob} />}

                  {savedReadings.length >= 5 && (
                    <div style={crd}>
                      <div style={lbl}>Reference ranges</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                        {[
                          { r: "Below 5.7%", l: "Normal", c: "#10b981", d: "No diabetes" },
                          { r: "5.7% – 6.4%", l: "Pre-diabetic", c: "#f59e0b", d: "Risk of developing diabetes" },
                          { r: "6.5% and above", l: "Diabetic", c: "#ef4444", d: "Diabetes diagnosis threshold" },
                        ].map(x => (
                          <div key={x.r} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, background: x.c + "08", border: `1px solid ${x.c}20` }}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: x.c, flexShrink: 0 }} />
                            <div><div style={{ fontSize: 11, fontWeight: 600, color: x.c }}>{x.r} — {x.l}</div><div style={{ fontSize: 9, color: "#64748b" }}>{x.d}</div></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {savedReadings.length >= 5 && (
                    <div style={crd}>
                      <div style={lbl}>What affects your eA1c</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, fontSize: 10, color: "#94a3b8", lineHeight: 1.6 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                          <span style={{ fontSize: 14, flexShrink: 0 }}>🍚</span>
                          <div><span style={{ fontWeight: 600, color: "#e2e8f0" }}>Post-meal spikes</span> — High-carb meals (rice, roti, sweets) cause the biggest glucose spikes. Track before/after meals to identify triggers.</div>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                          <span style={{ fontSize: 14, flexShrink: 0 }}>🏃</span>
                          <div><span style={{ fontWeight: 600, color: "#e2e8f0" }}>Exercise</span> — 30 min of walking after meals can reduce glucose spikes by 20-30 mg/dL.</div>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                          <span style={{ fontSize: 14, flexShrink: 0 }}>😴</span>
                          <div><span style={{ fontWeight: 600, color: "#e2e8f0" }}>Sleep</span> — Poor sleep increases insulin resistance. Fasting glucose is often higher after bad sleep.</div>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                          <span style={{ fontSize: 14, flexShrink: 0 }}>💧</span>
                          <div><span style={{ fontWeight: 600, color: "#e2e8f0" }}>Hydration</span> — Dehydration concentrates blood glucose. Drink water before scanning for consistent readings.</div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ══════ PATIENTS PAGE (unchanged) ══════ */}
          {page === "patients" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><h2 style={{ fontSize: 15, fontWeight: 600 }}>Patients</h2><button onClick={() => setShowAddPat(!showAddPat)} style={btn()}>+ Add</button></div>
              {showAddPat && (
                <div style={{ ...crd, animation: "fadeIn .2s ease-out" }}>
                  <div><div style={lbl}>Name *</div><input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Rahul Kumar" style={inp} onKeyDown={e => e.key === "Enter" && addPatient()} /></div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                    <div><div style={lbl}>Age</div><input type="number" value={newAge} onChange={e => setNewAge(e.target.value)} placeholder="45" style={inp} /></div>
                    <div><div style={lbl}>Gender</div><select value={newGender} onChange={e => setNewGender(e.target.value)} style={inp}><option value="1">Male</option><option value="0">Female</option></select></div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                    <div><div style={lbl}>Weight (kg)</div><input type="number" value={newWeight} onChange={e => setNewWeight(e.target.value)} placeholder="70" style={inp} /></div>
                    <div><div style={lbl}>Height (cm)</div><input type="number" value={newHeight} onChange={e => setNewHeight(e.target.value)} placeholder="175" style={inp} /></div>
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 10 }}><button onClick={addPatient} style={{ ...btn("#10b981"), flex: 1 }}>Save</button><button onClick={() => setShowAddPat(false)} style={btnO("#64748b")}>Cancel</button></div>
                </div>
              )}
              {!patients.length ? (<div style={{ ...crd, textAlign: "center", padding: 28, color: "#475569" }}>No patients yet</div>
              ) : patients.map(p => (
                <div key={p.id} onClick={() => setActivePat(p.id)} style={{ ...crd, padding: "10px 14px", cursor: "pointer", borderColor: p.id === activePat ? "#06b6d4" : "#1e293b", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: p.id === activePat ? "#06b6d420" : "#1e293b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>👤</div>
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div><div style={{ color: "#64748b", fontSize: 9, fontFamily: "'JetBrains Mono',monospace" }}>{p.age && `Age ${p.age} · `}{p.bmi > 0 && `BMI ${p.bmi} · `}{fmtDate(p.createdAt)}{p.id === activePat && <span style={{ color: "#06b6d4" }}> · Active</span>}</div></div>
                  <button onClick={e => { e.stopPropagation(); deletePat(p.id); }} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 14 }}>×</button>
                </div>
              ))}
            </>
          )}

          {/* ══════ SETTINGS PAGE (unchanged) ══════ */}
          {page === "settings" && (
            <>
              <h2 style={{ fontSize: 15, fontWeight: 600 }}>Settings</h2>
              <div style={crd}><div style={lbl}>ESP32 connection</div>
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  <input type="text" value={wsUrl} onChange={e => setWsUrl(e.target.value)} style={{ ...inp, flex: 1, minWidth: 150 }} />
                  <button onClick={connect} style={btn(st === "connected" ? "#10b981" : "#06b6d4")}>{st === "connected" ? "Connected" : "Connect"}</button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6 }}><div style={{ width: 6, height: 6, borderRadius: "50%", background: stColor }} /><span style={{ color: stColor, fontSize: 9, fontFamily: "'JetBrains Mono',monospace" }}>{st === "connected" ? "Live" : st === "connecting" ? "Connecting..." : "Offline"}</span></div>
              </div>
              <div style={crd}><div style={lbl}>Export data</div>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button onClick={async () => { const d = { patients: await dbAll("patients"), readings: await dbAll("readings") }; const b = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `glucosense_${toDS(Date.now())}.json`; a.click(); }} style={btnO("#06b6d4")}>Export JSON</button>
                  <button onClick={() => { if (!filtered.length) return; const h = "Date,Time,Glucose,Activity,HeartRate,SpO2,Notes\n"; const rows = savedReadings.map(r => { const a = ACTIVITIES.find(x => x.id === r.activity); return `${fmtDate(r.timestamp)},${fmt(r.timestamp)},${r.glucose},${a ? a.label : ""},${r.heartRate},${r.spO2},"${r.notes || ""}"`; }).join("\n"); const b = new Blob([h + rows], { type: "text/csv" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `glucosense_${activePatData ? activePatData.name : "all"}_${toDS(Date.now())}.csv`; a.click(); }} style={btnO("#10b981")}>Export CSV</button>
                </div>
              </div>
              <div style={{ ...crd, borderColor: "#292524" }}><p style={{ color: "#78716c", fontSize: 9, lineHeight: 1.4, fontFamily: "'JetBrains Mono',monospace" }}><span style={{ color: "#fbbf24", fontWeight: 600 }}>⚠ Experimental — not medical. </span>PPG glucose and eA1c are estimates only. Never use for clinical decisions.</p></div>
            </>
          )}
        </div>
      </div>

      {/* Bottom Nav (unchanged) */}
      <nav style={{ display: "flex", borderTop: "1px solid #1e293b", flexShrink: 0, background: "#0f172a" }}>
        {NAV.map(n => (<button key={n.id} onClick={() => setPage(n.id)} style={{ flex: 1, padding: "8px 0 6px", background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 1, color: page === n.id ? "#06b6d4" : "#475569" }}><span style={{ fontSize: mob ? 15 : 17 }}>{n.icon}</span><span style={{ fontSize: 8, fontWeight: 600 }}>{n.label}</span></button>))}
      </nav>
    </div>
  );
}