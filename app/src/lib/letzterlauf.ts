/**
 * Was beim letzten Update herauskam - auch wenn niemand zugeschaut hat.
 *
 * Der Fortschrittsbalken lebt nur, solange dieser Bildschirm offen ist,
 * und der Update-Dienst auf dem Server startet sich nach einem Update
 * selbst neu. Wer also auf «Update» drückt und die App weglegt, fand
 * danach nichts vor - weder ein «fertig» noch ein «gescheitert». Genau so
 * lief ein Haus tagelang auf einem alten Stand, während jeder Knopfdruck
 * nach Erfolg aussah.
 *
 * Der Dienst hält den Ausgang seit Neuem auf der Platte fest. Hier wird
 * daraus ein Satz.
 */

export interface LetzterLauf {
  state?: string | null;
  message?: string | null;
  detail?: string | null;
  warnings?: string[] | null;
  started_at?: number | null;
  finished_at?: number | null;
  ios?: boolean | null;
}

/** «vor 5 Min.» - für etwas Vergangenes, nicht für eine Dauer. */
export function vorWieLange(sekunden: number): string {
  if (!Number.isFinite(sekunden) || sekunden < 0) return 'gerade eben';
  if (sekunden < 90) return 'gerade eben';
  const minuten = Math.round(sekunden / 60);
  if (minuten < 60) return `vor ${minuten} Min.`;
  const stunden = Math.round(minuten / 60);
  if (stunden < 24) return `vor ${stunden} Std.`;
  return `vor ${Math.round(stunden / 24)} Tagen`;
}

/** Wie ernst die Meldung ist – und damit, in welcher Farbe sie steht.
 *
 * «Hinweis» ist nicht «Fehler»: Ein Lauf, der durchgelaufen ist, hat den
 * Hub erneuert. In Rot las sich das wie ein gescheitertes Update, und man
 * suchte nach einem Schaden, den es nicht gab. Dieselbe Abstufung wie bei
 * den Integrationen: gestört ist rot, eingeschränkt ist gelb.
 */
export type LaufArt = 'fehler' | 'hinweis';

/**
 * Der Satz zum letzten Lauf - oder null, wenn es nichts zu sagen gibt.
 *
 * Ein gelungener Lauf ohne Warnungen bleibt still: Die laufende Fassung
 * steht ohnehin unter dem Knopf, und eine Karte «alles gut» bei jedem
 * Öffnen wäre Lärm. Alles andere gehört gesagt.
 */
export function letzterLaufSatz(
  lauf: LetzterLauf | null | undefined,
  jetztSekunden: number
): { text: string; art: LaufArt } | null {
  if (!lauf || !lauf.state) return null;
  const warnungen = (lauf.warnings ?? []).filter(Boolean);
  const wann = lauf.finished_at ? vorWieLange(jetztSekunden - lauf.finished_at) : null;
  const kopf = wann ? `Letztes Update ${wann}` : 'Letztes Update';

  if (lauf.state === 'error') {
    return {
      art: 'fehler',
      text: [`${kopf}: fehlgeschlagen.`, lauf.message, lauf.detail]
        .filter(Boolean)
        .join('\n'),
    };
  }
  if (lauf.state === 'ok' && warnungen.length > 0) {
    // Durchgelaufen heisst durchgelaufen: Der Hub ist neu, etwas am Rand
    // blieb liegen. Das gehört vor die Augen, aber nicht in Rot.
    return {
      art: 'hinweis',
      text: [`${kopf}: durchgelaufen, aber mit Hinweisen:`, ...warnungen].join('\n'),
    };
  }
  if (lauf.state === 'running') {
    // Steht das noch nach einem Neustart des Dienstes da, ist der Lauf
    // nicht zu Ende gekommen - der Dienst wurde mittendrin abgeräumt.
    return {
      art: 'fehler',
      text: `${kopf}: nicht zu Ende gekommen. Der Bau wurde unterbrochen; bitte noch einmal auslösen.`,
    };
  }
  return null;
}
