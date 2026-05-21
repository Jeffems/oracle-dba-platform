import { useModuleStateStore } from '../stores/useModuleStateStore';

const templates = {
  create: `CREATE USER usuario IDENTIFIED BY senha;
GRANT CONNECT, RESOURCE TO usuario;`,
  drop: `DROP USER usuario CASCADE;`,
  list: `SELECT username, account_status, created FROM dba_users ORDER BY username;`
};

type UserTemplateKey = keyof typeof templates;

export function Users() {
  const state = useModuleStateStore((store) => store.getTemplateState('users-simple-generator', {}, 'create'));
  const patchTemplateState = useModuleStateStore((store) => store.patchTemplateState);
  const tpl = (state.templateId || 'create') as UserTemplateKey;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Gerador de Usuários</h2>
      <select
        className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-2"
        value={tpl}
        onChange={(e) => patchTemplateState('users-simple-generator', { templateId: e.target.value })}
      >
        <option value="create">Criar usuário</option>
        <option value="drop">Remover usuário</option>
        <option value="list">Listar usuários</option>
      </select>
      <pre className="rounded-2xl bg-slate-900 border border-slate-800 p-5 whitespace-pre-wrap">{templates[tpl]}</pre>
    </div>
  );
}
