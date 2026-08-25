// Absichtlich knapp: Was hier steht, soll man beheben und nicht abschalten.
//
// Der eigentliche Grund für ESLint neben `tsc` sind die Hook-Regeln. `tsc`
// prüft Typen, aber nicht, ob ein `useEffect` eine Abhängigkeit vergisst –
// und genau das ist in einer App mit dutzenden Effekten die häufigste
// Fehlerquelle: Der Effekt läuft mit veralteten Werten, und niemand sieht
// warum.
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const hooks = require('eslint-plugin-react-hooks');

module.exports = tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.expo/**', 'targets/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': hooks },
    languageOptions: {
      globals: {
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        __DEV__: 'readonly',
      },
    },
    rules: {
      ...hooks.configs.recommended.rules,
      // `any` gibt es noch reichlich (siehe Vorschlag 41 der Werkbank).
      // Als Fehler würde die Regel heute nur betäuben; als Warnung zählt
      // sie mit und die Zahl kann sinken.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Ein leerer catch ist hier oft Absicht («kein Netz, egal») – aber
      // ein leerer if-Block nie.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Ab hier die Ausnahmen. Sie stehen bewusst am Schluss: In der flachen
  // Konfiguration gewinnt der letzte Treffer, und weiter oben hätten die
  // empfohlenen Regelsätze sie gleich wieder überschrieben.

  // Werkzeugdateien laufen in Node, nicht im Telefon: Dort sind require,
  // module und process richtig und kein Versehen.
  {
    files: ['*.config.js', 'scripts/**/*.{js,mjs}'],
    languageOptions: {
      globals: {
        require: 'readonly',
        module: 'writable',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        // Node kennt URL seit Jahren global – ohne diese Zeile hielt
        // ESLint `new URL(...)` in einem Skript für einen Tippfehler.
        URL: 'readonly',
      },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  // Nachladen erst bei Bedarf: haptics und widget holen native Module
  // absichtlich spät, damit die Web-Fassung sie nie anfasst.
  {
    files: ['src/lib/haptics.ts', 'src/lib/widget.ts'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  }
);
