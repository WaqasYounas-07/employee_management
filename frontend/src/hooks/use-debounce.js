import { useEffect, useState } from 'react'

/** Delays a fast-changing value — used so typing in a search box does not
    fire a request per keystroke. */
export function useDebounce(value, delay = 350) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
