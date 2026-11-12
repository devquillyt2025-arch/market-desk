import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GROUP_TONES,
  hostOf,
  initialsOf,
  isFormDirty,
  isPublicHost,
  logoDisplaySize,
  logoSourcesFor,
  logoUrlFor,
  matchesQuery,
  normalizeUrl,
  orderGroupNames,
  toneForGroup,
} from "@/app/links/linkMeta";

describe("normalizeUrl", () => {
  it("adds https to a bare domain", () => {
    assert.equal(normalizeUrl("nseindia.com"), "https://nseindia.com/");
  });

  it("keeps a full URL, path and all", () => {
    assert.equal(normalizeUrl("  http://www.bseindia.com/markets  "), "http://www.bseindia.com/markets");
  });

  it("rejects empty and unusable input", () => {
    assert.equal(normalizeUrl(""), null);
    assert.equal(normalizeUrl("   "), null);
    assert.equal(normalizeUrl("not a url at all"), null);
  });
});

describe("hostOf", () => {
  it("drops the scheme, www and path", () => {
    assert.equal(hostOf("https://www.nseindia.com/option-chain"), "nseindia.com");
    assert.equal(hostOf("https://www.sebi.gov.in/"), "sebi.gov.in");
  });

  it("keeps meaningful subdomains", () => {
    assert.equal(hostOf("https://api.upstox.com/v2"), "api.upstox.com");
  });

  it("reads a half-typed address as typed instead of failing", () => {
    assert.equal(hostOf("sensibull.com/path"), "sensibull.com");
    assert.equal(hostOf(""), "");
  });
});

describe("initialsOf", () => {
  it("takes the first letters of the first two words", () => {
    assert.equal(initialsOf("NSE Option Chain"), "NO");
    assert.equal(initialsOf("India VIX"), "IV");
  });

  it("takes two letters from a single word", () => {
    assert.equal(initialsOf("SEBI"), "SE");
    assert.equal(initialsOf("x"), "X");
  });

  it("splits on punctuation too, and survives an empty name", () => {
    assert.equal(initialsOf("Exchange & Regulatory"), "ER");
    assert.equal(initialsOf("  "), "?");
  });
});

describe("toneForGroup", () => {
  it("gives the built-in groups a fixed colour", () => {
    assert.equal(toneForGroup("Market Data"), "var(--accent)");
    assert.equal(toneForGroup("Exchange & Regulatory"), "var(--info)");
  });

  it("always gives a custom group the same colour, whatever the case or spacing", () => {
    assert.equal(toneForGroup("Brokers"), toneForGroup("Brokers"));
    assert.equal(toneForGroup("Brokers"), toneForGroup("  brokers "));
  });

  it("only ever picks from the palette", () => {
    for (const name of ["My Links", "News", "Tools", "Charts", "x", "Research & Notes"]) {
      assert.ok((GROUP_TONES as readonly string[]).includes(toneForGroup(name)), name);
    }
  });

  it("spreads custom groups over more than one colour", () => {
    const tones = new Set(["My Links", "News", "Tools", "Charts", "Brokers", "Research", "Journals", "Learning"].map(toneForGroup));
    assert.ok(tones.size > 2);
  });
});

describe("matchesQuery", () => {
  const link = {
    label: "NSE Option Chain",
    description: "Live option chain for Nifty and Bank Nifty.",
    url: "https://www.nseindia.com/option-chain",
    group: "Market Data",
  };

  it("matches everything when nothing is typed", () => {
    assert.ok(matchesQuery(link, ""));
    assert.ok(matchesQuery(link, "   "));
  });

  it("looks in the name, the note, the site and the group, ignoring case", () => {
    assert.ok(matchesQuery(link, "option"));
    assert.ok(matchesQuery(link, "BANK NIFTY"));
    assert.ok(matchesQuery(link, "nseindia"));
    assert.ok(matchesQuery(link, "market data"));
  });

  it("needs every word to be there, in any order", () => {
    assert.ok(matchesQuery(link, "chain nse"));
    assert.ok(!matchesQuery(link, "chain sebi"));
  });

  it("copes with a link that has no note", () => {
    assert.ok(matchesQuery({ ...link, description: undefined }, "nse"));
    assert.ok(!matchesQuery({ ...link, description: undefined }, "nifty"));
  });
});

