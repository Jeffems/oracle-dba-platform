export type ScriptStatement = {
  index: number;
  statement: string;
  startLine: number;
  endLine: number;
};

/**
 * Divide um script SQL em comandos executáveis mantendo a linha inicial/final.
 * Mantém o mesmo comportamento do bridge Node para que o frontend consiga
 * mostrar a linha atual antes de cada comando ser enviado ao Oracle.
 */
export function splitSqlStatements(script: string): ScriptStatement[] {
  const statements: ScriptStatement[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let line = 1;
  let statementStartLine = 1;

  function pushStatement(endLine: number) {
    const text = current.trim();
    if (text) {
      statements.push({
        index: statements.length + 1,
        statement: text,
        startLine: statementStartLine,
        endLine
      });
    }
    current = '';
    statementStartLine = line;
  }

  for (let i = 0; i < script.length; i++) {
    const ch = script[i];
    const next = script[i + 1];

    if (!current.trim() && ch.trim()) statementStartLine = line;

    if (inLineComment) {
      current += ch;
      if (ch === '\n') {
        inLineComment = false;
        line++;
      }
      continue;
    }

    if (inBlockComment) {
      current += ch;
      if (ch === '\n') line++;
      if (ch === '*' && next === '/') {
        current += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }

    if (!inSingle && !inDouble) {
      if (ch === '-' && next === '-') {
        current += ch + next;
        i++;
        inLineComment = true;
        continue;
      }
      if (ch === '/' && next === '*') {
        current += ch + next;
        i++;
        inBlockComment = true;
        continue;
      }
    }

    if (ch === "'" && !inDouble) {
      current += ch;
      if (inSingle && next === "'") {
        current += next;
        i++;
      } else {
        inSingle = !inSingle;
      }
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (ch === ';' && !inSingle && !inDouble) {
      pushStatement(line);
      continue;
    }

    current += ch;
    if (ch === '\n') line++;
  }

  pushStatement(line);
  return statements.map((item, index) => ({ ...item, index: index + 1 }));
}
