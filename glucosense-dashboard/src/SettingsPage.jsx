export default function SettingsPage({ wsUrl, setWsUrl, connect, st, patients, activePat, setActivePat }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
      <div className="md:col-span-8 space-y-8">
        <div className="bg-surface-container-lowest rounded-xl p-8 shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-lg font-bold text-on-surface">Patient Directory</h2>
          </div>
          <div className="space-y-3">
            {patients.length === 0 ? (
                <div className="p-4 text-center text-sm text-slate-500">No patients enrolled</div>
            ) : patients.map(p => (
              <div key={p.id} onClick={() => setActivePat(p.id)} className={`p-4 bg-surface-container-low rounded-lg flex items-center justify-between transition-colors cursor-pointer ${activePat === p.id ? 'border-2 border-primary' : 'hover:bg-surface-container-high'}`}>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary-container/20 flex items-center justify-center text-primary font-bold">{p.name.substring(0,2).toUpperCase()}</div>
                  <div>
                    <div className="text-sm font-bold text-on-surface">{p.name}</div>
                    <div className="text-xs text-on-surface-variant">Age: {p.age || 'N/A'} • BMI: {p.bmi || 'N/A'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  {activePat === p.id && <span className="px-3 py-1 bg-secondary-container text-on-secondary-container text-[10px] font-bold tracking-wider rounded-full uppercase">Selected</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-surface-container-lowest rounded-xl p-8 shadow-sm">
          <h2 className="text-lg font-bold text-on-surface mb-6">Connection Settings</h2>
          <div className="space-y-6">
            <div>
              <label className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-2">WebSocket URL</label>
              <div className="flex gap-4">
                <div className="relative flex-grow">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-slate-400 text-lg">link</span>
                  <input className="w-full bg-surface-container-low border-none rounded-lg pl-12 pr-4 py-3 text-sm font-medium focus:ring-2 focus:ring-primary-fixed" type="text" value={wsUrl} onChange={e => setWsUrl(e.target.value)}/>
                </div>
                <button onClick={connect} className="px-6 bg-primary text-on-primary rounded-lg text-sm font-bold hover:bg-primary-dim transition-colors shadow-sm">{st === 'connected' ? 'Connected' : 'Connect'}</button>
              </div>
              <p className="text-xs text-on-surface-variant mt-2 flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full inline-block ${st === 'connected' ? 'bg-green-500' : 'bg-red-500'}`}></span> {st.toUpperCase()}
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="md:col-span-4 space-y-8">
        <div className="bg-surface-container-low rounded-xl p-6">
          <h3 className="text-sm font-bold text-on-surface mb-4 uppercase tracking-widest text-[10px]">Data Operations</h3>
          <p className="text-xs text-on-surface-variant mb-6 leading-relaxed">Securely export patient clinical records and vitals history for external auditing or migration.</p>
          <div className="space-y-3">
            <button className="w-full bg-surface-container-lowest text-on-surface border border-transparent hover:border-primary/20 transition-all p-4 rounded-lg flex items-center justify-between group">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-primary">data_object</span>
                <span className="text-sm font-bold">Export JSON</span>
              </div>
              <span className="material-symbols-outlined text-slate-300 group-hover:text-primary transition-colors">download</span>
            </button>
            <button className="w-full bg-surface-container-lowest text-on-surface border border-transparent hover:border-primary/20 transition-all p-4 rounded-lg flex items-center justify-between group">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-primary">table_chart</span>
                <span className="text-sm font-bold">Export CSV</span>
              </div>
              <span className="material-symbols-outlined text-slate-300 group-hover:text-primary transition-colors">download</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
