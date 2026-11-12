import { useEffect, useState } from "react";

/**
 * A value that follows `value` only once it has stopped changing for `ms` - for acting on what someone has finished typing
 * (a search, a lookup) rather than on every keystroke on the way there.
 */
export function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}
