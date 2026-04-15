export default function SideNav({ activePatData }) {
  if (!activePatData) return <aside className="hidden md:flex flex-col h-[calc(100vh-4rem)] w-64 p-4 gap-2 bg-slate-50 dark:bg-slate-950 sticky top-16"></aside>;
  
  return (
    <aside className="hidden md:flex flex-col h-[calc(100vh-4rem)] w-64 p-4 gap-2 bg-slate-50 dark:bg-slate-950 sticky top-16">
      <div className="mb-6 px-2 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-primary-container/20 flex items-center justify-center text-primary font-bold text-lg uppercase">
          {activePatData.name.substring(0,2)}
        </div>
        <div>
          <h3 className="text-sm font-bold text-on-surface">{activePatData.name}</h3>
          <p className="text-xs text-on-surface-variant">ID: {activePatData.id.substring(0,8).toUpperCase()}</p>
        </div>
      </div>
      <nav className="flex-1 flex flex-col gap-1">
        <a className="flex items-center gap-3 px-3 py-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900 transition-all duration-200 rounded-lg text-sm font-medium" href="#">
          <span className="material-symbols-outlined">clinical_notes</span> Outline
        </a>
        <a className="flex items-center gap-3 px-3 py-2 bg-white dark:bg-slate-900 text-sky-800 dark:text-sky-300 shadow-sm rounded-lg text-sm font-medium" href="#">
          <span className="material-symbols-outlined">biotech</span> Dashboard
        </a>
      </nav>
    </aside>
  );
}
