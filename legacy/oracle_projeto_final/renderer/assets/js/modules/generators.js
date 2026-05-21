import {
  gbToMb,
  fmt,
  toGb,
  quote,
  upper,
  txt,
  num,
  setPre,
} from "../helpers.js";

export function computeMemory() {
  const ramGb = parseFloat(document.getElementById("totalRam").value) || 0;
  const pct = parseInt(document.getElementById("pctSlider").value, 10) || 0;
  const mode = document.getElementById("memoryMode").value;
  const allocGb = (ramGb * pct) / 100;
  const allocMb = gbToMb(allocGb);
  const freeGb = ramGb - allocGb;
  document.getElementById("pctLabel").textContent = pct;
  document.getElementById("s_total").textContent = `${fmt(ramGb)} GB`;
  document.getElementById("s_alloc").textContent = `${allocGb.toFixed(2)} GB`;
  document.getElementById("s_free").textContent = `${freeGb.toFixed(2)} GB`;
  document
    .getElementById("alertWarn")
    .classList.toggle("show", pct > 60 && pct <= 80);
  document.getElementById("alertDanger").classList.toggle("show", pct > 80);
  const fill =
    pct > 80 ? "var(--accent)" : pct > 60 ? "var(--yellow)" : "var(--accent2)";
  document.getElementById("pctSlider").style.background =
    `linear-gradient(to right, ${fill} 0%, ${fill} ${((pct - 5) / 85) * 100}%, var(--border2) ${((pct - 5) / 85) * 100}%, var(--border2) 100%)`;
  let rows = [],
    guideSql = "",
    step1Sql = "",
    step3Sql = "";
  if (mode === "AMM") {
    const memTarget = allocMb,
      memMaxTarget = Math.round(allocMb * 1.1);
    rows = [
      ["memory_max_target", memMaxTarget, "SPFILE"],
      ["memory_target", memTarget, "SPFILE"],
      ["sga_target", 0, "SPFILE"],
      ["pga_aggregate_target", 0, "SPFILE"],
    ];
    document.getElementById("memoryFile").textContent = "oracle_memory_amm.sql";
    step1Sql = `/* Etapa 1 - Gravar parâmetros no SPFILE (${mode}) */
ALTER SYSTEM SET memory_max_target = ${memMaxTarget}M SCOPE=SPFILE;
ALTER SYSTEM SET memory_target = ${memTarget}M SCOPE=SPFILE;
ALTER SYSTEM SET sga_target = 0 SCOPE=SPFILE;
ALTER SYSTEM SET pga_aggregate_target = 0 SCOPE=SPFILE;`;
    step3Sql = `/* Etapa 3 - Conferir parâmetros aplicados */
SELECT name, value, display_value
FROM v$parameter
WHERE name IN ('memory_target','memory_max_target','sga_target','pga_aggregate_target')
ORDER BY name;`;
    guideSql = `/* Oracle 19c - Memória (${mode}) */
/* Execute na ordem: */
/* 1) Etapa 1 - parâmetros */
/* 2) Etapa 2A - shutdown */
/* 3) Reconecte no banco */
/* 4) Etapa 2B - startup */
/* 5) Etapa 3 - conferência */`;
  } else {
    const sga = Math.round(allocMb * 0.75),
      sgaMax = Math.round(sga * 1.1),
      pga = Math.round(allocMb * 0.25);
    rows = [
      ["memory_max_target", 0, "SPFILE"],
      ["memory_target", 0, "SPFILE"],
      ["sga_max_size", sgaMax, "SPFILE"],
      ["sga_target", sga, "SPFILE"],
      ["pga_aggregate_target", pga, "SPFILE"],
    ];
    document.getElementById("memoryFile").textContent =
      "oracle_memory_asmm.sql";
    step1Sql = `/* Etapa 1 - Gravar parâmetros no SPFILE (${mode}) */
ALTER SYSTEM SET memory_max_target = 0 SCOPE=SPFILE;
ALTER SYSTEM SET memory_target = 0 SCOPE=SPFILE;
ALTER SYSTEM SET sga_max_size = ${sgaMax}M SCOPE=SPFILE;
ALTER SYSTEM SET sga_target = ${sga}M SCOPE=SPFILE;
ALTER SYSTEM SET pga_aggregate_target = ${pga}M SCOPE=SPFILE;`;
    step3Sql = `/* Etapa 3 - Conferir parâmetros aplicados */
SELECT name, value, display_value
FROM v$parameter
WHERE name IN ('memory_target','memory_max_target','sga_target','sga_max_size','pga_aggregate_target')
ORDER BY name;`;
    guideSql = `/* Oracle 19c - Memória (${mode}) */
/* Execute na ordem: */
/* 1) Etapa 1 - parâmetros */
/* 2) Etapa 2A - shutdown */
/* 3) Reconecte no banco */
/* 4) Etapa 2B - startup */
/* 5) Etapa 3 - conferência */`;
  }
  document.getElementById("memoryTable").innerHTML = rows
    .map(
      (r) =>
        `<tr><td class="param">${r[0]}</td><td>${r[1] === 0 ? '<span style="color:var(--text3)">0</span>' : fmt(r[1])}</td><td>${r[1] === 0 ? "—" : toGb(r[1]) + " GB"}</td><td>${r[2]}</td></tr>`,
    )
    .join("");
  setPre("memoryOutput", guideSql);
  setPre("memoryStep1Output", step1Sql);
  setPre("memoryStep2ShutdownOutput", "SHUTDOWN IMMEDIATE;");
  setPre("memoryStep2StartupOutput", "STARTUP;");
  setPre("memoryStep3Output", step3Sql);
}

