export type MaintenanceScript = {
  id: string;
  title: string;
  risk: 'Baixo' | 'Médio' | 'Alto';
  description: string;
  sql: string;
};

export const maintenanceScripts: MaintenanceScript[] = [
  {
    id: 'invalid-objects',
    title: 'Recompilar objetos inválidos',
    risk: 'Médio',
    description: 'Gera comandos ALTER para recompilar objetos inválidos. Execute primeiro em janela controlada.',
    sql: `SELECT 'ALTER ' || object_type || ' ' || owner || '.' || object_name || ' COMPILE;' AS comando
FROM dba_objects
WHERE status = 'INVALID'
  AND object_type IN ('VIEW', 'PROCEDURE', 'FUNCTION', 'PACKAGE', 'TRIGGER')
ORDER BY owner, object_type, object_name`
  },
  {
    id: 'blocking-sessions',
    title: 'Diagnosticar sessões bloqueadoras',
    risk: 'Baixo',
    description: 'Lista sessões bloqueadas e a sessão bloqueadora para análise antes de qualquer ação.',
    sql: `SELECT s.sid,
       s.serial#,
       s.username,
       s.status,
       s.event,
       s.blocking_session,
       s.seconds_in_wait,
       s.machine,
       s.program
FROM v$session s
WHERE s.blocking_session IS NOT NULL
ORDER BY s.seconds_in_wait DESC`
  },
  {
    id: 'kill-blocker-template',
    title: 'Gerar comando para matar sessão bloqueadora',
    risk: 'Alto',
    description: 'Apenas gera o comando ALTER SYSTEM KILL SESSION. Revise e execute manualmente.',
    sql: `SELECT DISTINCT 'ALTER SYSTEM KILL SESSION ''' || b.sid || ',' || b.serial# || ''' IMMEDIATE;' AS comando
FROM v$session s
JOIN v$session b ON b.sid = s.blocking_session
WHERE s.blocking_session IS NOT NULL`
  },
  {
    id: 'stats-stale',
    title: 'Objetos com estatísticas antigas',
    risk: 'Baixo',
    description: 'Identifica tabelas com estatísticas ausentes ou antigas para planejar coleta.',
    sql: `SELECT owner, table_name, num_rows, last_analyzed, stale_stats
FROM dba_tab_statistics
WHERE owner NOT IN ('SYS','SYSTEM')
  AND (last_analyzed IS NULL OR stale_stats = 'YES')
ORDER BY last_analyzed NULLS FIRST`
  },
  {
    id: 'recyclebin',
    title: 'Verificar recyclebin',
    risk: 'Baixo',
    description: 'Mostra espaço e objetos na lixeira antes de qualquer limpeza.',
    sql: `SELECT owner, object_name, original_name, type, can_undrop, can_purge, droptime
FROM dba_recyclebin
ORDER BY droptime DESC`
  }
];
