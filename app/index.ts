// Die erste Zeile muss die erste bleiben: Sie spannt das Netz für
// Fehler, die beim Laden der Module passieren - also bevor irgendeine
// Komponente existiert, die sie zeigen könnte. Ein `import` weiter oben
// würde vorher ausgewertet und liefe daran vorbei (siehe
// src/lib/startfehler.tsx).
import { globalenFangInstallieren, notfallWurzel } from './src/lib/startfehler';

import { registerRootComponent } from 'expo';

globalenFangInstallieren();

// `require` und nicht `import`: Ein `import` wird hochgezogen und liefe
// ausserhalb dieses `try`. Genau das ist der Fall, den wir fangen wollen
// - eine App, die sich schon beim Laden verschluckt und wortlos schliesst.
let Wurzel: React.ComponentType;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Wurzel = require('./App').default;
} catch (fehler) {
  Wurzel = notfallWurzel(fehler);
}

registerRootComponent(Wurzel);
