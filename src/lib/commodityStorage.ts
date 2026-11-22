/**
 * Commodity rows (crude oil, gold, natural gas) can only be saved once the commodity migrations
 * (`20261112000000_commodity_instruments.sql`, then `20261113000000_natural_gas_instruments.sql`) have widened each
 * table's `instrument` CHECK. Until then Postgres rejects such a row with a check violation (23514) naming
 * `<table>_instrument_check` - and in one bulk upsert that rejects the whole batch, index rows included.
 * The Live Portfolio sync uses this to tell "the migration isn't applied yet" from any other failure.
 */

export class CommodityStorageMissingError extends Error {
  constructor() {
    super("commodity positions can't be saved until the commodity migration is applied.");
    this.name = "CommodityStorageMissingError";
  }
}

export function isInstrumentCheckError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "23514" && /instrument_check/i.test(error.message ?? "");
}
