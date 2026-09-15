/**
 * Text für einen Knopf, der erst auf den zweiten Tipp auslöst (Punkt 677
 * der Werkbank).
 *
 * Jeder Bildschirm formulierte die Nachfrage bisher für sich: mal mit
 * Fragezeichen, mal ohne («Wirklich löschen» neben «Wirklich löschen?»),
 * einmal sogar mit einem anderen Wort für dieselbe Handlung («Sicher?»
 * statt «Wirklich öffnen?» fürs Öffnen einer Türe in derselben Datei) -
 * und die Bedienungshilfe nannte oft eine dritte Fassung neben der
 * sichtbaren. Eine Nachfrage, die von Bildschirm zu Bildschirm anders
 * klingt, lernt man nicht als wiederkehrendes Muster: Der zweite Tipp
 * bleibt jedes Mal eine neue Frage statt einer bekannten Geste.
 */
export function zweiterTipp(basis: string, verb: string, aktiv: boolean): string {
  return aktiv ? `Wirklich ${verb}?` : basis;
}