export function renderUsers() {
  const tpl = document.getElementById("userTemplate").value;
  const u = upper("usr_name", "ERP"),
    p = txt("usr_pass", "ERP"),
    ts = upper("usr_ts", "USERS"),
    tt = upper("usr_temp", "TEMP");
  let text = "",
    help = "",
    file = "users.sql";
  if (tpl === "create") {
    file = "create_user_full.sql";
    help =
      "Criação completa com CREATE USER, grants CONNECT/RESOURCE/DBA, DBMS_CRYPTO e quota unlimited.";
    text = `/* comandos para criar usuário */

/* ---------------------------------------------------*/
/* Criando Usuário com Privilégios de DBA */
/* ---------------------------------------------------*/
CREATE USER ${u} IDENTIFIED BY ${p}
DEFAULT TABLESPACE ${ts}
TEMPORARY TABLESPACE ${tt}
PROFILE DEFAULT;

/* ---------------------------------------------------*/
/* Atribuindo Privilégios aos usuários */
/* ---------------------------------------------------*/
GRANT CONNECT, RESOURCE, DBA TO ${u};

GRANT EXECUTE ON SYS.DBMS_CRYPTO TO ${u};

ALTER USER ${u} QUOTA UNLIMITED ON ${ts};`;
  } else if (tpl === "drop_only") {
    file = "drop_user.sql";
    help = "Somente o comando DROP USER. Útil para limpeza antes da recriação.";
    text = `/* comandos para remover usuário */
DROP USER ${u} CASCADE;`;
  } else if (tpl === "create_only") {
    file = "create_user.sql";
    help =
      "Somente a criação do usuário com default tablespace, temporary tablespace e profile default.";
    text = `/* Criando Usuário */
CREATE USER ${u} IDENTIFIED BY ${p}
DEFAULT TABLESPACE ${ts}
TEMPORARY TABLESPACE ${tt}
PROFILE DEFAULT;`;
  } else if (tpl === "grant_only") {
    file = "grant_user_privs.sql";
    help = "Somente grants e quota para um usuário já criado.";
    text = `/* Atribuindo Privilégios aos usuários */
GRANT CONNECT, RESOURCE, DBA TO ${u};

GRANT EXECUTE ON SYS.DBMS_CRYPTO TO ${u};

ALTER USER ${u} QUOTA UNLIMITED ON ${ts};`;
  } else if (tpl === "reset") {
    file = "reset_password.sql";
    help = "Redefine a senha do usuário.";
    text = `ALTER USER ${u} IDENTIFIED BY ${p};`;
  } else if (tpl === "unlock") {
    file = "unlock_user.sql";
    help = "Desbloqueia conta e redefine a senha.";
    text = `ALTER USER ${u} IDENTIFIED BY ${p} ACCOUNT UNLOCK;

SELECT username, account_status, expiry_date
FROM dba_users
WHERE username = ${quote(u)};`;
  } else if (tpl === "expire") {
    file = "expire_user.sql";
    help = "Força troca de senha no próximo login.";
    text = `ALTER USER ${u} PASSWORD EXPIRE;`;
  } else if (tpl === "list") {
    file = "list_users.sql";
    help = "Lista usuários com status e tablespace padrão.";
    text = `SELECT username, account_status, default_tablespace, temporary_tablespace, profile
FROM dba_users
ORDER BY username;`;
  } else if (tpl === "privs") {
    file = "user_privileges.sql";
    help = "Consulta privilégios de role e grants de sistema do usuário.";
    text = `SELECT *
FROM dba_role_privs
WHERE grantee = ${quote(u)}
ORDER BY granted_role;

SELECT *
FROM dba_sys_privs
WHERE grantee = ${quote(u)}
ORDER BY privilege;`;
  }
  document.getElementById("usersFile").textContent = file;
  document.getElementById("usersHelp").textContent = help;
  setPre("usersOutput", text);
}

