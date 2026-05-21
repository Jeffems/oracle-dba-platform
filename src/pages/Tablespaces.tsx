import { useModuleStateStore } from '../stores/useModuleStateStore';

const templates = {
  list: `SELECT file_id, file_name, tablespace_name, bytes/1024/1024 MB
FROM dba_data_files
ORDER BY tablespace_name, file_id;`,
  add: `ALTER TABLESPACE USERS ADD DATAFILE 'D:\\ORACLE19\\APP\\ORACLE\\ORADATA\\ORCL19\\USERS02.DBF' SIZE 1G AUTOEXTEND ON;`,
  resize: `ALTER DATABASE DATAFILE 'D:\\ORACLE19\\APP\\ORACLE\\ORADATA\\ORCL19\\USERS02.DBF' RESIZE 2G;`
};

type TablespaceTemplateKey = keyof typeof templates;

export function Tablespaces() {
  const state = useModuleStateStore((store) => store.getTemplateState('tablespaces-simple-generator', {}, 'list'));
  const patchTemplateState = useModuleStateStore((store) => store.patchTemplateState);
  const tpl = (state.templateId || 'list') as TablespaceTemplateKey;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Gerador de Tablespaces</h2>
      <select
        className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-2"
        value={tpl}
        onChange={(e) => patchTemplateState('tablespaces-simple-generator', { templateId: e.target.value })}
      >
        <option value="list">Listar datafiles</option>
        <option value="add">Adicionar datafile</option>
        <option value="resize">Redimensionar datafile</option>
      </select>
      <pre className="rounded-2xl bg-slate-900 border border-slate-800 p-5 whitespace-pre-wrap">{templates[tpl]}</pre>
    </div>
  );
}
