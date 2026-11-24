/** The time, in whole seconds, ticking every second - for "updated 7 sec ago". 0 on the server and while the page hydrates (no time, no claim). */

import { useSyncExternalStore } from "react";

const subscribe = (onChange: () => void) => {
  const id = setInterval(onChange, 1000);
  return () => clearInterval(id);
};
const read = () => Math.floor(Date.now() / 1000) * 1000;
const readOnServer = () => 0;

export function useSecondClock(): number {
  return useSyncExternalStore(subscribe, read, readOnServer);
}
