import { executeSingleStatement } from './oracleClient';
import { getCentralCommands, queueCentralScript, type CentralApiConfig } from './centralApiClient';
import type { OracleConnectionConfig, QueryResult } from '../types/oracle';
import type { ConnectionMode } from '../stores/useConnectionStore';

export type UnifiedExecutionInput = {
  mode: ConnectionMode;
  localConfig: OracleConnectionConfig;
  remoteConfig: CentralApiConfig;
  agentId: string;
  sql: string;
  allowDangerous?: boolean;
  timeoutMs?: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLikelyQuery(sql: string) {
  const cleaned = sql
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('--'))
    .join(' ')
    .trim()
    .toLowerCase();
  return cleaned.startsWith('select ') || cleaned.startsWith('with ');
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function looksLikeCsv(text: string) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim());
  return Boolean(firstLine && firstLine.includes(',') && firstLine.includes('"'));
}

function csvToResult(text: string): QueryResult | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^Session altered\.?$/i.test(line));

  if (lines.length < 1 || !looksLikeCsv(lines.join('\n'))) return null;

  const columns = parseCsvLine(lines[0]).map((column, index) => column || `COL_${index + 1}`);
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    columns.forEach((column, index) => {
      row[column] = values[index] ?? '';
    });
    return row;
  });

  return {
    ok: true,
    message: rows.length ? 'Consulta executada com sucesso.' : 'Consulta executada sem linhas retornadas.',
    rows,
    metaData: columns.map((name) => ({ name }))
  };
}

function outputToResult(sql: string, output?: string | null): QueryResult {
  const text = String(output || '').trim();

  if (!isLikelyQuery(sql)) {
    return { ok: true, message: text || 'Comando executado com sucesso.', rows: [], rowsAffected: 0 };
  }

  if (!text || text.toLowerCase().includes('consulta executada sem linhas')) {
    return { ok: true, message: 'Consulta executada sem linhas retornadas.', rows: [], metaData: [{ name: 'RESULTADO' }] };
  }

  const csvResult = csvToResult(text);
  if (csvResult) return csvResult;

  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^Session altered\.?$/i.test(line))
    .map((line) => ({ RESULTADO: line }));

  return {
    ok: true,
    rows,
    metaData: [{ name: 'RESULTADO' }],
    message: rows.length ? 'Consulta executada com sucesso.' : 'Consulta executada sem linhas retornadas.'
  };
}

export async function executeWithCurrentConnection(input: UnifiedExecutionInput): Promise<QueryResult> {
  if (input.mode === 'local') {
    return executeSingleStatement(input.localConfig, input.sql);
  }

  if (!input.remoteConfig.apiUrl.trim()) {
    return { ok: false, message: 'Configure a URL da API Central antes de executar remotamente.' };
  }

  if (!input.agentId.trim()) {
    return { ok: false, message: 'Selecione um Agent remoto antes de executar.' };
  }

  const queued = await queueCentralScript(input.remoteConfig, {
    agentId: input.agentId,
    sql: input.sql,
    allowDangerous: Boolean(input.allowDangerous),
    note: 'Criado pelo App Desktop v3.2.1'
  });

  if (!queued.ok || queued.blocked || !queued.command?.id) {
    return { ok: false, message: queued.message || 'Script não foi enfileirado pela API Central.' };
  }

  const commandId = queued.command.id;
  const started = Date.now();
  const timeoutMs = input.timeoutMs ?? 120000;

  while (Date.now() - started < timeoutMs) {
    await sleep(2000);
    const commands = await getCentralCommands(input.remoteConfig, input.agentId);
    const command = (commands.rows || []).find((row) => row.id === commandId);
    if (!command) continue;

    if (command.status === 'SUCCESS') {
      return outputToResult(input.sql, command.output);
    }

    if (command.status === 'FAILED') {
      return { ok: false, message: command.error || command.output || 'Comando remoto falhou.' };
    }
  }

  return { ok: false, message: 'Tempo limite aguardando retorno do Agent remoto. Verifique se o Agent está online.' };
}
