export const PERFORMANCE_OVERVIEW_SQL = `
SELECT 'ACTIVE_SESSIONS' AS metric, COUNT(*) AS value, 'Sessões ativas' AS label
FROM v$session
WHERE status = 'ACTIVE' AND type = 'USER'
UNION ALL
SELECT 'BLOCKED_SESSIONS' AS metric, COUNT(*) AS value, 'Sessões bloqueadas' AS label
FROM v$session
WHERE blocking_session IS NOT NULL
UNION ALL
SELECT 'LOCKS' AS metric, COUNT(*) AS value, 'Locks em espera' AS label
FROM v$lock
WHERE block = 1 OR request > 0
UNION ALL
SELECT 'INVALID_OBJECTS' AS metric, COUNT(*) AS value, 'Objetos inválidos' AS label
FROM dba_objects
WHERE status = 'INVALID'
UNION ALL
SELECT 'TABLESPACE_USED_PCT' AS metric, ROUND(MAX(used_percent), 2) AS value, 'Maior uso de tablespace (%)' AS label
FROM dba_tablespace_usage_metrics
UNION ALL
SELECT 'LONG_OPS' AS metric, COUNT(*) AS value, 'Operações longas ativas' AS label
FROM v$session_longops
WHERE totalwork > 0 AND sofar < totalwork
`;

export const TOP_WAIT_EVENTS_SQL = `
SELECT * FROM (
  SELECT event, total_waits, ROUND(time_waited / 100, 2) AS seconds_waited
  FROM v$system_event
  WHERE wait_class <> 'Idle'
  ORDER BY time_waited DESC
) WHERE ROWNUM <= 8
`;

export const TOP_SQL_SQL = `
SELECT * FROM (
  SELECT sql_id,
         executions,
         ROUND(elapsed_time / 1000000, 2) AS elapsed_seconds,
         ROUND(cpu_time / 1000000, 2) AS cpu_seconds,
         SUBSTR(sql_text, 1, 120) AS sql_text
  FROM v$sql
  WHERE sql_text IS NOT NULL
  ORDER BY elapsed_time DESC
) WHERE ROWNUM <= 8
`;

export const TABLESPACE_USAGE_SQL = `
SELECT tablespace_name,
       ROUND(used_percent, 2) AS used_percent,
       tablespace_size,
       used_space
FROM dba_tablespace_usage_metrics
ORDER BY used_percent DESC
`;
