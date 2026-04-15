import { useState, useEffect, useRef, useCallback } from "react";
import TopNav from "./TopNav";
import SideNav from "./SideNav";
import ScanPage from "./ScanPage";
import HistoryPage from "./HistoryPage";
import HbA1cPage from "./HbA1cPage";
import SettingsPage from "./SettingsPage";

// ─── IndexedDB Logic ───────────────────────────────────────
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
async function dbIdx(st, ix, v) { const db = await openDB(); return new Promise((r, j) => { const q = db.transaction(st, "readonly").objectStore(st).index(ix).getAll(v); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); }); }

export default function App() {
  const [page, setPage] = useState("scan");
  const [st, setSt] = useState("disconnected");
  const [wsUrl, setWsUrl] = useState("ws://192.168.1.16:81");
  const [latest, setLatest] = useState({ glucose: 0, heartRate: 0, spO2: 0, timestamp: 0 });
  const [activePat, setActivePat] = useState(null);
  const [patients, setPatients] = useState([]);
  const [savedReadings, setSavedReadings] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [pendingReading, setPendingReading] = useState(null);
  const [notes, setNotes] = useState("");
  const [countdown, setCountdown] = useState(0);

  const ws = useRef(null);
  const rc = useRef(null);

  // Initial Data Load
  useEffect(() => {
    (async () => {
      let p = await dbAll("patients");
      if (p.length === 0) {
          // pre-seed dummy patients for demonstration if db is empty
          await dbPut("patients", { id: "p001", name: "Eleanor Vance", age: 45, bmi: 24.5 });
          await dbPut("patients", { id: "p002", name: "Marcus Thorne", age: 52, bmi: 28.1 });
          p = await dbAll("patients");
      }
      setPatients(p);
      const s = localStorage.getItem("gs_ap");
      if (s && p.find(x => x.id === s)) setActivePat(s);
      else if (p.length) setActivePat(p[0].id);
      const u = localStorage.getItem("gs_ws");
      if (u) setWsUrl(u);
    })();
  }, []);

  // Sync Readings when Patient Changes
  useEffect(() => {
    if (!activePat) { setSavedReadings([]); return; }
    localStorage.setItem("gs_ap", activePat);
    (async () => {
      const r = await dbIdx("readings", "patientId", activePat);
      setSavedReadings(r.sort((a, b) => b.timestamp - a.timestamp));
    })();
  }, [activePat]);

  // WebSocket Connection Logic
  const connect = useCallback(() => {
    if (rc.current) clearTimeout(rc.current);
    if (ws.current) ws.current.close();
    setSt("connecting");
    localStorage.setItem("gs_ws", wsUrl);
    try {
      const s = new WebSocket(wsUrl);
      ws.current = s;
      s.onopen = () => setSt("connected");
      s.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.type === "reading") {
            d.timestamp = Date.now();
            setLatest(d);
            setScanning(false);
            setPendingReading(d);
            setCountdown(10);
          }
        } catch (err) {}
      };
      s.onclose = () => {
        setSt("disconnected");
        rc.current = setTimeout(connect, 5000);
      };
      s.onerror = () => s.close();
    } catch { setSt("disconnected"); }
  }, [wsUrl]);

  // Countdown for Auto-save
  useEffect(() => {
    if (pendingReading && countdown > 0) {
      const t = setTimeout(() => setCountdown(c => c - 1), 1000);
      return () => clearTimeout(t);
    } else if (pendingReading && countdown === 0) {
      saveReading();
    }
  }, [pendingReading, countdown]);

  const startScan = () => {
    if (!activePat) return alert("Please select a patient first.");
    if (st !== "connected") return alert("Not connected to hardware. Check Settings.");
    setScanning(true);
    setPendingReading(null);
    if (ws.current) ws.current.send(JSON.stringify({ type: "startScan" }));
  };

  const saveReading = async () => {
    if (!pendingReading || !activePat) return;
    const entry = {
      patientId: activePat,
      timestamp: Date.now(),
      glucose: pendingReading.glucose,
      heartRate: pendingReading.heartRate || 0,
      spO2: pendingReading.spO2 || 0,
      notes: notes.trim()
    };
    await dbPut("readings", entry);
    setSavedReadings(prev => [entry, ...prev]);
    setPendingReading(null);
    setNotes("");
    setCountdown(0);
  };

  const activePatData = patients.find(p => p.id === activePat);

  return (
    <div className="bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 min-h-screen font-inter">
      <TopNav page={page} setPage={setPage} activePatData={activePatData} st={st} />
      
      <div className="flex pt-16 min-h-screen">
        {(page === "scan" || page === "hba1c") && <SideNav activePatData={activePatData} />}
        
        <main className={`flex-1 p-6 md:p-12 overflow-y-auto ${page === "settings" || page === "history" ? "max-w-7xl mx-auto w-full" : ""}`}>
          {page === "scan" && <ScanPage 
            pendingReading={pendingReading} latest={latest} scanning={scanning} 
            st={st} startScan={startScan} saveReading={saveReading} 
            countdown={countdown} notes={notes} setNotes={setNotes} 
          />}
          {page === "history" && <HistoryPage savedReadings={savedReadings} />}
          {page === "hba1c" && <HbA1cPage activePatData={activePatData} />}
          {page === "settings" && <SettingsPage 
            wsUrl={wsUrl} setWsUrl={setWsUrl} connect={connect} st={st} 
            patients={patients} activePat={activePat} setActivePat={setActivePat} 
          />}
        </main>
      </div>
    </div>
  );
}
