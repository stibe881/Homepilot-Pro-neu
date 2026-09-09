/**
 * Liegt eine nachgeladene Fassung bereit – und was sagt man dazu?
 *
 * Der Fall aus dem Haus: «Ich habe soeben das Update gemacht. Trotzdem
 * steht noch dies.» Es war auch alles richtig gelaufen – der Hub war
 * neu, die OTA-Fassung veröffentlicht. Nur holt ein Telefon sie erst
 * beim nächsten Öffnen der App und führt sie erst beim *übernächsten*
 * Start aus (so steht es auch im Log von deploy/rebuild-hub.sh). Wer
 * dazwischen hinsieht, sieht den alten Stand und hält das Update für
 * gescheitert.
 *
 * Zweimal die App wegwischen ist keine Bedienung, die man erraten kann.
 * Also sagt die System-Seite jetzt, was los ist, und übernimmt die
 * bereitliegende Fassung auf Wunsch sofort.
 */

export type OtaLage =
  /** Eine Fassung ist geholt und wartet auf den nächsten Start. */
  | 'bereit'
  /** Es gibt eine neuere, sie ist aber noch nicht geholt. */
  | 'neu'
  /** Nichts Neues da. */
  | 'aktuell'
  /** Noch nicht nachgefragt, oder die Frage ging schief. */
  | 'offen';

export interface OtaStand {
  /** `Updates.isUpdatePending` – geholt, wartet auf den Neustart. */
  bereit: boolean;
  /** Die Nachfrage bei EAS meldete eine neuere Fassung. */
  verfuegbar: boolean;
  /** Die Nachfrage ist durch (egal mit welchem Ergebnis). */
  gefragt: boolean;
}

/** Woran man ist (rein, testbar). */
export function otaLage(stand: OtaStand): OtaLage {
  // «Bereit» schlägt alles: Wenn schon etwas daliegt, ist die Frage
  // «gibt es Neues?» beantwortet, egal was die Nachfrage sagte.
  if (stand?.bereit) return 'bereit';
  if (!stand?.gefragt) return 'offen';
  return stand.verfuegbar ? 'neu' : 'aktuell';
}

export interface OtaZeile {
  text: string;
  /** Beschriftung des Knopfs – `null` heisst: kein Knopf. */
  knopf: string | null;
}

/**
 * Was auf der System-Seite steht (rein, testbar).
 *
 * «Aktuell» bekommt bewusst einen Satz und keinen Knopf: Wer gerade ein
 * Update gemacht hat, sucht die Bestätigung, dass er nichts mehr tun
 * muss - und findet sonst nur die Abwesenheit einer Meldung, die
 * genauso gut ein Fehler sein könnte.
 */
export function otaZeile(lage: OtaLage): OtaZeile {
  switch (lage) {
    case 'bereit':
      return {
        text:
          'Eine nachgeladene Fassung liegt bereit. Sie käme von selbst beim ' +
          'übernächsten Start – oder jetzt.',
        knopf: 'Jetzt übernehmen',
      };
    case 'neu':
      return {
        text: 'Es gibt eine neuere Fassung. Holen dauert ein paar Sekunden.',
        knopf: 'Holen und übernehmen',
      };
    case 'aktuell':
      return { text: 'Die App führt den neusten veröffentlichten Stand aus.', knopf: null };
    default:
      return { text: '', knopf: null };
  }
}
