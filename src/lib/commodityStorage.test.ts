import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CommodityStorageMissingError, isInstrumentCheckError } from "@/lib/commodityStorage";

describe("isInstrumentCheckError", () => {
  it("recognises Postgres rejecting a commodity instrument", () => {
    assert.equal(
      isInstrumentCheckError({
        code: "23514",
        message: 'new row for relation "live_portfolio_entries" violates check constraint "live_portfolio_entries_instrument_check"',
      }),
      true,
    );
  });

  it("does not mistake other check violations or other failures for it", () => {
    assert.equal(
      isInstrumentCheckError({ code: "23514", message: 'new row ... violates check constraint "live_portfolio_entries_lots_check"' }),
      false,
    );
    assert.equal(isInstrumentCheckError({ code: "42501", message: "permission denied" }), false);
    assert.equal(isInstrumentCheckError({ message: "instrument_check" }), false);
    assert.equal(isInstrumentCheckError(null), false);
    assert.equal(isInstrumentCheckError(undefined), false);
  });
});

describe("CommodityStorageMissingError", () => {
  it("carries a message the sync banner can show as-is", () => {
    const e = new CommodityStorageMissingError();
    assert.ok(e instanceof Error);
    assert.equal(e.name, "CommodityStorageMissingError");
    assert.match(e.message, /migration/);
  });
});