export function renderTablespaces() {
  const tpl = document.getElementById("tsTemplate").value;
  const ts = upper("ts_name", "USERS"),
    filePath = txt(
      "ts_file",
      "E:\\app\\Administrador\\oradata\\orcl\\USERS09.DBF",
    ),
    size = num("ts_size", 6),
    next = num("ts_next", 2),
    owner = upper("ts_owner", "ERP");
  let text = "",
    help = "",
    file = "tablespaces.sql";
  if (tpl === "users_list") {
    file = "users_list_datafiles.sql";
    help = "Lista os datafiles da tablespace informada.";
    text = `SELECT F.FILE_ID,
       F.FILE_NAME,
       F.TABLESPACE_NAME,
       ROUND(F.BYTES/1048576) AS SIZE_MB,
       ROUND(F.USER_BYTES/1048576) AS USER_MB,
       F.BLOCKS,
       F.AUTOEXTENSIBLE,
       F.INCREMENT_BY,
       ROUND(F.MAXBYTES/1048576) AS MAXSIZE_MB
FROM DBA_DATA_FILES F
WHERE F.TABLESPACE_NAME = ${quote(ts)}
ORDER BY F.FILE_ID;`;
  } else if (tpl === "users_metrics") {
    file = "users_tablespace_metrics.sql";
    help = "Mostra as métricas da tablespace informada.";
    text = `SELECT T.TABLESPACE_NAME,
       T.USED_SPACE,
       T.TABLESPACE_SIZE,
       T.USED_PERCENT
FROM DBA_TABLESPACE_USAGE_METRICS T
WHERE T.TABLESPACE_NAME = ${quote(ts)};`;
  } else if (tpl === "users_expand") {
    file = "users_expand_datafile.sql";
    help = "Adiciona um novo datafile na tablespace informada com autoextend.";
    text = `ALTER TABLESPACE ${ts} ADD DATAFILE ${quote(filePath)} SIZE ${size}G AUTOEXTEND ON NEXT ${next}G MAXSIZE UNLIMITED;`;
  } else if (tpl === "create_ts") {
    file = "create_tablespace.sql";
    help = "Cria uma tablespace nova com autoextend.";
    text = `CREATE TABLESPACE ${ts}\nDATAFILE ${quote(filePath)} SIZE ${size}G\nAUTOEXTEND ON NEXT ${next}G MAXSIZE UNLIMITED\nEXTENT MANAGEMENT LOCAL\nSEGMENT SPACE MANAGEMENT AUTO;\n\nSELECT tablespace_name, status, contents\nFROM dba_tablespaces\nWHERE tablespace_name = ${quote(ts)};`;
  } else if (tpl === "list_ts") {
    file = "list_tablespaces.sql";
    help = "Lista datafiles e tablespaces.";
    text = `SELECT tablespace_name, file_name, bytes/1024/1024 AS mb, autoextensible\nFROM dba_data_files\nORDER BY tablespace_name, file_name;`;
  } else if (tpl === "free_space") {
    file = "free_space.sql";
    help = "Mostra espaço livre por tablespace.";
    text = `SELECT df.tablespace_name,\n       ROUND(SUM(df.bytes)/1024/1024) AS total_mb,\n       ROUND(SUM(NVL(fs.bytes,0))/1024/1024) AS free_mb,\n       ROUND((SUM(df.bytes)-SUM(NVL(fs.bytes,0)))/1024/1024) AS used_mb\nFROM dba_data_files df\nLEFT JOIN dba_free_space fs ON df.tablespace_name = fs.tablespace_name\nGROUP BY df.tablespace_name\nORDER BY 1;`;
  } else if (tpl === "big_objects") {
    file = "largest_objects.sql";
    help = "Lista maiores objetos do owner informado.";
    text = `SELECT owner, segment_name, segment_type, bytes/1024/1024 AS mb\nFROM dba_segments\nWHERE owner = ${quote(owner)}\nORDER BY bytes DESC\nFETCH FIRST 30 ROWS ONLY;`;
  } else if (tpl === "nearly_full") {
    file = "tablespaces_nearly_full.sql";
    help = "Tablespaces com utilização alta.";
    text = `SELECT tablespace_name, used_percent, tablespace_size, used_space\nFROM dba_tablespace_usage_metrics\nWHERE used_percent >= 85\nORDER BY used_percent DESC;`;
  }
  document.getElementById("tsFileName").textContent = file;
  document.getElementById("tsHelp").textContent = help;
  setPre("tsOutput", text);
}

