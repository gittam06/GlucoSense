 

const glucoseZone = (val) => {
  if (val < 70) return { label: "Hypoglycemic", color: "text-amber-500", border: "border-amber-500", shadow: "shadow-amber-500/20" };
  if (val <= 140) return { label: "In Range", color: "text-emerald-500", border: "border-emerald-500", shadow: "shadow-emerald-500/20" };
  if (val <= 200) return { label: "Elevated", color: "text-orange-500", border: "border-orange-500", shadow: "shadow-orange-500/20" };
  return { label: "Critical High", color: "text-red-600", border: "border-red-600", shadow: "shadow-red-600/20" };
};

export default function ScanPage({ pendingReading, latest, scanning, st, startScan, saveReading, countdown, notes, setNotes }) {
  const currentVal = pendingReading ? pendingReading.glucose : latest.glucose;
  const isIdle = currentVal === 0 && !scanning;
  const zone = currentVal > 0 ? glucoseZone(currentVal) : { label: "Ready", color: "text-slate-400", border: "border-slate-100", shadow: "" };

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
      <div className="md:col-span-8 flex flex-col gap-8">
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-10 shadow-sm border border-slate-100 dark:border-slate-800 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-sky-400 to-indigo-500"></div>
          <h2 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] mb-12">Non-Invasive Scan</h2>
          
          <div className="relative w-64 h-64 mx-auto mb-12">
            <div className={`absolute inset-0 rounded-full border-[10px] ${isIdle ? 'border-slate-50 dark:border-slate-800' : 'border-slate-100 dark:border-slate-700'}`}></div>
            <div className={`absolute inset-0 rounded-full border-[10px] ${scanning ? 'border-sky-500 animate-spin border-t-transparent' : isIdle ? 'border-transparent' : zone.border + ' ' + zone.shadow}`} style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)' }}></div>
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-white dark:bg-slate-900 rounded-full m-2 shadow-inner">
              <span className="text-6xl font-black tracking-tighter text-slate-800 dark:text-slate-100">
                {currentVal > 0 ? currentVal.toFixed(0) : scanning ? "..." : "---"}
              </span>
              <span className="text-sm font-bold text-slate-400 dark:text-slate-500 mt-1">mg/dL</span>
            </div>
          </div>
          
          <div className={`text-sm font-bold tracking-widest uppercase mb-12 ${scanning ? 'text-sky-500 animate-pulse' : currentVal > 0 ? zone.color : 'text-slate-400'}`}>
            {currentVal > 0 ? zone.label : scanning ? "Acquiring Signal..." : "System Idle"}
          </div>
          
          <div className="max-w-xs mx-auto">
             {scanning ? (
                <div className="bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 p-4 rounded-xl text-sm font-bold flex items-center justify-center gap-2">
                   <span className="material-symbols-outlined animate-spin text-lg">sync</span> Processing Optics...
                </div>
             ) : pendingReading ? (
                <div className="text-left animate-fade-in-up">
                   <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Clinical Notes</label>
                   <textarea placeholder="e.g. Post-prandial 2h, symptomatic..." value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-sm focus:ring-2 focus:ring-sky-500 focus:border-transparent outline-none resize-none mb-4"/>
                   <div className="flex gap-3">
                       <button onClick={saveReading} className="flex-1 bg-sky-600 hover:bg-sky-700 text-white py-3 rounded-xl font-bold text-sm transition-all shadow-md shadow-sky-500/20">Save</button>
                       <button onClick={() => setNotes('')} className="px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm transition-colors">Discard</button>
                   </div>
                   {countdown > 0 && <p className="text-[10px] text-slate-400 font-bold text-center mt-3 uppercase tracking-wider">Auto-saving in {countdown}s</p>}
                </div>
             ) : (
                <button onClick={startScan} disabled={st !== 'connected'} className={`w-full py-4 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${st === 'connected' ? 'bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900 text-white shadow-lg' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
                  <span className="material-symbols-outlined text-lg">sensors</span> Initialize Scan
                </button>
             )}
          </div>
        </div>
      </div>
      
      <div className="md:col-span-4 flex flex-col gap-6">
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-sm border border-slate-100 dark:border-slate-800">
           <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-6 px-2">Real-time Vitals</h3>
           <div className="space-y-4">
              <div className="bg-rose-50/50 dark:bg-rose-950/30 p-4 rounded-2xl flex items-center justify-between border border-rose-100/50 dark:border-rose-900/30">
                 <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-900 text-rose-500 flex items-center justify-center"><span className="material-symbols-outlined">favorite</span></div>
                    <div><div className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">Heart Rate</div><div className="text-xl font-black text-slate-800 dark:text-slate-200">{latest.heartRate || '--'} <span className="text-xs font-bold text-slate-400">BPM</span></div></div>
                 </div>
              </div>
              <div className="bg-blue-50/50 dark:bg-blue-950/30 p-4 rounded-2xl flex items-center justify-between border border-blue-100/50 dark:border-blue-900/30">
                 <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-500 flex items-center justify-center"><span className="material-symbols-outlined">water_drop</span></div>
                    <div><div className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">SpO2</div><div className="text-xl font-black text-slate-800 dark:text-slate-200">{latest.spO2 || '--'} <span className="text-xs font-bold text-slate-400">%</span></div></div>
                 </div>
              </div>
           </div>
        </div>
        
        <div className="bg-slate-900 dark:bg-slate-800 rounded-3xl p-8 shadow-sm text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10"><span className="material-symbols-outlined text-6xl">network_check</span></div>
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Telemetry Status</h3>
            <div className="flex items-center gap-3 mt-4">
               <div className={`w-3 h-3 rounded-full ${st === 'connected' ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`}></div>
               <span className="font-bold text-sm">{st === 'connected' ? 'Channel Active' : 'Offline'}</span>
            </div>
            <p className="text-xs text-slate-400 mt-2">{st === 'connected' ? 'Hardware is sending PPG data.' : 'Check serial connection.'}</p>
        </div>
      </div>
    </div>
  );
}
