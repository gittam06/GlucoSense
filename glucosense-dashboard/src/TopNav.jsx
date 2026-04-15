export default function TopNav({ page, setPage, activePatData, st }) {
  return (
    <nav className="fixed top-0 w-full z-50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-sm dark:shadow-none flex justify-between items-center px-8 py-3 font-inter tracking-tight">
      <div className="flex items-center gap-8">
        <span className="text-xl font-bold tracking-tighter text-sky-900 dark:text-sky-100">Sanctuary Health</span>
        <div className="hidden md:flex items-center gap-6">
          <button 
            onClick={() => setPage("scan")} 
            className={`${page === "scan" ? "text-sky-700 dark:text-sky-400 font-semibold border-b-2 border-sky-700 dark:border-sky-400 pb-1" : "text-slate-500 dark:text-slate-400 hover:text-sky-600 transition-colors duration-300"}`}
          >Scan</button>
          <button 
            onClick={() => setPage("history")} 
            className={`${page === "history" ? "text-sky-700 dark:text-sky-400 font-semibold border-b-2 border-sky-700 dark:border-sky-400 pb-1" : "text-slate-500 dark:text-slate-400 hover:text-sky-600 transition-colors duration-300"}`}
          >History</button>
          <button 
            onClick={() => setPage("hba1c")} 
            className={`${page === "hba1c" ? "text-sky-700 dark:text-sky-400 font-semibold border-b-2 border-sky-700 dark:border-sky-400 pb-1" : "text-slate-500 dark:text-slate-400 hover:text-sky-600 transition-colors duration-300"}`}
          >HbA1c</button>
          <button 
            onClick={() => setPage("settings")} 
            className={`${page === "settings" ? "text-sky-700 dark:text-sky-400 font-semibold border-b-2 border-sky-700 dark:border-sky-400 pb-1" : "text-slate-500 dark:text-slate-400 hover:text-sky-600 transition-colors duration-300"}`}
          >Settings</button>
        </div>
      </div>
      <div className="flex items-center gap-4">
        {activePatData && (
            <div className="bg-slate-100/50 dark:bg-slate-800/50 rounded-full px-3 py-1 flex items-center gap-2 border border-transparent">
              <div className={`w-2 h-2 rounded-full ${st === 'connected' ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-sm font-semibold">{activePatData.name}</span>
            </div>
        )}
        <button className="p-2 hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors duration-300 rounded-full">
          <span className="material-symbols-outlined text-slate-500">notifications</span>
        </button>
        <button className="p-2 hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors duration-300 rounded-full">
          <span className="material-symbols-outlined text-slate-500">settings</span>
        </button>
        <img alt="Clinician Profile" className="w-8 h-8 rounded-full object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBDWwi7Im7VPLQeacuHkyOA03i_C_zhNgysuDUA5oZyMQrg_d234IKT_t2QvjyH7SMyLdjFVAtA-63U1J2OhXTDYRnwEfSN75zpGVNhzbiDff1b_lRZsNJrdW-yZXY6JL4AZJ4XoDNRtemlRXj44YKbtsS4GMQerNiLlXAhkSRl5tsXl6iUIJzjNZNsEcoslDuZfZQF8LMXr61tEKkBQfFLvRobSGGacmI2DjieBc4K9Ro_YypRiFaduHJqb7q0WGkg16jq1js476Y"/>
      </div>
    </nav>
  );
}
