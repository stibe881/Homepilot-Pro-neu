/**
 * Der lange Druck einer Kachel – auch dort, wo ein Knopf im Weg steht.
 *
 * Der lange Druck hängt an der Kachel selbst. Das genügt bei einer Lampe,
 * deren Fläche grösstenteils leer ist. Bei einem Schloss nicht: Dort
 * füllen «Aufschliessen» und «Auf + öffnen» fast die ganze Kachel, und
 * ein Druck auf einen Knopf erreicht die Kachel darunter nie – React
 * Native gibt die Geste an das innerste Element, das sie annimmt. Wer
 * lange auf sein Schloss drückte, bekam deshalb nichts.
 *
 * Statt den Griff an fünfzehn Knöpfen einzeln nachzuziehen, steht er
 * hier: Die Kachel legt ihn hin, und jeder Knopf, der ihn nehmen kann,
 * nimmt ihn. Ein Knopf, für den ein langer Druck etwas anderes bedeutet
 * (ein Regler, der Ein/Aus-Schalter), fragt ihn schlicht nicht ab.
 */
import React, { createContext, useContext } from 'react';

const KachelDruckContext = createContext<(() => void) | undefined>(undefined);

export function KachelDruck({
  wert,
  children,
}: {
  wert?: () => void;
  children: React.ReactNode;
}) {
  return <KachelDruckContext.Provider value={wert}>{children}</KachelDruckContext.Provider>;
}

/** Was ein langer Druck auf dieser Kachel tut – oder nichts. */
export function useKachelDruck(): (() => void) | undefined {
  return useContext(KachelDruckContext);
}
