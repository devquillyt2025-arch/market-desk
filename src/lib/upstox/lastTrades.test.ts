import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseLastTradeTimes } from "@/lib/upstox/lastTrades";

describe("reading last trade times from a full-quotes response", () => {
  it("keys each time by the instrument's own token - the response's object key is Upstox's to reformat", () => {
    const body = {
      data: {
        "MCX_FO:GOLD26DECFUT": { instrument_token: "MCX_FO|113507", last_trade_time: "1795199087000", last_price: 121949 },
        "MCX_FO:CRUDEOIL26DECFUT": { instrument_token: "MCX_FO|114222", last_trade_time: "1795199100000" },
      },
    };
    const times = parseLastTradeTimes(body);
    assert.equal(times.get("MCX_FO|113507"), 1795199087000);
    assert.equal(times.get("MCX_FO|114222"), 1795199100000);
    assert.equal(times.size, 2);
  });

  it("leaves out a contract that has never traded (time 0) and anything that isn't a plausible time", () => {
    const times = parseLastTradeTimes({
      data: {
        a: { instrument_token: "MCX_FO|1", last_trade_time: "0" },
        b: { instrument_token: "MCX_FO|2" },
        c: { instrument_token: "MCX_FO|3", last_trade_time: "soon" },
        d: { instrument_token: "MCX_FO|4", last_trade_time: 12345 },
        e: { last_trade_time: "1795199087000" },
        f: null,
        g: { instrument_token: "MCX_FO|7", last_trade_time: "1795199087000" },
      },
    });
    assert.deepEqual([...times.keys()], ["MCX_FO|7"]);
  });

  it("is empty for a response without data", () => {
    assert.equal(parseLastTradeTimes(null).size, 0);
    assert.equal(parseLastTradeTimes({}).size, 0);
    assert.equal(parseLastTradeTimes({ data: "x" }).size, 0);
    assert.equal(parseLastTradeTimes({ data: [] }).size, 0);
  });
});
