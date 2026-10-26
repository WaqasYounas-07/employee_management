import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

/* The react-hooks presets in this version ship a malformed `plugins` object
   (`{'0': ...}`), which flat config rejects. Registering the plugin directly
   and naming the rules sidesteps that, and is what the presets expand to. */
const reactHooksRules = {
  'react-hooks/rules-of-hooks': 'error',
  'react-hooks/exhaustive-deps': 'warn',
  'react-hooks/set-state-in-effect': 'error',
}

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [js.configs.recommended],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      ...reactHooksRules,
      'react-refresh/only-export-components': [
        'error',
        { allowConstantExport: true, allowCompoundComponents: true },
      ],
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    /* shadcn components export their cva variants next to the component, and
       context files export their hook next to the provider. Both are the
       intended shape of these files, not a refresh bug.

       Dialogs also reset their form state when `open` flips, and the auth
       provider seeds the session once on mount: deliberate syncs from a prop
       or an external system, which is what an effect is for. */
    files: [
      'src/components/ui/**/*.jsx',
      'src/features/**/*-dialog.jsx',
      // The kiosk syncs with a webcam stream and a capture timer: external
      // systems, which is precisely what an effect is for.
      'src/features/kiosk/kiosk-page.jsx',
      'src/features/auth/auth-context.jsx',
      'src/hooks/use-theme.jsx',
      'src/routes/index.jsx',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
