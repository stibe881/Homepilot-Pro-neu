// Die erste Zeile muss die erste bleiben: Sie spannt das Netz für
// Fehler, die beim Laden der Module passieren - also bevor irgendeine
// Komponente existiert, die sie zeigen könnte. Ein `import` weiter oben
// würde vorher ausgewertet und liefe daran vorbei (siehe
// src/lib/startfehler.tsx).
import {
  Startbild,
  Startwache,
  globalenFangInstallieren,
  notfallWurzel,
  startmarke,
} from './src/lib/startfehler';

import { registerRootComponent } from 'expo';
import React from 'react';

globalenFangInstallieren();
startmarke('JavaScript läuft');

// Erst zeichnen, dann laden - und nicht umgekehrt.
//
// Bisher lud diese Datei die App-Module sofort, vor dem ersten Bild.
// Ein `try` darum fängt Würfe - aber kein Hängen: Bleibt eine Anweisung
// auf Modulebene stecken, wird die Wurzel nie registriert, und der
// Bildschirm bleibt schwarz, ohne dass je ein Fehler existiert. Genau
// das war der Stand am 30. August, und keine Wache konnte ihn zeigen,
// weil auch die Wache erst nach dem Laden gezeichnet hätte.
//
// Deshalb steht jetzt zuerst das Startbild auf dem Bildschirm, und die
// App-Module kommen danach. Die zwei kurzen Wartezeiten sind Absicht:
// Die erste lässt das Bild tatsächlich auf den Schirm, die zweite malt
// die Etappe «Lade App-Module …» noch hinein. Friert das Bild mit
// dieser Zeile ein, hängt das Laden selbst - und bleibt der Bildschirm
// trotz allem schwarz, lief nicht einmal diese Datei, dann liegt es am
// Bündel oder an der nativen Hülle, nicht an unserem Code.
//
// Der Preis: Die Anweisungen auf Modulebene in App.tsx (Mitteilungs-
// Handler, Ortungs-Aufgabe) laufen einen Wimpernschlag später. Für
// Nachrichten und Ortungsereignisse ist das unerheblich - beide Wege
// halten Ereignisse, bis sich jemand anmeldet.
function Wurzel() {
  const [App, setApp] = React.useState<React.ComponentType | null>(null);
  React.useEffect(() => {
    let zwei: ReturnType<typeof setTimeout> | undefined;
    const eins = setTimeout(() => {
      startmarke('Lade App-Module …');
      zwei = setTimeout(() => {
        try {
          // `require` und nicht `import`: Ein `import` würde hochgezogen
          // und liefe vor dem ersten Bild - genau das soll er nicht mehr.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const geladen = require('./App').default as React.ComponentType;
          startmarke('App-Module geladen');
          setApp(() => geladen);
        } catch (fehler) {
          setApp(() => notfallWurzel(fehler));
        }
      }, 120);
    }, 60);
    return () => {
      clearTimeout(eins);
      if (zwei != null) clearTimeout(zwei);
    };
  }, []);
  if (App == null) return React.createElement(Startbild);
  return React.createElement(App);
}

// Die Startwache liegt über allem: Sie zeigt einen gefangenen fatalen
// Fehler als Notfallbildschirm und legt bei einem hängenden Start den
// Bericht über das Bild. createElement statt JSX, weil dies eine .ts ist.
function WurzelMitWache() {
  return React.createElement(Startwache, null, React.createElement(Wurzel));
}
registerRootComponent(WurzelMitWache);