export function renderExpandDatafiles() {
  const tpl = document.getElementById("dfTemplate").value;
  const usersFile = txt(
    "df_users_file",
    "D:\\APP\\ADMINISTRADOR\\ORADATA\\ORCL\\USERS01.DBF",
  );
  const usersSize = num("df_users_size", 30);
  const usersNext = num("df_users_next", 1);
  const tempFile = txt(
    "df_temp_file",
    "D:\\APP\\ADMINISTRADOR\\ORADATA\\ORCL\\TEMP01.DBF",
  );
  const tempSize = num("df_temp_size", 1);
  const tempNext = num("df_temp_next", 256);
  const systemFile = txt(
    "df_system_file",
    "D:\\APP\\ADMINISTRADOR\\ORADATA\\ORCL\\SYSTEM01.DBF",
  );
  const systemSize = num("df_system_size", 6);
  const systemNext = num("df_system_next", 1);
  const openCursors = num("df_open_cursors", 2000);
  const processes = num("df_processes", 600);

  let text = "",
    help = "",
    file = "expandir_datafiles.sql";

  if (tpl === "full") {
    file = "expandir_datafiles_pack.sql";
    help =
      "Pacote completo com ajustes de parâmetros, perfil padrão e expansão de USERS, TEMP e SYSTEM.";
    text = `ALTER SYSTEM SET deferred_segment_creation=FALSE;
ALTER PROFILE DEFAULT LIMIT PASSWORD_LIFE_TIME UNLIMITED;
ALTER SYSTEM SET open_cursors=${openCursors} SCOPE=SPFILE;
ALTER SYSTEM SET processes=${processes} SCOPE=SPFILE;

ALTER DATABASE DATAFILE ${quote(usersFile)} RESIZE ${usersSize}G;
ALTER DATABASE DATAFILE ${quote(usersFile)} AUTOEXTEND ON NEXT ${usersNext}G MAXSIZE UNLIMITED;

ALTER DATABASE TEMPFILE ${quote(tempFile)} RESIZE ${tempSize}G;
ALTER DATABASE TEMPFILE ${quote(tempFile)} AUTOEXTEND ON NEXT ${tempNext}M MAXSIZE UNLIMITED;

ALTER DATABASE DATAFILE ${quote(systemFile)} RESIZE ${systemSize}G;
ALTER DATABASE DATAFILE ${quote(systemFile)} AUTOEXTEND ON NEXT ${systemNext}G MAXSIZE UNLIMITED;`;
  } else if (tpl === "params") {
    file = "expandir_datafiles_parametros.sql";
    help =
      "Somente os parâmetros e o ajuste de expiração de senha do perfil DEFAULT.";
    text = `ALTER SYSTEM SET deferred_segment_creation=FALSE;
ALTER PROFILE DEFAULT LIMIT PASSWORD_LIFE_TIME UNLIMITED;
ALTER SYSTEM SET open_cursors=${openCursors} SCOPE=SPFILE;
ALTER SYSTEM SET processes=${processes} SCOPE=SPFILE;`;
  } else if (tpl === "users") {
    file = "expandir_users01.sql";
    help = "Resize e autoextend do datafile USERS.";
    text = `ALTER DATABASE DATAFILE ${quote(usersFile)} RESIZE ${usersSize}G;
ALTER DATABASE DATAFILE ${quote(usersFile)} AUTOEXTEND ON NEXT ${usersNext}G MAXSIZE UNLIMITED;`;
  } else if (tpl === "temp") {
    file = "expandir_temp01.sql";
    help = "Resize e autoextend do tempfile TEMP.";
    text = `ALTER DATABASE TEMPFILE ${quote(tempFile)} RESIZE ${tempSize}G;
ALTER DATABASE TEMPFILE ${quote(tempFile)} AUTOEXTEND ON NEXT ${tempNext}M MAXSIZE UNLIMITED;`;
  } else if (tpl === "system") {
    file = "expandir_system01.sql";
    help = "Resize e autoextend do datafile SYSTEM.";
    text = `ALTER DATABASE DATAFILE ${quote(systemFile)} RESIZE ${systemSize}G;
ALTER DATABASE DATAFILE ${quote(systemFile)} AUTOEXTEND ON NEXT ${systemNext}G MAXSIZE UNLIMITED;`;
  }

  document.getElementById("dfFileName").textContent = file;
  document.getElementById("dfHelp").textContent = help;
  setPre("dfOutput", text);
}

