// RFC 4180 CSV for export and import runs. No dependency: the format is small and fixed.

type Cell = string | number | boolean | Date | null | undefined;

/** One cell. A text cell that a spreadsheet would run as a formula gets a leading quote. */
function cell(value: Cell) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string") return String(value);
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** CSV lines with CRLF ends; the first row of a file is its header. */
export const csvLines = (rows: readonly Cell[][]) =>
  rows.map((row) => row.map(cell).join(",") + "\r\n").join("");

/**
 * Parses a CSV document into rows of fields. Accepts LF or CRLF, quoted fields with embedded
 * commas, quotes and line breaks, and a leading byte-order mark. Throws on an unclosed quote.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.startsWith("﻿") ? text.slice(1) : text;
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted) {
      if (char !== '"') field += char;
      else if (input[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (quoted) throw new Error("A quoted field is not closed");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Blank lines carry no record.
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}
