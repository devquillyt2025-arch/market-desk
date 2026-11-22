/** How the natural gas desk writes its figures - one place, so the hero, the cards and the positions all agree. */

import { formatINR, formatLevel } from "@/lib/format";
import { ageText } from "@/lib/natgasDesk";

export const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "-" : "");
/** "₹339.80" - an MCX price. Declared once and stable, as AnimatedNumber needs. */
export const rupees = (n: number) => `₹${formatLevel(n)}`;
export const signedRupees = (n: number) => `${sign(n)}₹${formatLevel(Math.abs(n))}`;
/** "$4.262" - a NYMEX price, to the three decimals it trades in. */
export const dollars = (n: number) => `$${n.toFixed(3)}`;
export const signedDollars = (n: number) => `${sign(n)}$${Math.abs(n).toFixed(3)}`;
/** A whole-rupee profit or loss with its sign: "+₹4,500", "-₹1,621". */
export const signedMoney = (n: number) => `${sign(Math.round(n))}${formatINR(Math.abs(n))}`;
/** A time still to come: "8h 50m", never "just now". */
export const until = (ms: number) => (ms < 60_000 ? "under a minute" : ageText(ms));
/** How old a price is, as a phrase: "10 min old", or "just now" for one under a minute old. */
export const old = (ms: number) => (ms < 60_000 ? "just now" : `${ageText(ms)} old`);
/** Minutes since midnight as a clock time: 1435 -> "23:55". */
export const clockText = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