describe("orderGroupNames", () => {
  it("puts custom groups first and the built-ins last, each in its original order", () => {
    const built = ["Market Data", "Exchange & Regulatory"];
    assert.deepEqual(orderGroupNames(["Market Data", "Brokers", "Exchange & Regulatory", "News"], built), [
      "Brokers",
      "News",
      "Market Data",
      "Exchange & Regulatory",
    ]);
  });
});

describe("isFormDirty", () => {
  const opened = { label: "Sensibull", url: "https://web.sensibull.com/", description: "Option strategies", group: "My Links" };

  it("is clean when nothing was changed", () => {
    assert.equal(isFormDirty({ ...opened }, opened), false);
  });

  it("is dirty as soon as any field really differs", () => {
    assert.equal(isFormDirty({ ...opened, label: "Sensibull Pro" }, opened), true);
    assert.equal(isFormDirty({ ...opened, url: "https://web.sensibull.com/verified-by-sensibull" }, opened), true);
    assert.equal(isFormDirty({ ...opened, description: "" }, opened), true);
    assert.equal(isFormDirty({ ...opened, group: "Brokers" }, opened), true);
  });

  it("ignores stray spaces", () => {
    assert.equal(isFormDirty({ ...opened, label: "  Sensibull " }, opened), false);
    assert.equal(isFormDirty({ label: " ", url: "", description: "", group: "" }, { label: "", url: "", description: "", group: "" }), false);
  });

  it("treats typing into a blank add form as dirty", () => {
    assert.equal(isFormDirty({ label: "N", url: "", description: "", group: "" }, { label: "", url: "", description: "", group: "" }), true);
  });
});

describe("isPublicHost", () => {
  it("accepts ordinary public domains", () => {
    for (const host of ["nseindia.com", "sebi.gov.in", "pro.upstox.com", "in.tradingview.com", "WWW.Groww.IN", "xn--bcher-kva.example.org"]) {
      assert.ok(isPublicHost(host), host);
    }
  });

  it("refuses names on your own network, addresses, and anything half-typed", () => {
    for (const host of ["", "localhost", "192.168.1.5", "10.0.0.1", "router.local", "nas.lan", "intranet.corp", "not%20a%20url", "nse", "nseindia.", "nse india.com", "under_score.com", "site.c"]) {
      assert.ok(!isPublicHost(host), host);
    }
  });
});

describe("logoSourcesFor", () => {
  it("asks Google first, then DuckDuckGo, by host only", () => {
    const [google, ddg] = logoSourcesFor("pro.upstox.com");
    assert.ok(google.startsWith("https://t3.gstatic.com/faviconV2?"));
    assert.ok(google.includes("url=https%3A%2F%2Fpro.upstox.com&"));
    assert.equal(ddg, "https://icons.duckduckgo.com/ip3/pro.upstox.com.ico");
    assert.ok(!google.includes("/positions") && !ddg.includes("/positions"));
  });

  it("looks nothing up for a host that isn't public", () => {
    assert.deepEqual(logoSourcesFor("localhost"), []);
    assert.deepEqual(logoSourcesFor("192.168.0.10"), []);
    assert.deepEqual(logoSourcesFor(""), []);
  });
});

describe("logoDisplaySize", () => {
  it("never draws an icon larger than it really is, within 20-28px", () => {
    assert.equal(logoDisplaySize(16), 20);
    assert.equal(logoDisplaySize(24), 24);
    assert.equal(logoDisplaySize(32), 28);
    assert.equal(logoDisplaySize(180), 28);
  });
});

describe("logoUrlFor", () => {
  it("points the page at this app's own route, never at a third party", () => {
    assert.equal(logoUrlFor("nseindia.com"), "/api/logo?host=nseindia.com");
    assert.equal(logoUrlFor("  PRO.Upstox.com "), "/api/logo?host=pro.upstox.com");
  });

  it("gives nothing for a host that shouldn't be looked up", () => {
    assert.equal(logoUrlFor("localhost"), null);
    assert.equal(logoUrlFor("192.168.1.1"), null);
    assert.equal(logoUrlFor(""), null);
  });
});
