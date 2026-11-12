/**
 * Crude oil and gold rows can only be saved once `20261112000000_commodity_instruments.sql` has widened each table's
 * `instrument` CHECK. Until then Postgres rejects such a row with a check violation (23514) naming
 * `<table>_instrument_check` - and in one bulk upsert that rejects the whole batch, index rows included.
 * The Live Portfolio sync uses this to tell "the migration isn't applied yet" from any other failure.
 */

export class CommodityStorageMissingError extends Error {
  constructor() {
    super("crude oil and gold positions can't be saved until the commodity migration is applied.");
    this.name = "CommodityStorageMissingError";
  }
}

export function isInstrumentCheckError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "23514" && /instrument_check/i.test(error.message ?? "");
}
