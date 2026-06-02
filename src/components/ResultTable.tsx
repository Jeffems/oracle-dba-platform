import type { QueryResult } from '../types/oracle';

export function ResultTable({ result }: { result?: QueryResult }) {
  if (!result) return null;

  if (!result.ok) {
    return <pre className="mt-4 whitespace-pre-wrap rounded-2xl border border-rose-800 bg-rose-950/40 p-4 text-rose-200">{result.message}</pre>;
  }

  const rows = Array.isArray(result.rows) ? result.rows : [];
  const columns = result.metaData?.map(m => m.name) ?? (rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0] as object) : []);

  return (
    <div className="mt-4 overflow-auto rounded-2xl border border-slate-800">
      {result.message && (
        <div className="border-b border-slate-800 bg-emerald-500/10 p-3 text-sm font-semibold text-emerald-200">
          {result.message}
        </div>
      )}
      {rows.length > 0 && columns.length > 0 ? (
        <table className="min-w-full text-sm">
          <thead className="bg-slate-900 text-slate-300">
            <tr>{columns.map(c => <th className="px-3 py-2 text-left" key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, i) => <tr key={i} className="border-t border-slate-800">{columns.map(c => <td className="whitespace-pre-wrap px-3 py-2" key={c}>{String((row as any)[c] ?? '')}</td>)}</tr>)}
          </tbody>
        </table>
      ) : (
        <div className="p-4 text-slate-400">{result.message || `Comando executado. Linhas afetadas: ${result.rowsAffected ?? 0}`}</div>
      )}
    </div>
  );
}