export function renderImportExport() {
  const tpl = document.getElementById("ieTemplate").value;
  const dir = upper("ie_dir", "DATA_PUMP_DIR"),
    path = txt("ie_path", "E:\\backup\\oracle"),
    admin = txt("ie_admin", "system"),
    pass = txt("ie_admin_pass", "oracle"),
    svc = txt("ie_service", "orclpdb"),
    src = upper("ie_schema_src", "ERP_"),
    tgt = upper("ie_schema_tgt", "ERP_BASE"),
    dump = txt("ie_dump", "ERP_BASE.DMP"),
    log = txt("ie_log", "ERP_BASE.LOG"),
    parallel = num("ie_parallel", 8);
  let text = "",
    help = "",
    file = "datapump.sql";
  if (tpl === "dir_list") {
    file = "list_directories.sql";
    help = "Lista diretórios Oracle para Data Pump.";
    text = `SELECT *\nFROM dba_directories\nORDER BY directory_name;`;
  } else if (tpl === "dir_create") {
    file = "create_directory.sql";
    help = "Cria diretório e concede READ/WRITE.";
    text = `CREATE OR REPLACE DIRECTORY ${dir} AS ${quote(path)};\nGRANT READ, WRITE ON DIRECTORY ${dir} TO ${tgt};\n\nSELECT *\nFROM dba_directories\nWHERE directory_name = ${quote(dir)};`;
  } else if (tpl === "impdp") {
    file = "import_impdp.txt";
    help = "Comando clássico de importação com remap_schema.";
    text = `IMPDP ${admin}/${pass}@${svc} PARALLEL=${parallel} DUMPFILE=${dump} LOGFILE=${log} SCHEMAS=(${src}) REMAP_SCHEMA=(${src}:${tgt}) DIRECTORY=${dir}`;
  } else if (tpl === "expdp") {
    file = "export_expdp.txt";
    help = "Comando clássico de exportação.";
    text = `EXPDP ${admin}/${pass}@${svc} SCHEMAS=(${tgt}) DUMPFILE=${tgt}.DMP LOGFILE=${tgt}.LOG CONSISTENT=Y REUSE_DUMPFILES=Y DIRECTORY=${dir}`;
  } else if (tpl === "jobs") {
    file = "datapump_jobs.sql";
    help = "Consulta jobs do Data Pump.";
    text = `SELECT owner_name, job_name, operation, job_mode, state, attached_sessions\nFROM dba_datapump_jobs\nORDER BY owner_name, job_name;`;
  } else if (tpl === "rman") {
    file = "rman_history.sql";
    help = "Histórico de jobs RMAN.";
    text = `SELECT start_time, end_time, status, input_type, output_device_type\nFROM v$rman_backup_job_details\nORDER BY start_time DESC;`;
  }
  document.getElementById("ieFileName").textContent = file;
  document.getElementById("ieHelp").textContent = help;
  setPre("ieOutput", text);
}

