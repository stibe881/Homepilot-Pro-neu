/**
 * Was auf einer Storen-Kachel steht – und ob der Hub es überhaupt weiss.
 *
 * Der Fall aus dem Haus: «Die Storen haben den Status offen, obwohl sie
 * geschlossen sind.» Die Rechnung dahinter war eine Vermutung, die sich
 * als Tatsache ausgab:
 *
 *     const reported = typeof pos === 'number' ? pos
 *       : state === 'closed' ? 0 : state === 'partial' ? 50 : 100;
 *
 * Alles, was nicht ausdrücklich «zu» oder «halb» war, wurde 100 – auch
 * `unknown`. Eine Somfy-RTS-Store funkt aber nur in eine Richtung: Sie
 * nimmt Befehle und meldet nie zurück. Der Hub wusste also nichts, und
 * die App schrieb «Offen» darüber.
 *
 * Jetzt gibt es drei Fälle statt zwei, und der dritte heisst «weiss ich
 * nicht». Der Hub liefert dazu `angenommen`, wenn die Angabe aus dem
 * letzten Befehl stammt statt aus einer Meldung des Geräts.
 */

export interface Storenstand {
  /** Wie weit offen, für die Grafik. `null`: unbekannt. */
  position: number | null;
  /** Was auf der Plakette steht. */
  text: string;
  /** Stammt die Angabe aus dem letzten Befehl statt vom Gerät? */
  angenommen: boolean;
}

/** Der Text zu einer bekannten Position (rein, testbar). */
export function positionText(offen: number): string {
  if (offen <= 1) return 'Geschlossen';
  if (offen >= 99) return 'Offen';
  return `${offen}% offen`;
}

/**
 * Was der Hub über diese Store sagt (rein, testbar).
 *
 * `position` sticht `state`: Eine Zahl ist genauer als ein Wort. Fehlt
 * sie, taugen «closed» und «partial» noch als grobe Auskunft – alles
 * andere ist keine.
 */
export function storenstand(state: Record<string, unknown>): Storenstand {
  const angenommen = state.angenommen === true;
  const pos = state.position;
  if (typeof pos === 'number' && Number.isFinite(pos)) {
    const offen = Math.max(0, Math.min(100, Math.round(pos)));
    return { position: offen, text: positionText(offen), angenommen };
  }
  const wort = String(state.state ?? '');
  if (wort === 'closed') return { position: 0, text: 'Geschlossen', angenommen };
  if (wort === 'open') return { position: 100, text: 'Offen', angenommen };
  if (wort === 'partial') return { position: 50, text: 'Halb offen', angenommen };
  // Der Fall, um den es ging. Lieber zugeben als raten.
  return { position: null, text: 'Stand unbekannt', angenommen: false };
}

/** Die Zeile unter der Plakette – oder nichts (rein, testbar). */
export function herkunftText(stand: Storenstand): string | null {
  if (stand.position === null) {
    return 'Diese Store meldet ihren Stand nicht zurück. Nach dem nächsten Auf oder Zu steht hier, was zuletzt gefahren wurde.';
  }
  if (stand.angenommen) return 'Angenommen aus dem letzten Befehl – die Store meldet nicht zurück.';
  return null;
}
