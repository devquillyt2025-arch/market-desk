/** Hands `blob` to the browser as a file download named `filename`. Client-only. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoked on the next tick: some browsers start the download after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** UTF-8 byte-order mark: without it Excel reads a UTF-8 CSV as ANSI and mangles ₹, —, ×. */
const UTF8_BOM = "﻿";

export function downloadCsvFile(filename: string, csv: string): void {
  downloadBlob(filename, new Blob([UTF8_BOM + csv], { type: "text/csv;charset=utf-8;" }));
}

export function downloadJsonFile(filename: string, data: unknown): void {
  downloadBlob(filename, new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
}
