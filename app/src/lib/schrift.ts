/**
 * Obergrenze fürs Mitwachsen mit der Systemschrift (Punkt 66 der Werkbank).
 *
 * allowFontScaling ist in React Native an – die App folgt der
 * Systemschrift also überall, und das soll so bleiben: Wer grosse
 * Schrift eingestellt hat, hat einen Grund. Nur die *engen* Stellen
 * brauchen eine Grenze: die Uhr der Kopfzeile, Chips, die Beschriftung
 * der Navigations-Leiste. Dort bricht bei 200 % nicht die Schrift,
 * sondern das Layout – Chips ragen aus der Zeile, die Leiste schiebt
 * den Inhalt weg.
 *
 * 1.6 heisst: Bis 160 % wächst auch das Enge mit (die gängigen Stufen
 * bis «gross» sind damit voll abgedeckt); die Extremstufen lassen die
 * engen Stellen stehen, während der Fliesstext weiter mitwächst.
 */
export const MAX_SCHRIFT = 1.6;
