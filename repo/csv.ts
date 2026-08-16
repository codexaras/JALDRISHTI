/**
 * Minimal RFC-4180 CSV reader.
 *
 * Handles quoted fields, embedded commas, escaped quotes ("") and CRLF.
 * Lines whose first character is `#` are treated as comments and skipped, so
 * `/data` files can carry inline notes.
 */

export type Row = Record<string, string>;

export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  // Strip a UTF-8 BOM — Excel adds one and it silently corrupts the first header.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n") {
      record.push(field);
      rows.push(record);
      record = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    rows.push(record);
  }

  const usable = rows.filter(
    (r) => r.length > 0 && !(r.length === 1 && r[0].trim() === "") && !r[0].startsWith("#"),
  );
  if (usable.length === 0) return [];

  const header = usable[0].map((h) => h.trim());
  return usable.slice(1).map((cells) => {
    const row: Row = {};
    header.forEach((key, idx) => {
      row[key] = (cells[idx] ?? "").trim();
    });
    return row;
  });
}

/** Parse a required numeric cell. Throws rather than silently yielding NaN. */
export function num(row: Row, key: string, file: string, lineHint: string): number {
  const raw = row[key];
  if (raw === undefined || raw === "") {
    throw new Error(`${file}: missing required numeric column "${key}" at ${lineHint}`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${file}: column "${key}" is not a number ("${raw}") at ${lineHint}`);
  }
  return value;
}

/** Parse an optional numeric cell, falling back to `fallback` when blank. */
export function numOr(row: Row, key: string, fallback: number): number {
  const raw = row[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}
