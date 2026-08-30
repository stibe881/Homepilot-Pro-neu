// Die erste Zeile muss die erste bleiben: Sie spannt das Netz für
// Fehler, die beim Laden der Module passieren - also bevor irgendeine
// Komponente existiert, die sie zeigen könnte. Ein `import` weiter oben
// würde vorher ausgewertet und liefe daran vorbei (siehe
// src/lib/startfehler.tsx).
import { Startwache, globalenFangInstallieren, notfallWurzel, startmarke } from './src/lib/startfehler';

import { registerRootComponent } from 'expo';
import React from 'react';

globalenFangInstallieren();
startmarke('JavaScript läuft');

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
startmarke('App-Module geladen');

// Die Startwache liegt über allem: Schluckt der globale Fang einen
// fatalen Fehler, blieb bisher ein schwarzer Bildschirm - React stand
// mitten im ersten Aufbau, und die Meldung lag nur in der Konsole. Die
// Wache tauscht dann die ganze Wurzel gegen den Notfallbildschirm.
// createElement statt JSX, weil diese Datei eine .ts ist.
function WurzelMitWache() {
  return React.createElement(Startwache, null, React.createElement(Wurzel));
}
registerRootComponent(WurzelMitWache);
