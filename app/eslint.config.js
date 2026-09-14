// Absichtlich knapp: Was hier steht, soll man beheben und nicht abschalten.
//
// Der eigentliche Grund für ESLint neben `tsc` sind die Hook-Regeln. `tsc`
// prüft Typen, aber nicht, ob ein `useEffect` eine Abhängigkeit vergisst –
// und genau das ist in einer App mit dutzenden Effekten die häufigste
// Fehlerquelle: Der Effekt läuft mit veralteten Werten, und niemand sieht
// warum.
const fs = require('fs');
const path = require('path');
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const hooks = require('eslint-plugin-react-hooks');

// Dateien mit Schriftgrössen ausserhalb der Skala (Punkt 681 der
// Werkbank) - siehe schriftmass-ausnahmen.txt für die Begründung. Eine
// leere Zeile oder eine, die mit # beginnt, zählt nicht als Eintrag.
const SCHRIFTMASS_AUSNAHMEN = fs
  .readFileSync(path.join(__dirname, 'schriftmass-ausnahmen.txt'), 'utf8')
  .split('\n')
  .map((zeile) => zeile.trim())
  .filter((zeile) => zeile && !zeile.startsWith('#'));

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
      // Als Fehler, nicht als Warnung (Punkt 270 der Werkbank). Die
      // Zusage lautete «0 Fehler; Warnungen dürfen nicht mehr werden» -
      // nur zählt die niemand nach, und drei Stück standen jahrelang.
      // Sie waren echt: Ein Effekt ohne `hub` in den Abhängigkeiten
      // lief mit einem veralteten Griff, und `prefs.locked ?? []` war
      // je Rendern eine andere leere Liste, an der der ganze Baum
      // hing. Jetzt sind es null, und die Regel hält sie dort.
      'react-hooks/exhaustive-deps': 'error',
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
      // Schriftgrössen gehören in die Skala aus theme.tsx (`type`/`typ`),
      // nicht als eigene Zahl in eine Kachel (Punkt 681 der Werkbank,
      // analog zur padding-Regel aus Punkt 441). Für gewachsene Dateien
      // ausgeschaltet - siehe schriftmass-ausnahmen.txt und die
      // gleichnamige Ausnahme unten in dieser Datei.
      'no-restricted-syntax': [
        'error',
        {
          selector: "Property[key.name='fontSize'] > Literal",
          message:
            'Schriftgrösse gehört in die Skala (theme.tsx: type/typ), keine eigene Zahl - Punkt 681 der Werkbank.',
        },
      ],
    },
  },

  // Ab hier die Ausnahmen. Sie stehen bewusst am Schluss: In der flachen
  // Konfiguration gewinnt der letzte Treffer, und weiter oben hätten die
  // empfohlenen Regelsätze sie gleich wieder überschrieben.

  // Gewachsene Dateien: dieselbe Zahl steht dort schon, bevor es die
  // Regel gab. Wer eine Datei anfasst, räumt sie auf und streicht ihren
  // Namen aus schriftmass-ausnahmen.txt - danach greift die Regel auch
  // dort.
  {
    files: SCHRIFTMASS_AUSNAHMEN,
    rules: { 'no-restricted-syntax': 'off' },
  },

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

  // Nachladen erst bei Bedarf: haptics, widget und autoablage holen
  // native Module absichtlich spät, damit die Web-Fassung sie nie
  // anfasst.
  {
    files: ['src/lib/haptics.ts', 'src/lib/widget.ts', 'src/lib/autoablage.ts'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  }
);
