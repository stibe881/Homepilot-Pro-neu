import React from 'react';
import { KeyboardAvoidingView } from 'react-native';

import { kann } from '../lib/plattform';

/**
 * Macht der Tastatur Platz - für alles, was in einem Fenster getippt wird.
 *
 * Der Fall (Punkt 265 der Werkbank): Beim Erfassen eines Gutscheins lag
 * die Tastatur über Notiz und Link. Punkt 11 hatte das schon einmal
 * gelöst, aber nur an der einen Stelle, wo es damals auffiel
 * (components/TopStrip.tsx) - beim Nachzählen standen sechzehn weitere
 * Dateien mit Eingabefeldern in Fenstern da, jede mit demselben Fehler
 * und keine mit demselben Namen. Genau daran erkennt man ein Muster,
 * das eine Komponente sein sollte statt einer Zeile, die man an jeder
 * Stelle neu erfinden muss.
 *
 * Die eingebetteten Seiten (das Gutschein-Formular selbst, das
 * Rezept-Formular, der Ablauf-Editor) brauchen das hier nicht: Sie
 * hängen alle im einen Rollbereich der Startseite, und der schiebt
 * seinen Inhalt seit Punkt 265 selbst hoch
 * (`automaticallyAdjustKeyboardInsets` in DashboardScreen.tsx). Diese
 * Komponente ist für das, was *über* der Seite liegt und deshalb nicht
 * mitrollt.
 *
 * `behavior` nur auf iOS: Android schiebt von sich aus (adjustResize),
 * und im Browser gibt es das Problem gar nicht. Ein gesetztes
 * `behavior` auf Android staucht das Fenster stattdessen doppelt.
 */
export function Tastaturplatz({ children }: { children: React.ReactNode }) {
  return (
    <KeyboardAvoidingView
      behavior={kann.tastaturSchiebt ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      {children}
    </KeyboardAvoidingView>
  );
}
