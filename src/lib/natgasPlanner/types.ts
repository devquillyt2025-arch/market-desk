export type Side = "long" | "short";

/** One-minute (or any) candle; `t` is the start of the candle in UTC milliseconds. */
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

/** An N-minute bar built from candles. `t` is its start, `end` where it ends, `day` its IST date. */
export type Bar = Candle & {
  end: number;
  day: string;
  /** Finished: the next bin has started, or the session has closed. Only these ever signal. */
  complete: boolean;
};

/** A Heikin Ashi bar: its own open/high/low/close, and its colour (equal counts as red). */
export type HaBar = { t: number; o: number; h: number; l: number; c: number; green: boolean };

export type ExitStatus = "stop" | "target" | "eod";