export function renderSessions() {
  const tpl = document.getElementById("sessionTemplate").value;
  const sid = num("sess_sid", 123),
    serial = num("sess_serial", 4567),
    user = upper("sess_user", "ERP");
  let text = "",
    help = "",
    file = "sessions.sql";
  if (tpl === "active") {
    file = "active_sessions.sql";
    help = "Lista sessões ativas.";
    text = `SELECT sid, serial#, username, status, machine, program, event\nFROM v$session\nWHERE status = 'ACTIVE'\nORDER BY username, sid;`;
  } else if (tpl === "blocking") {
    file = "blocking_sessions.sql";
    help = "Mostra sessões bloqueando outras.";
    text = `SELECT blocking_session, sid, serial#, username, event\nFROM v$session\nWHERE blocking_session IS NOT NULL\nORDER BY blocking_session, sid;`;
  } else if (tpl === "locks") {
    file = "locks.sql";
    help = "Locks atuais por sessão/objeto.";
    text = `SELECT s.sid, s.serial#, s.username, o.object_name, l.type, l.lmode, l.request\nFROM v$lock l\nJOIN v$session s ON l.sid = s.sid\nLEFT JOIN dba_objects o ON l.id1 = o.object_id\nORDER BY s.sid;`;
  } else if (tpl === "kill") {
    file = "kill_session.sql";
    help = "Gera o comando para matar sessão.";
    text = `ALTER SYSTEM KILL SESSION '${sid},${serial}' IMMEDIATE;`;
  } else if (tpl === "inactive") {
    file = "inactive_sessions.sql";
    help = "Sessões inativas do usuário informado.";
    text = `SELECT sid, serial#, username, status, machine, logon_time\nFROM v$session\nWHERE status = 'INACTIVE'\n  AND username = ${quote(user)}\nORDER BY logon_time;`;
  }
  document.getElementById("sessionFileName").textContent = file;
  document.getElementById("sessionHelp").textContent = help;
  setPre("sessionOutput", text);
}

export function renderDiagnostic() {
  const tpl = document.getElementById("diagTemplate").value;
  const owner = upper("diag_owner", "ERP"),
    env = txt("diag_env", "ERP Produção");
  let text = "",
    help = "",
    file = "diagnostic.sql";
  if (tpl === "health") {
    file = "health_check.sql";
    help = "Health check geral em pacote único.";
    text = `/* Health Check - ${env} */\nSELECT name, open_mode, log_mode FROM v$database;\nSELECT instance_name, host_name, version, status FROM v$instance;\nSELECT tablespace_name, used_percent FROM dba_tablespace_usage_metrics ORDER BY used_percent DESC;\nSELECT owner, object_type, object_name FROM dba_objects WHERE status = 'INVALID' ORDER BY owner, object_type;\nSELECT sid, serial#, username, status FROM v$session WHERE status = 'ACTIVE' ORDER BY username;\nSELECT name, value FROM v$parameter WHERE name IN ('memory_target','memory_max_target','sga_target','sga_max_size','pga_aggregate_target') ORDER BY name;\nSELECT * FROM dba_directories ORDER BY directory_name;`;
  } else if (tpl === "invalid") {
    file = "invalid_objects.sql";
    help = "Objetos inválidos do owner informado.";
    text = `SELECT owner, object_type, object_name, status\nFROM dba_objects\nWHERE status = 'INVALID'\n  AND owner = ${quote(owner)}\nORDER BY object_type, object_name;`;
  } else if (tpl === "recompile") {
    file = "recompile_invalid.sql";
    help = "Recompilação serial dos objetos inválidos.";
    text = `EXEC UTL_RECOMP.RECOMP_SERIAL();`;
  } else if (tpl === "dbsize") {
    file = "database_size.sql";
    help = "Tamanho total do banco.";
    text = `SELECT ROUND(SUM(bytes)/1024/1024/1024,2) AS size_gb\nFROM dba_data_files;`;
  } else if (tpl === "schemasize") {
    file = "schema_sizes.sql";
    help = "Maiores schemas do banco.";
    text = `SELECT owner, ROUND(SUM(bytes)/1024/1024,2) AS mb\nFROM dba_segments\nGROUP BY owner\nORDER BY mb DESC;`;
  } else if (tpl === "params") {
    file = "main_parameters.sql";
    help = "Parâmetros principais do banco.";
    text = `SHOW PARAMETER memory;\nSHOW PARAMETER sga;\nSHOW PARAMETER pga;\n\nSELECT name, value\nFROM v$parameter\nWHERE name IN ('db_name','db_unique_name','service_names','open_cursors','processes')\nORDER BY name;`;
  }
  document.getElementById("diagFileName").textContent = file;
  document.getElementById("diagHelp").textContent = help;
  setPre("diagOutput", text);
}

