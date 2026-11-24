/**
 * The clock the commodity pages ask "is MCX open" with, in 30-second steps so a snapshot is stable between them. 0 on the server and
 * while the page hydrates: no time, no claim about the session.
 */

import { useSyncExternalStore } from "react";

const CLOCK_MS = 30_000;

const subscribe = (onChange: () => void) => {
  const id = setInterval(onChange, 10_000);
  return () => clearInterval(id);
};
const read = () => Math.floor(Date.now() / CLOCK_MS) * CLOCK_MS;
const readOnServer = () => 0;

export function useMcxClock(): number {
  return useSyncExternalStore(subscribe, read, readOnServer);
}
