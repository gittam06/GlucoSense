const fmt = (ms) => !ms ? "--:--" : new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDate = (ts) => new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

const glucoseZone = (val) => {
  if (val < 70) return { label: "Hypoglycemic", color: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-900/20" };
  if (val <= 140) return { label: "In Range", color: "text-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-900/20" };
  if (val <= 200) return { label: "Elevated", color: "text-orange-500", bg: "bg-orange-50 dark:bg-orange-900/20" };
  return { label: "Critical High", color: "text-red-600", bg: "bg-red-50 dark:bg-red-900/20" };
};

export default function HistoryPage({ savedReadings }) {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200">Patient History</h2>
        <span className="text-sm font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full">{savedReadings.length} Records</span>
      </div>

      {!savedReadings.length ? (
        <div className="text-center p-12 bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800">
           <span className="material-symbols-outlined text-4xl text-slate-300 mb-4">history</span>
           <p className="text-slate-500 font-medium">No records found for this patient.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {savedReadings.map(r => {
            const z = glucoseZone(r.glucose);
            return (
              <div key={r.id || r.timestamp} className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all hover:shadow-md">
                <div className="flex items-center gap-6">
                  <div className={`w-16 h-16 rounded-full flex flex-col items-center justify-center ${z.bg} ${z.color}`}>
                    <span className="text-xl font-black">{r.glucose.toFixed(0)}</span>
                  </div>
                  <div>
                    <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                       {fmtDate(r.timestamp)} <span className="text-slate-400 font-normal">at {fmt(r.timestamp)}</span>
                    </div>
                    <div className="text-sm font-medium mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                       <span className="flex items-center gap-1 text-slate-500"><span className="material-symbols-outlined text-[14px]">favorite</span> {r.heartRate} bpm</span>
                       <span className="flex items-center gap-1 text-slate-500"><span className="material-symbols-outlined text-[14px]">water_drop</span> {r.spO2}% SpO2</span>
                    </div>
                  </div>
                </div>
                
                <div className="flex flex-col items-end gap-2 border-t md:border-t-0 md:border-l border-slate-100 dark:border-slate-800 pt-4 md:pt-0 md:pl-6 list-none min-w-[200px]">
                   <span className={`text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded ${z.bg} ${z.color}`}>{z.label}</span>
                   {r.notes && (
                      <p className="text-xs text-slate-500 text-right max-w-[250px] truncate italic">"{r.notes}"</p>
                   )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
