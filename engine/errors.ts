/**
 * BUILD_SPEC rule 1: a missing value is raised and logged, never estimated.
 *
 * `DataMissingError` carries enough structure for the caller to append a line
 * to `data/missing.log` without re-parsing a message string.
 */
export class DataMissingError extends Error {
  readonly table: string;
  readonly key: string;
  readonly context: string;

  constructor(table: string, key: string, context = "") {
    super(`Missing ${table} row for "${key}"${context ? ` (${context})` : ""}`);
    this.name = "DataMissingError";
    this.table = table;
    this.key = key;
    this.context = context;
  }

  /** One tab-separated line for `data/missing.log`. */
  toLogLine(timestamp: string): string {
    return [timestamp, this.table, this.key, this.context].join("\t");
  }
}