export function renderErp() {
  const tpl = document.getElementById("erpTemplate").value;
  const user = upper("erp_user", "ERP_HIDRAUMAQ"),
    ts = upper("erp_ts", "USERS"),
    src = upper("erp_src", "ERP_"),
    dst = upper("erp_dst", "ERP_BASE");

  // Show/hide setup-specific fields
  const setupFields = document.getElementById("erp_setup_fields");
  if (setupFields) setupFields.style.display = tpl === "setupinicial" ? "" : "none";

  let text = "",
    help = "",
    file = "erp_preset.sql";

  if (tpl === "setupinicial") {
    file = "erp_setup_inicial.sql";
    help = "Setup inicial completo do banco: cria usuário ERP, expande tablespaces, ajusta parâmetros de sistema e cursores.";
    const oraPath = (document.getElementById("erp_ora_path")?.value || "E:\\Oracle19\\App\\Oracle\\oradata\\ORCL19").replace(/\\/g, "\\");
    const userPass = document.getElementById("erp_user_pass")?.value || "ERP";
    const cleanUser = upper("erp_user", "ERP");
    text = `/* ============================================================
   SETUP INICIAL DO BANCO ORACLE 19c
   Usuário: ${cleanUser} | Tablespace: ${ts}
   ============================================================ */

-- 1. Criar usuário ERP
CREATE USER ${cleanUser} IDENTIFIED BY ${userPass}
DEFAULT TABLESPACE ${ts}
TEMPORARY TABLESPACE TEMP
PROFILE DEFAULT;

GRANT CONNECT, RESOURCE, DBA TO ${cleanUser};
GRANT EXECUTE ON SYS.DBMS_CRYPTO TO ${cleanUser};

ALTER USER ${cleanUser} QUOTA UNLIMITED ON ${ts};

-- 2. Expandir Tablespace USERS (adicionar datafiles)
ALTER TABLESPACE ${ts} ADD DATAFILE '${oraPath}\\${ts}02.DBF'
  SIZE 1G AUTOEXTEND ON NEXT 1G MAXSIZE UNLIMITED;

ALTER TABLESPACE ${ts} ADD DATAFILE '${oraPath}\\${ts}03.DBF'
  SIZE 1G AUTOEXTEND ON NEXT 1G MAXSIZE UNLIMITED;

ALTER TABLESPACE ${ts} ADD DATAFILE '${oraPath}\\${ts}04.DBF'
  SIZE 1G AUTOEXTEND ON NEXT 1G MAXSIZE UNLIMITED;

ALTER TABLESPACE ${ts} ADD DATAFILE '${oraPath}\\${ts}05.DBF'
  SIZE 1G AUTOEXTEND ON NEXT 1G MAXSIZE UNLIMITED;

-- 3. Parâmetros de sistema
ALTER SYSTEM SET deferred_segment_creation=FALSE;
ALTER PROFILE DEFAULT LIMIT PASSWORD_LIFE_TIME UNLIMITED;
ALTER SYSTEM SET open_cursors=2000 SCOPE=SPFILE;
ALTER SYSTEM SET processes=600 SCOPE=SPFILE;

-- 4. Redimensionar datafile USERS01
ALTER DATABASE DATAFILE '${oraPath}\\${ts}01.DBF' RESIZE 30G;
ALTER DATABASE DATAFILE '${oraPath}\\${ts}01.DBF'
  AUTOEXTEND ON NEXT 1G MAXSIZE UNLIMITED;

-- 5. Ajustar TEMP
ALTER DATABASE TEMPFILE '${oraPath}\\TEMP01.DBF' RESIZE 1G;
ALTER DATABASE TEMPFILE '${oraPath}\\TEMP01.DBF'
  AUTOEXTEND ON NEXT 256M MAXSIZE UNLIMITED;

-- 6. Ajustar SYSTEM
ALTER DATABASE DATAFILE '${oraPath}\\SYSTEM01.DBF' RESIZE 6G;
ALTER DATABASE DATAFILE '${oraPath}\\SYSTEM01.DBF'
  AUTOEXTEND ON NEXT 1G MAXSIZE UNLIMITED;

-- ============================================================

-- ============================================================`;
  } else if (tpl === "install") {
    file = "erp_install_pack.sql";
    help = "Pacote base de implantação ERP.";
    text = `/* Implantação ERP */\nDROP USER ${user} CASCADE;\nCREATE USER ${user} IDENTIFIED BY ${user}\nDEFAULT TABLESPACE ${ts}\nTEMPORARY TABLESPACE TEMP\nPROFILE DEFAULT;\nGRANT CONNECT, RESOURCE, DBA TO ${user};\nGRANT EXECUTE ON SYS.DBMS_CRYPTO TO ${user};\nALTER USER ${user} QUOTA UNLIMITED ON ${ts};\n\nSELECT * FROM DBA_DIRECTORIES WHERE DIRECTORY_NAME = 'DATA_PUMP_DIR';\n\n-- Importação exemplo\nIMPDP system/oracle@orclpdb PARALLEL=8 DUMPFILE=${dst}.DMP LOGFILE=${dst}.LOG SCHEMAS=(${src}) REMAP_SCHEMA=(${src}:${dst}) DIRECTORY=DATA_PUMP_DIR;`;
  } else if (tpl === "postimport") {
    file = "erp_post_import_check.sql";
    help = "Checklist pós-importação.";
    text = `/* Pós-importação ERP */\nSELECT username, account_status FROM dba_users WHERE username = ${quote(user)};\nSELECT * FROM dba_role_privs WHERE grantee = ${quote(user)};\nSELECT * FROM dba_objects WHERE owner = ${quote(dst)} AND status = 'INVALID';\nSELECT * FROM dba_directories WHERE DIRECTORY_NAME = 'DATA_PUMP_DIR';\nSELECT tablespace_name, used_percent FROM dba_tablespace_usage_metrics ORDER BY used_percent DESC;\nSELECT name, value FROM v$parameter WHERE name IN ('service_names','open_cursors');`;
  } else if (tpl === "crypto") {
    file = "grant_crypto.sql";
    help = "Grant específico de DBMS_CRYPTO.";
    text = `GRANT EXECUTE ON SYS.DBMS_CRYPTO TO ${user};`;
  } else if (tpl === "healthpack") {
    file = "erp_health_pack.sql";
    help = "Pacote rápido de diagnóstico para suporte ERP.";
    text = `SELECT instance_name, version, status FROM v$instance;\nSELECT sid, serial#, username, status, machine FROM v$session WHERE status='ACTIVE' ORDER BY username;\nSELECT tablespace_name, used_percent FROM dba_tablespace_usage_metrics ORDER BY used_percent DESC;\nSELECT owner, object_type, object_name FROM dba_objects WHERE status='INVALID' AND owner = ${quote(dst)};\nSELECT start_time, status, input_type FROM v$rman_backup_job_details ORDER BY start_time DESC;`;
  } else if (tpl === "checklist") {
    file = "erp_checklist.txt";
    help = "Checklist operacional/técnico.";
    text = `[ ] Oracle instalado\n[ ] Listener respondendo\n[ ] Service name validado\n[ ] Usuário ERP criado\n[ ] Tablespace ${ts} pronta\n[ ] DATA_PUMP_DIR validado\n[ ] Importação executada\n[ ] Objetos inválidos recompilados\n[ ] DBMS_CRYPTO concedido\n[ ] Backup/RMAN validado\n[ ] Health check final executado`;
  }
  document.getElementById("erpFileName").textContent = file;
  document.getElementById("erpHelp").textContent = help;
  setPre("erpOutput", text);
}

export function initGenerators() {
  document.getElementById("totalRam")?.addEventListener("input", computeMemory);
  document
    .getElementById("pctSlider")
    ?.addEventListener("input", computeMemory);
  computeMemory();
  renderUsers();
  renderTablespaces();
  renderExpandDatafiles();
  renderImportExport();
  renderSessions();
  renderDiagnostic();
  renderErp();
}
