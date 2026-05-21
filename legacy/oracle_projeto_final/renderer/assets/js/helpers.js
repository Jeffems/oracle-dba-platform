export function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
export function quote(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}
export function upper(id, fallback = "") {
  return (document.getElementById(id).value || fallback).trim().toUpperCase();
}
export function txt(id, fallback = "") {
  return (document.getElementById(id).value || fallback).trim();
}
export function num(id, fallback = 0) {
  return parseInt(document.getElementById(id).value || fallback, 10);
}
export function gbToMb(g) {
  return Math.round(g * 1024);
}
export function fmt(n) {
  return Number(n).toLocaleString("pt-BR");
}
export function toGb(mb) {
  return (mb / 1024).toFixed(2);
}

export function highlightBlock(text) {
  const kws = [
    "SELECT",
    "FROM",
    "WHERE",
    "ORDER BY",
    "GROUP BY",
    "HAVING",
    "CREATE",
    "ALTER",
    "DROP",
    "GRANT",
    "REVOKE",
    "TO",
    "ON",
    "ACCOUNT",
    "UNLOCK",
    "IDENTIFIED BY",
    "DEFAULT TABLESPACE",
    "TEMPORARY TABLESPACE",
    "PROFILE",
    "QUOTA",
    "UNLIMITED",
    "ADD",
    "DATAFILE",
    "SIZE",
    "AUTOEXTEND",
    "NEXT",
    "MAXSIZE",
    "DIRECTORY",
    "READ",
    "WRITE",
    "SHOW",
    "PARAMETER",
    "EXEC",
    "BEGIN",
    "END",
    "UNION ALL",
    "AND",
    "OR",
    "NOT",
    "AS",
    "IN",
    "BY",
    "IMPDP",
    "EXPDP",
    "CONNECT",
    "RESOURCE",
    "DBA",
    "SHUTDOWN",
    "STARTUP",
  ];
  let out = esc(text);
  out = out.replace(/--.*$/gm, (m) => `<span class="cm">${m}</span>`);
  out = out.replace(/\/\*[\s\S]*?\*\//g, (m) => `<span class="cm">${m}</span>`);
  out = out.replace(/'[^']*'/g, (m) => `<span class="str">${m}</span>`);
  out = out.replace(
    /\b\d+(?:\.\d+)?\b/g,
    (m) => `<span class="num">${m}</span>`,
  );
  kws
    .sort((a, b) => b.length - a.length)
    .forEach((k) => {
      const safe = k
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\s+/g, "\\s+");
      out = out.replace(
        new RegExp(`\\b${safe}\\b`, "gi"),
        (m) => `<span class="kw">${m}</span>`,
      );
    });
  out = out.replace(
    /\b([A-Za-z_][A-Za-z0-9_]*)(?=\s*\()/g,
    '<span class="fn">$1</span>',
  );
  return out;
}
export function setPre(id, text) {
  document.getElementById(id).innerHTML = highlightBlock(text);
}
export function copyPre(id, btn) {
  const raw = document.getElementById(id).textContent;
  navigator.clipboard.writeText(raw).then(() => {
    const old = btn.textContent;
    btn.textContent = "Copiado!";
    setTimeout(() => (btn.textContent = old), 1600);
  });
}
export function downloadPre(id, filename) {
  const raw = document.getElementById(id).textContent;
  const blob = new Blob([raw], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename || "script.sql";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}
