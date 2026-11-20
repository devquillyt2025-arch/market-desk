/**
 * yyyy-mm-dd of the device's own calendar date, `daysAgo` days back from `now`. Local on purpose: `toISOString()` is
 * UTC, which in India is still *yesterday* between midnight and 5:30 am, so a date built from it is a day early - and
 * entry_date, closing_date and every window over them are typed and compared in local dates. One definition, so the
 * places that must agree (Reports' two cards, the Live Portfolio sync's "today") can't drift apart.
 */
export function localIsoDate(daysAgo = 0, now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
