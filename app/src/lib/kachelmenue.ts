/**
 * Was langes Drücken auf einer Kachel anbietet.
 *
 * Der Anlass: «Die Kacheln auf der Startseite bei Favoriten lassen sich
 * mit einem langen Drücken nicht umbenennen.» Umbenennen gab es nur im
 * Anpassen-Modus – drei Schritte entfernt von der Kachel, die man in der
 * Hand hat. Langes Drücken zeigte stattdessen den Verlauf, und bei einer
 * Kachel ohne Verlauf gar nichts.
 *
 * Herausgelöst aus dem Bildschirm, weil die Liste eine Entscheidung ist
 * und keine Darstellung: Was jemand darf und was zu diesem Gerät passt,
 * lässt sich prüfen – die Kachel selbst zieht die Symbolschriften von
 * Expo mit und ist für Jest deshalb nicht greifbar.
 */

export type KachelAktion = 'rename' | 'room' | 'favorite' | 'hide' | 'history';

export interface KachelEintrag {
  key: KachelAktion;
  label: string;
  /** Name eines Ionicons. */
  icon: string;
}

export function kachelAktionen({
  favorit,
  versteckt,
  mitVerlauf,
  darfBearbeiten,
}: {
  favorit: boolean;
  versteckt: boolean;
  /** Führt der Hub für dieses Gerät einen Verlauf? */
  mitVerlauf: boolean;
  /** Umbenennen und Raum ändern die Angaben für alle im Haus – das
   *  dürfen nicht alle. Ein Eintrag, der mit «keine Berechtigung»
   *  antwortet, wäre ein Knopf, der nichts tut. */
  darfBearbeiten: boolean;
}): KachelEintrag[] {
  const eintraege: KachelEintrag[] = [];
  // Umbenennen zuerst: Es ist das, wonach die Hand greift, wenn sie eine
  // Kachel lange hält.
  if (darfBearbeiten) {
    eintraege.push({ key: 'rename', label: 'Umbenennen', icon: 'pencil' });
    eintraege.push({ key: 'room', label: 'Raum wählen', icon: 'home-outline' });
  }
  eintraege.push({
    key: 'favorite',
    label: favorit ? 'Kein Favorit' : 'Favorit',
    icon: favorit ? 'star' : 'star-outline',
  });
  eintraege.push({
    key: 'hide',
    label: versteckt ? 'Wieder zeigen' : 'Ausblenden',
    icon: versteckt ? 'eye-outline' : 'eye-off-outline',
  });
  // Der Verlauf stand hier vorher allein – er bleibt, nur eine Zeile
  // tiefer. Bei einem Gerät ohne Verlauf wäre die Zeile eine Attrappe.
  if (mitVerlauf) {
    eintraege.push({ key: 'history', label: 'Verlauf', icon: 'stats-chart-outline' });
  }
  return eintraege;
}
