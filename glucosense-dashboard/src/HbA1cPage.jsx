export default function HbA1cPage({ activePatData }) {
  if (!activePatData) return <div className="text-center font-bold text-slate-500 mt-10">Please select a patient in settings.</div>;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 font-inter">
      <div className="xl:col-span-8 flex flex-col gap-6">
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center min-h-[400px]">
          <div className="text-center space-y-4">
            <h2 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-200">Metabolic Insights</h2>
            <p className="text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Estimated HbA1c features are being updated for the Minimal version. This page will display continuous metabolic forecasting based on incoming PPG scan data over the 30-day window.
            </p>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-4 w-full max-w-md">
             <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl border border-slate-100 dark:border-slate-700 text-center">
                 <div className="text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">Avg Glucose</div>
                 <div className="text-2xl font-black text-slate-700 dark:text-slate-300">--</div>
             </div>
             <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl border border-slate-100 dark:border-slate-700 text-center">
                 <div className="text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">Est. HbA1c</div>
                 <div className="text-2xl font-black text-slate-700 dark:text-slate-300">--%</div>
             </div>
          </div>
        </div>
      </div>
      <div className="xl:col-span-4 flex flex-col gap-6">
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-100 dark:border-slate-800">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 border-b border-slate-100 dark:border-slate-800 pb-3">Clinical Metrics</h3>
          <div className="space-y-4">
               <div>
                  <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-500">TIR (70-180 mg/dL)</span>
                      <span className="font-bold text-slate-700 dark:text-slate-300">--%</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5"><div className="bg-green-500 h-1.5 rounded-full w-0"></div></div>
               </div>
          </div>
        </div>
      </div>
    </div>
  );
}
