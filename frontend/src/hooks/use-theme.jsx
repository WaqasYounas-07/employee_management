import { createContext, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext(null)
const STORAGE_KEY = 'ems.theme'

export function ThemeProvider({ children, defaultTheme = 'system' }) {
  const [theme, setTheme] = useState(
    () => localStorage.getItem(STORAGE_KEY) ?? defaultTheme,
  )

  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      root.classList.toggle('dark', dark)
    }

    apply()
    // Only follow the OS while the user has not picked a theme explicitly.
    if (theme !== 'system') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  const value = {
    theme,
    setTheme: (next) => {
      localStorage.setItem(STORAGE_KEY, next)
      setTheme(next)
    },
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside a ThemeProvider.')
  return context
}
