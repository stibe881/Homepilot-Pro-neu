/**
 * Der Aufkleber, mit dem sich Besuch selbst einen WLAN-Code holt.
 *
 * Bisher konnte einen Gutschein nur ziehen, wer ein Konto hat: Der Gast
 * stand daneben und wartete, bis ihm jemand einen Code vorlas. Jetzt
 * hängt im Flur ein QR-Code; wer ihn scannt, landet auf einer Seite des
 * Hubs und holt sich seinen eigenen – zwölf Stunden gültig, einmal
 * einlösbar.
 *
 * Im Aufkleber steht **die Adresse und nicht der Code**: Ein Gutschein
 * im Aufkleber wäre einer für alle, und weil er einmalig ist, stünde
 * der Zweite vor einer toten Karte. Die Regeln dazu stehen im Hub
 * (core/wlanschein.py); hier steht nur, was die Karte anzeigt.
 */

export interface Aufkleberstand {
  /** Die Adresse, die in den QR-Code gehört. */
  url: string;
  /** Ob der Hub eine öffentliche Adresse kennt. */
  public: boolean;
  /** Ob überhaupt eine UniFi-Anbindung Gutscheine ausstellen kann. */
  unifi: boolean;
  /** Wie lange ein gezogener Code gilt. */
  hours: number;
  /** Die gerade offenen Codes, jüngster zuerst. */
  open: { code: string; left: string; drawn?: number }[];
}

/**
 * Was den Aufkleber daran hindert zu funktionieren – oder nichts (rein,
 * testbar).
 *
 * Beides sind Fälle, in denen er stumm im Flur hinge und niemand wüsste
 * warum. Der fehlende Controller wiegt schwerer: Ohne ihn gibt es gar
 * keine Gutscheine. Die fehlende öffentliche Adresse ist kein Fehler,
 * sondern eine Einschränkung – im Haus geht es, von unterwegs nicht.
 */
export function huerde(stand: Aufkleberstand | null): string | null {
  if (!stand) return null;
  if (!stand.unifi) {
    return (
      'Ohne die UniFi-Anbindung kann der Hub keine Gutscheine ausstellen – ' +
      'der Aufkleber führt dann auf eine Seite, die nichts hergibt.'
    );
  }
  if (!stand.public) {
    return (
      'Der Hub kennt seine Adresse von aussen nicht (push.public_url in der ' +
      'config.yaml). Der Aufkleber zeigt darum ins Hausnetz: Er wirkt am ' +
      'Wandpanel, aber nicht auf dem Telefon eines Gastes, der noch nicht ' +
      'verbunden ist.'
    );
  }
  return null;
}

/** Was der Aufkleber tut, in einem Satz (rein, testbar). */
export function aufkleberSatz(stand: Aufkleberstand | null): string {
  if (!stand) return '';
  return (
    `Wer diesen Code scannt, holt sich selbst einen WLAN-Gutschein: ` +
    `${stand.hours} Stunden gültig, einmal einlösbar.`
  );
}

/**
 * «3 Codes offen» – oder nichts, wenn keiner offen ist (rein, testbar).
 *
 * Die Zahl steht da, damit man merkt, wenn jemand den Aufkleber
 * abfotografiert hat und ihn seither jede Woche benutzt.
 */
export function offenSatz(stand: Aufkleberstand | null): string | null {
  const anzahl = stand?.open.length ?? 0;
  if (anzahl === 0) return null;
  return anzahl === 1 ? '1 Code offen' : `${anzahl} Codes offen`;
}
