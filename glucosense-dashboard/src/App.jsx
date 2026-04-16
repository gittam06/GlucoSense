import { useState, useEffect, useRef, useCallback, useMemo } from "react";

const MAX_HISTORY = 30;

// ─── IndexedDB ─────────────────────────────────
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

// ─── Helpers ──────────────────────────────────
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

// ─── Components ─────────────────────────────────
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

function Card({ label, value, unit, icon, color, hist }) {
  return (
    <div className="data-card" style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: 14, display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: -10, right: -10, width: 40, height: 40, borderRadius: "50%", background: color, opacity: 0.1 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 13 }}>{icon}</span>
        <span style={{ color: "#94a3b8", fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginTop: 4 }}>
        <span style={{ color: "#f1f5f9", fontSize: 24, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{value > 0 ? (Number.isInteger(value) ? value : value.toFixed(1)) : "---"}</span>
        <span style={{ color: "#64748b", fontSize: 10, fontFamily: "'JetBrains Mono',monospace" }}>{unit}</span>
      </div>
      {hist && hist.length > 1 && <Sparkline data={hist} color={color} width={80} height={20} />}
    </div>
  );
}

function Chart({ readings, height = 300 }) {
  if (readings.length < 2) return (
    <div style={{ width: "100%", height, display: "flex", alignItems: "center", justifyContent: "center", color: "#334155", fontSize: 13, fontFamily: "'JetBrains Mono',monospace", border: "1px dashed #1e293b", borderRadius: 8 }}>Insufficient reading history to plot trajectory...</div>
  );
  
  const axisW = 40;
  const P = { t: 40, r: 40, b: 40, l: 40 };
  const targetW = Math.max(500, readings.length * 85); 
  const w = targetW - P.l - P.r, h = height - P.t - P.b;
  
  const vals = readings.map(r => r.glucose);
  const lo = Math.max(20, Math.min(...vals) - 30);
  const hi = Math.max(200, ...vals) + 30;
  
  const xS = i => P.l + (i / (readings.length - 1)) * w; 
  const yS = v => P.t + h - ((v - lo) / (hi - lo)) * h;
  const zy = v => Math.max(P.t, Math.min(P.t + h, yS(v)));

  const points = readings.map((r, i) => [xS(i), yS(r.glucose)]);
  let ln = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
     const [x0, y0] = points[i-1]; const [x1, y1] = points[i];
     const cp1x = x0 + (x1 - x0) / 2.5, cp2x = x1 - (x1 - x0) / 2.5;
     ln += ` C ${cp1x} ${y0}, ${cp2x} ${y1}, ${x1} ${y1}`;
  }
  const ar = ln + ` L ${points[points.length - 1][0]} ${P.t + h} L ${points[0][0]} ${P.t + h} Z`;

  return (
    <div style={{ position: "relative", width: "100%", height, background: "#020617", borderRadius: 8, border: "1px solid #1e293b", overflow: "hidden" }}>
       
       {/* Layer 0: Background Zones & Complete Grid Lines */}
       <div style={{ position: "absolute", top: 0, left: axisW, right: 0, height: "100%", pointerEvents: "none", zIndex: 0 }}>
           <div style={{ position: "absolute", top: zy(300), height: Math.max(0, zy(200) - zy(300)), width: "100%", background: "#ef4444", opacity: 0.03 }} />
           <div style={{ position: "absolute", top: zy(200), height: Math.max(0, zy(140) - zy(200)), width: "100%", background: "#f97316", opacity: 0.03 }} />
           <div style={{ position: "absolute", top: zy(140), height: Math.max(0, zy(70) - zy(140)), width: "100%", background: "#10b981", opacity: 0.05 }} />
           <div style={{ position: "absolute", top: zy(70), height: Math.max(0, zy(20) - zy(70)), width: "100%", background: "#f59e0b", opacity: 0.03 }} />
           
           {[70, 100, 140, 200, 250].filter(v => v >= lo && v <= hi).map(v => (
               <div key={v} style={{ position: "absolute", top: yS(v), width: "100%", borderTop: "1px dashed #1e293b" }}></div>
           ))}
       </div>

       {/* Layer 1: Left Stationary Y-Axis Scale */}
       <div style={{ position: "absolute", top: 0, left: 0, width: axisW, height: "100%", background: "#0f172a", borderRight: "1px solid #1e293b", zIndex: 10 }}>
           {[70, 100, 140, 200, 250].filter(v => v >= lo && v <= hi).map(v => (
               <div key={v} style={{ position: "absolute", top: yS(v) - 6, width: axisW - 8, textAlign: "right", color: "#64748b", fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono',monospace" }}>{v}</div>
           ))}
       </div>

       {/* Layer 2: Graph Data Canvas (Horizontally Scrollable) */}
       <div className="custom-scroll" style={{ position: "absolute", top: 0, left: axisW, width: `calc(100% - ${axisW}px)`, height: "100%", overflowX: "auto", overflowY: "hidden", zIndex: 5 }}>
         <svg width={targetW} height={height} viewBox={`0 0 ${targetW} ${height}`} style={{ display: "block" }}>
            <defs>
              <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
              </linearGradient>
              <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                 <feGaussianBlur stdDeviation="3.5" result="blur" />
                 <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            <path d={ar} fill="url(#ag)" />
            <path d={ln} fill="none" stroke="#0ea5e9" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" filter="url(#glow)" />
            
            {readings.map((r, i) => {
               let z = glucoseZone(r.glucose);
               let cx = points[i][0], cy = points[i][1];
               return (
                 <g key={i}>
                    <line x1={cx} y1={cy} x2={cx} y2={P.t+h} stroke={z.color} strokeWidth="1" strokeDasharray="2 4" opacity="0.4" />
                    <circle cx={cx} cy={cy} r="6" fill="#0f172a" stroke={z.color} strokeWidth="2.5" />
                    
                    <rect x={cx-16} y={cy-28} width="32" height="18" rx="4" fill="#0f172a" stroke="#1e293b" opacity="0.9" />
                    <text x={cx} y={cy - 15} textAnchor="middle" fill="#f1f5f9" fontSize="11" fontWeight="700" fontFamily="'JetBrains Mono',monospace">
                       {r.glucose.toFixed(0)}
                    </text>
                    
                    {/* Render exact Date and Time separately to differentiate same-day scans */}
                    <text x={cx} y={height - 20} textAnchor="middle" fill="#94a3b8" fontSize="9" fontWeight="600" fontFamily="'JetBrains Mono',monospace">
                       {fmtDate(r.timestamp)}
                    </text>
                    <text x={cx} y={height - 8} textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="'JetBrains Mono',monospace">
                       {fmt(r.timestamp).slice(0, 5)}
                    </text>
                 </g>
               )
            })}
         </svg>
       </div>
    </div>
  );
}

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

// ─── STYLES ─────────────────────────────
const crd = { background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, padding: 16 };
const lbl = { color: "#94a3b8", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 6 };
const inp = { background: "#020617", border: "1px solid #334155", borderRadius: 4, padding: "8px 12px", color: "#e2e8f0", fontFamily: "'JetBrains Mono',monospace", fontSize: 12, outline: "none", width: "100%" };
const btn = (c = "#06b6d4") => ({ background: c, border: "none", borderRadius: 4, color: "#fff", padding: "8px 16px", cursor: "pointer", fontWeight: 600, fontSize: 12, fontFamily: "'JetBrains Mono',monospace" });
const btnO = (c = "#06b6d4") => ({ background: "transparent", border: `1px solid ${c}`, borderRadius: 4, color: c, padding: "8px 16px", cursor: "pointer", fontWeight: 600, fontSize: 12, fontFamily: "'JetBrains Mono',monospace" });

// ════════════════════════════════════════════════════════════
//  MAIN DASHBOARD APP
// ════════════════════════════════════════════════════════════
export default function App() {
  const [wsUrl, setWsUrl] = useState("ws://192.168.1.16:81");
  const [st, setSt] = useState("disconnected");
  const [liveReadings, setLiveReadings] = useState([]);
  const [latest, setLatest] = useState({ glucose: 0, heartRate: 0, spO2: 0, ratio: 0, variability: 0, timestamp: 0 });
  const [ev, setEv] = useState("");
  const ws = useRef(null); const rc = useRef(null);

  const [page, setPage] = useState("scan");
  const [patients, setPatients] = useState([]);
  const [activePat, setActivePat] = useState(null);
  const [savedReadings, setSavedReadings] = useState([]);
  
  const [notes, setNotes] = useState("");
  const [scanning, setScanning] = useState(false);
  const [pendingReading, setPendingReading] = useState(null);
  
  const [newName, setNewName] = useState(""); const [newAge, setNewAge] = useState("");
  const [newGender, setNewGender] = useState("1"); const [newWeight, setNewWeight] = useState(""); const [newHeight, setNewHeight] = useState("");
  const [histView, setHistView] = useState("list");
  const [dateFrom, setDateFrom] = useState(""); const [dateTo, setDateTo] = useState("");

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
    if (rc.current) { clearTimeout(rc.current); rc.current = null; }
    if (ws.current) {
      ws.current.onopen = null; ws.current.onclose = null; ws.current.onmessage = null; ws.current.onerror = null;
      ws.current.close(); ws.current = null;
    }
    setSt("connecting"); localStorage.setItem("gs_ws", wsUrl);
    try {
      const s = new WebSocket(wsUrl); ws.current = s;
      s.onopen = () => { setSt("connected"); setEv("Connected"); };
      s.onmessage = (e) => { 
        try { 
            const d = JSON.parse(e.data); 
            if (d.type === "reading") { 
                d.timestamp = Date.now(); setLatest(d); setLiveReadings(p => [...p.slice(-MAX_HISTORY + 1), d]); setEv(""); 
                setPendingReading(d); 
                setScanning(false); 
            } else if (d.type === "event") setEv(d.message); 
        } catch {} 
      };
      s.onclose = () => {
        setSt("disconnected");
        rc.current = setTimeout(() => { if (connectRef.current) connectRef.current(); }, 5000);
      };
      s.onerror = () => s.close();
    } catch { setSt("disconnected"); }
  }, [wsUrl]);

  useEffect(() => { connectRef.current = connect; }, [connect]);

  useEffect(() => () => {
    if (rc.current) { clearTimeout(rc.current); rc.current = null; }
    if (ws.current) { ws.current.onopen = null; ws.current.onclose = null; ws.current.onmessage = null; ws.current.onerror = null; ws.current.close(); ws.current = null; }
  }, []);

  const addPatient = async () => {
    if (!newName.trim()) return;
    const h = parseFloat(newHeight); const w = parseFloat(newWeight); let bmi = 0;
    if (h > 0 && w > 0) bmi = +(w / ((h / 100) ** 2)).toFixed(1);
    const p = { id: uid(), name: newName.trim(), age: newAge || "", gender: newGender, weight: newWeight, height: newHeight, bmi, createdAt: Date.now() };
    await dbPut("patients", p); setPatients(prev => [...prev, p]); setActivePat(p.id);
    setNewName(""); setNewAge(""); setNewGender("1"); setNewWeight(""); setNewHeight("");
  };

  const deletePat = async (id) => {
    if (!confirm("Delete patient profile and all readings?")) return;
    await dbDel("patients", id); const r = await dbIdx("readings", "patientId", id);
    for (const x of r) await dbDel("readings", x.id);
    setPatients(prev => prev.filter(p => p.id !== id));
    if (activePat === id) { const rem = patients.filter(p => p.id !== id); setActivePat(rem.length ? rem[0].id : null); }
  };

  const startScan = () => {
    if (!activePat) return alert("Select patient");
    if (st !== "connected") return alert("Connect hardware first");
    const p = patients.find(x => x.id === activePat);
    if (p && ws.current) {
        ws.current.send(JSON.stringify({ type: "setContext", age: parseInt(p.age) || 40, gender: parseInt(p.gender) || 1, bmi: parseFloat(p.bmi) || 24.5, weight: parseFloat(p.weight) || 70, height: parseFloat(p.height) || 170 }));
    }
    setScanning(true); setPendingReading(null);
  };

  const saveReading = async () => {
    if (!pendingReading || !activePat) return;
    const entry = { patientId: activePat, timestamp: Date.now(), glucose: pendingReading.glucose, heartRate: pendingReading.heartRate || 0, spO2: pendingReading.spO2 || 0, ratio: pendingReading.ratio || 0, variability: pendingReading.variability || 0, notes: notes.trim() };
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
    return { avg, min: Math.min(...v), max: Math.max(...v), count: v.length, pctIR: ((inR / v.length) * 100).toFixed(0), eA1c, a1cZ: a1cZone(eA1c), std: Math.sqrt(v.reduce((s, val) => s + (val - avg)**2, 0)/v.length) };
  }, [filtered]);

  const activePatData = patients.find(p => p.id === activePat);
  const stColor = { connected: "#10b981", connecting: "#f59e0b", disconnected: "#ef4444" }[st] || "#ef4444";

  const NAV = [
    { id: "scan", icon: "🔴", label: "Scan" },
    { id: "history", icon: "📊", label: "History" },
    { id: "hba1c", icon: "🧬", label: "HbA1c Insight" },
    { id: "settings", icon: "⚙️", label: "Settings" }
  ];

  return (
      <div className="sys-wrap">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Outfit:wght@300;400;500;600;700&display=swap');
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:.4} }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        ::-webkit-calendar-picker-indicator { filter: invert(0.8); cursor: pointer; opacity: 0.6; transition: 0.2s; }
        ::-webkit-calendar-picker-indicator:hover { opacity: 1; }
        input[type="date"] { color-scheme: dark; }
        
        .sys-wrap { display: flex; width: 100%; height: 100vh; background: #020617; color: #e2e8f0; font-family: 'Outfit', system-ui, sans-serif; overflow: hidden; }
        .sys-nav { width: 260px; background: #000; border-right: 1px solid #1e293b; display: flex; flex-direction: column; flex-shrink: 0; transition: 0.3s; }
        .sys-nav-links { flex: 1; display: flex; flex-direction: column; gap: 6px; padding: 0 10px; }
        .sys-main { flex: 1; overflow-y: auto; padding: 30px; scroll-behavior: smooth; }
        
        .page-trans { animation: fadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .scale-trans { animation: scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        
        button { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
        button:hover { transform: translateY(-1px); filter: brightness(1.1); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
        button:active { transform: translateY(0) scale(0.97); }
        
        .data-card { transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
        .data-card:hover { transform: translateY(-3px); box-shadow: 0 10px 25px rgba(0,0,0,0.4); border-color: #334155 !important; }
        .pointer-card { cursor: pointer; }
        
        .grid-split { display: grid; grid-template-columns: 1fr 280px; gap: 24px; }
        .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
        .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; text-align: center; }
        .hist-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding: 16px; background: #0f172a; border-radius: 8px; border: 1px solid #1e293b; }
        
        @media (max-width: 768px) {
            .sys-wrap { flex-direction: column; }
            .sys-nav { width: 100%; height: auto; border-right: none; border-bottom: 1px solid #1e293b; flex-direction: column; padding-bottom: 10px; }
            .sys-nav-links { flex-direction: row; overflow-x: auto; padding-bottom: 5px; }
            .sys-nav-links button { white-space: nowrap; font-size: 12px; padding: 8px 12px; }
            .sys-main { padding: 16px; }
            .grid-split, .grid-3, .grid-2, .grid-4 { grid-template-columns: 1fr; }
            .hist-header { flex-direction: column; gap: 16px; align-items: stretch; }
            .nav-hide-mobile { display: none !important; }
        }
        `}</style>
      
      {/* Sidebar Navigation */}
      <nav className="sys-nav">
        <div style={{ padding: "30px 20px" }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: 6, background: "linear-gradient(135deg,#06b6d4,#3b82f6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🩸</div>
                GlucoSense
            </div>
            <div style={{ color: "#64748b", fontSize: 10, fontFamily: "'JetBrains Mono',monospace", marginTop: 8 }}>v2.0 Beta Build</div>
        </div>
        
        <div className="sys-nav-links">
            {NAV.map(n => (
                <button
                    key={n.id}
                    onClick={() => setPage(n.id)}
                    style={{ background: page === n.id ? "#1e293b" : "transparent", color: page === n.id ? "#fff" : "#94a3b8", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, textAlign: "left", transition: "0.2s", flexShrink: 0 }}
                >
                    <span style={{ fontSize: 16 }}>{n.icon}</span>
                    {n.label}
                </button>
            ))}
        </div>

        <div className="nav-hide-mobile" style={{ padding: 20, borderTop: "1px solid #1e293b", marginTop: "auto" }}>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Current Profile</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#1e293b", display: "flex", alignItems: "center", justifyContent: "center" }}>👤</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{activePatData ? activePatData.name : "No Profile"}</div>
            </div>
            
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 16, background: "#1e293b", padding: "6px 12px", borderRadius: 12, width: "max-content" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: stColor, boxShadow: st === "connected" ? `0 0 6px ${stColor}` : "none" }}></div>
                <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: stColor }}>{st.toUpperCase()}</span>
            </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="sys-main">
         <div style={{ maxWidth: 1000, margin: "0 auto" }}>
             
             {/* ══════ SCAN PAGE ══════ */}
             {page === "scan" && (
                <div className="page-trans">
                   <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24, borderBottom: "1px solid #1e293b", paddingBottom: 16 }}>Live Sensor Dashboard</h1>
                   
                   {!activePat ? (
                      <div style={{ ...crd, textAlign: "center", padding: 40, border: "1px dashed #334155", background: "transparent" }}>
                          <p style={{ color: "#94a3b8", fontSize: 16, marginBottom: 20 }}>No patient profile activated.</p>
                          <button onClick={() => setPage("settings")} style={btn()}>Activate Patient Profile</button>
                      </div>
                   ) : (
                      <div className="grid-split">
                          
                          {/* Live Metrics Grid */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                              <div className="grid-3">
                                  <Card label="Heart Rate" value={latest.heartRate} unit="bpm" icon="💓" color="#f43f5e" hist={liveReadings.map(r => r.heartRate)} />
                                  <Card label="SpO₂" value={latest.spO2} unit="%" icon="🫁" color="#3b82f6" hist={liveReadings.map(r => r.spO2)} />
                                  <Card label="R Ratio" value={latest.ratio} unit="" icon="📊" color="#8b5cf6" hist={liveReadings.map(r => r.ratio)} />
                              </div>

                              <div style={crd} className="data-card">
                                  <div style={{ ...lbl, display: 'flex', justifyContent: 'space-between' }}>
                                      <span>Recent Scans</span>
                                      <span style={{ cursor: "pointer", color: "#06b6d4", textTransform: "none" }} onClick={() => setPage("history")}>View all history →</span>
                                  </div>
                                  {!savedReadings.length ? (
                                      <div style={{ height: 250, display: "flex", alignItems: "center", justifyContent: "center", color: "#334155", fontSize: 13, border: "1px dashed #1e293b", borderRadius: 8 }}>No scans yet...</div>
                                  ) : (
                                      <div style={{ display: "flex", flexDirection: "column", gap: 10, height: 250, overflowY: "auto", paddingRight: 4 }}>
                                          {[...savedReadings].reverse().slice(0, 4).map(r => {
                                              const z = glucoseZone(r.glucose);
                                              return (
                                                  <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "#020617", borderRadius: 8, borderLeft: `3px solid ${z.color}` }}>
                                                      <div>
                                                          <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600 }}>{fmtDate(r.timestamp)} - {fmt(r.timestamp)}</div>
                                                          <div style={{ color: "#64748b", fontSize: 11, marginTop: 4, fontStyle: "italic" }}>{r.notes ? `"${r.notes}"` : "No notes"}</div>
                                                      </div>
                                                      <div style={{ textAlign: "right" }}>
                                                          <div style={{ color: z.color, fontSize: 22, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1 }}>{r.glucose.toFixed(0)}</div>
                                                          <div style={{ color: z.color, fontSize: 9, fontWeight: 600, textTransform: "uppercase", marginTop: 4 }}>{z.label}</div>
                                                      </div>
                                                  </div>
                                              )
                                          })}
                                      </div>
                                  )}
                              </div>
                          </div>

                          {/* Action Block */}
                          <div className="data-card" style={{ ...crd, textAlign: "center", display: "flex", flexDirection: "column", gap: 16 }}>
                              <div style={lbl}>Glucose Prediction</div>
                              <Gauge value={pendingReading ? pendingReading.glucose : latest.glucose} size={200} />
                              <div style={{ fontSize: 10, color: "#64748b", fontFamily: "'JetBrains Mono',monospace", margin: "-10px 0 10px 0" }}>Update Loop: {ago(latest.timestamp)}</div>
                              
                              {scanning ? (
                                  <div style={{ padding: 16, background: "#1e293b", borderRadius: 8 }}>
                                      <div style={{ fontSize: 12, color: "#38bdf8", animation: "pulse 1.5s infinite" }}>Collecting PPG Signal...</div>
                                  </div>
                              ) : (
                                  <button onClick={startScan} style={{ ...btn(), padding: "16px", fontSize: 14 }}>Start New Scan</button>
                              )}
                          </div>
                      </div>
                   )}
                </div>
             )}

             {/* ══════ HISTORY / LEDGER PAGE ══════ */}
             {page === "history" && (
                <div className="page-trans">
                   <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24, borderBottom: "1px solid #1e293b", paddingBottom: 16 }}>Database Logs</h1>
                   
                   <div className="hist-header">
                      <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => setHistView("list")} style={{ ...btnO(histView === "list" ? "#06b6d4" : "#334155") }}>List View</button>
                          <button onClick={() => setHistView("graph")} style={{ ...btnO(histView === "graph" ? "#06b6d4" : "#334155") }}>Graph View</button>
                      </div>
                      
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inp} />
                          <span style={{ color: "#64748b", fontSize: 12 }}>→</span>
                          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inp} />
                          <button onClick={() => { setDateFrom(""); setDateTo(""); }} style={btnO("#64748b")}>Clear</button>
                      </div>
                   </div>

                   {!filtered.length ? (
                      <div style={{ padding: 40, textAlign: "center", color: "#64748b", border: "1px dashed #334155" }}>Query returned 0 results.</div>
                   ) : (
                      <>
                         {histView === "graph" && (
                             <div style={crd} className="data-card page-trans">
                                 <div style={lbl}>Glucose History Chart</div>
                                 <Chart readings={filtered} height={300} />
                             </div>
                         )}

                         {histView === "list" && (
                             <div className="grid-3 page-trans">
                                 {[...filtered].reverse().map(r => {
                                     const z = glucoseZone(r.glucose);
                                     return (
                                         <div key={r.id} className="data-card" style={{ ...crd, display: "flex", flexDirection: "column", gap: 8 }}>
                                             <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                                 <div style={{ fontSize: 24, fontWeight: 700, color: z.color, fontFamily: "'JetBrains Mono',monospace" }}>{r.glucose.toFixed(0)}</div>
                                                 <button onClick={() => delReading(r.id)} style={{ color: "#ef4444", background: "none", border: "none", cursor: "pointer", fontSize: 16 }}>×</button>
                                             </div>
                                             <div style={{ color: z.color, fontSize: 10, fontWeight: 600, textTransform: "uppercase" }}>{z.label} RANGE</div>
                                             <div style={{ fontSize: 10, color: "#64748b", fontFamily: "'JetBrains Mono',monospace", margin: "4px 0", borderTop: "1px solid #1e293b", paddingTop: 8 }}>
                                                {fmtFull(r.timestamp)} | HR: {r.heartRate} | SpO2: {r.spO2.toFixed(1)}%
                                             </div>
                                             <div style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>{r.notes ? `"${r.notes}"` : "No message."}</div>
                                         </div>
                                     )
                                 })}
                             </div>
                         )}
                      </>
                   )}
                </div>
             )}

             {/* ══════ HBA1C / INSIGHTS PAGE ══════ */}
             {page === "hba1c" && (
                <div className="page-trans">
                   <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24, borderBottom: "1px solid #1e293b", paddingBottom: 16 }}>Data Insight Module</h1>
                   
                   {!activePat || !stats ? (
                       <div style={{ padding: 40, textAlign: "center", color: "#64748b", border: "1px dashed #334155" }}>Insufficient dataset for analysis.</div>
                   ) : (
                       <div className="grid-2">
                           
                           {/* A1C Block */}
                           <div className="data-card" style={{ ...crd, textAlign: "center", padding: "40px 20px" }}>
                               <div style={lbl}>Computed eA1c</div>
                               <div style={{ fontSize: 64, fontWeight: 700, color: stats.a1cZ.color, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1 }}>
                                   {stats.eA1c.toFixed(1)}<span style={{ fontSize: 24 }}>%</span>
                               </div>
                               <div style={{ background: stats.a1cZ.color + "20", color: stats.a1cZ.color, padding: "6px 12px", borderRadius: 20, display: "inline-block", fontSize: 12, fontWeight: 600, marginTop: 12 }}>
                                   {stats.a1cZ.label} Pattern
                               </div>
                           </div>

                           {/* Distribution Donut */}
                           <div className="data-card" style={{ ...crd, display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 20px" }}>
                               <div style={lbl}>Distribution Ratio</div>
                               <TimeInRange readings={filtered} size={180} />
                           </div>

                           {/* Standard Deviation / Aggregates */}
                           <div className="data-card grid-4" style={{ ...crd, gridColumn: "1 / -1" }}>
                               <div>
                                   <div style={{ fontSize: 24, color: "#06b6d4", fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>{stats.avg.toFixed(0)}</div>
                                   <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>Mean Average (mg/dL)</div>
                               </div>
                               <div>
                                   <div style={{ fontSize: 24, color: "#8b5cf6", fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>{stats.std.toFixed(1)}</div>
                                   <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>Standard Deviation</div>
                               </div>
                               <div>
                                   <div style={{ fontSize: 24, color: "#f59e0b", fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>{stats.min} - {stats.max}</div>
                                   <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>Full Range Spread</div>
                               </div>
                               <div>
                                   <div style={{ fontSize: 24, color: "#10b981", fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>{stats.count}</div>
                                   <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>Total Datapoints</div>
                               </div>
                           </div>

                       </div>
                   )}
                </div>
             )}

             {/* ══════ SETTINGS PAGE ══════ */}
             {(page === "settings") && (
                <div className="page-trans">
                   <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24, borderBottom: "1px solid #1e293b", paddingBottom: 16 }}>Settings & Profiles</h1>
                   
                   <div className="grid-2">
                       
                       {/* Patient DB Block */}
                       <div className="data-card" style={{ ...crd, display: "flex", flexDirection: "column", gap: 16 }}>
                           <div style={lbl}>Registered Users</div>
                           
                           {patients.map(p => (
                               <div key={p.id} className="data-card pointer-card" onClick={() => setActivePat(p.id)} style={{ padding: 16, background: activePat === p.id ? "#06b6d420" : "#020617", border: `1px solid ${activePat === p.id ? "#06b6d4" : "#1e293b"}`, borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                   <div>
                                       <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0" }}>{p.name}</div>
                                       <div style={{ fontSize: 10, color: "#64748b", fontFamily: "'JetBrains Mono',monospace", marginTop: 4 }}>Age: {p.age} | BMI: {p.bmi}</div>
                                   </div>
                                   <button onClick={(e) => { e.stopPropagation(); deletePat(p.id); }} style={{ color: "#ef4444", background: "none", border: "none", cursor: "pointer", fontSize: 20 }}>×</button>
                               </div>
                           ))}

                           <hr style={{ border: 0, borderTop: "1px solid #1e293b", margin: "8px 0" }} />
                           <div style={lbl}>Add New User</div>
                           <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Full Name" style={inp} />
                           <div className="grid-3" style={{ gap: 10 }}>
                               <input type="number" value={newAge} onChange={e => setNewAge(e.target.value)} placeholder="Age" style={inp} />
                               <input type="number" value={newWeight} onChange={e => setNewWeight(e.target.value)} placeholder="Weight (kg)" style={inp} />
                               <input type="number" value={newHeight} onChange={e => setNewHeight(e.target.value)} placeholder="Height (cm)" style={inp} />
                           </div>
                           <button onClick={addPatient} style={btn()}>Add User</button>
                       </div>

                       {/* System Hardware Block */}
                       <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                           <div style={crd} className="data-card">
                               <div style={lbl}>Hardware Connection</div>
                               <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                                   <input type="text" value={wsUrl} onChange={e => setWsUrl(e.target.value)} placeholder="ws://" style={inp} />
                                   <button onClick={connect} style={btnO()}>Connect</button>
                               </div>
                               <div style={{ marginTop: 16, padding: 12, background: "#020617", border: "1px solid #1e293b", borderRadius: 8, display: "flex", justifyContent: "space-between" }}>
                                   <span style={{ fontSize: 12, color: "#94a3b8" }}>Connection Status:</span>
                                   <span style={{ color: stColor, fontSize: 12, fontWeight: 700, textTransform: "uppercase" }}>{st}</span>
                               </div>
                           </div>

                           <div style={crd} className="data-card">
                               <div style={lbl}>Data Backup</div>
                               <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                                   <button onClick={async () => { const d = { patients: await dbAll("patients"), readings: await dbAll("readings") }; const b = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `backup_${toDS(Date.now())}.json`; a.click(); }} style={btnO("#8b5cf6")}>Download Backup (.JSON)</button>
                                   <button onClick={() => { if (!filtered.length) return; const h = "Date,Time,Glucose,HeartRate,SpO2,Notes\n"; const rows = savedReadings.map(r => { return `${fmtDate(r.timestamp)},${fmt(r.timestamp)},${r.glucose},${r.heartRate},${r.spO2},"${r.notes || ""}"`; }).join("\n"); const b = new Blob([h + rows], { type: "text/csv" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `data_${toDS(Date.now())}.csv`; a.click(); }} style={btnO("#8b5cf6")}>Download Spreadsheet (.CSV)</button>
                               </div>
                           </div>
                       </div>

                   </div>
                </div>
             )}

         </div>
      </main>

      {/* ══════ MODAL POPUP FOR SAVING READING ══════ */}
      {pendingReading && (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(0,0,0,0.8)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)", opacity: 0, animation: "fadeIn .2s ease-out forwards" }}>
           <div className="scale-trans" style={{ background: "#0f172a", width: 420, maxWidth: "90%", padding: 24, borderRadius: 12, border: "1px solid #1e293b", boxShadow: "0 20px 40px rgba(0,0,0,0.5)" }}>
              <h3 style={{ margin: "0 0 20px 0", fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>Log Reading</h3>
              
              <div style={{ background: "#020617", padding: "30px", borderRadius: 8, display: "flex", alignItems: "baseline", justifyContent: "center", gap: 8, marginBottom: 24, border: "1px solid #10b98140", boxShadow: "inset 0 0 20px rgba(16,185,129,0.1)" }}>
                 <div style={{ fontSize: 48, fontFamily: "'JetBrains Mono',monospace", color: "#10b981", fontWeight: "bold", lineHeight: 1 }}>
                     {pendingReading.glucose.toFixed(0)}
                 </div>
                 <span style={{ fontSize: 14, color: "#64748b", fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>mg/dL</span>
              </div>
              
              <div style={{ marginBottom: 8, fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Add Message (Optional)</div>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="How are you feeling?" rows={4} style={{ ...inp, resize: "none", fontFamily: "inherit", marginBottom: 24, fontSize: 14, padding: 12 }} />
              
              <div style={{ display: "flex", gap: 12 }}>
                  <button onClick={saveReading} style={{ ...btn("#10b981"), flex: 1, padding: "14px", fontSize: 14 }}>Save to Dashboard</button>
                  <button onClick={() => setPendingReading(null)} style={{ ...btnO("#64748b"), padding: "14px", fontSize: 14, color: "#94a3b8", borderColor: "#334155" }}>Discard</button>
              </div>
           </div>
        </div>
      )}

    </div>
  );
}