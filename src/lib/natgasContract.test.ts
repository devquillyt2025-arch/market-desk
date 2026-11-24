/** What a saved or requested contract may be, and what the dropdown shows for it. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseContractPref, shownContract } from "@/lib/natgasContract";

describe("parseContractPref", () => {
  it("accepts 'default', 'auto' and an Upstox MCX instrument key", () => {
    assert.equal(parseContractPref("default"), "default");
    assert.equal(parseContractPref("auto"), "auto");
    assert.equal(parseContractPref("MCX_FO|578249"), "MCX_FO|578249");
  });

  it("refuses everything else - the key is only ever an instrument key", () => {
    for (const bad of ["", "dec", "MCX_FO|", "MCX_FO|abc", "NSE_FO|123", "MCX_FO|123; drop table", "mcx_fo|1", " auto", 5, null, undefined, {}]) {
      assert.equal(parseContractPref(bad), null, JSON.stringify(bad));
    }
  });
});

describe("shownContract", () => {
  const listed = [{ key: "MCX_FO|1" }, { key: "MCX_FO|2" }];

  it("shows 'auto' as itself, a listed key as itself, and the default as the contract it turned out to be", () => {
    assert.equal(shownContract("auto", listed, "MCX_FO|2"), "auto");
    assert.equal(shownContract("MCX_FO|1", listed, "MCX_FO|2"), "MCX_FO|1");
    assert.equal(shownContract("default", listed, "MCX_FO|2"), "MCX_FO|2");
  });

  it("shows the default when the saved contract is no longer listed, so the dropdown never holds a value it has no option for", () => {
    assert.equal(shownContract("MCX_FO|999", listed, "MCX_FO|2"), "MCX_FO|2");
  });
});
