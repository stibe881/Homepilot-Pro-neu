/**
 * Dimmen, ohne die Kachel zu öffnen.
 *
 * Den Regler gab es schon – aber nur, solange das Licht brennt. Wer eine
 * ausgeschaltete Lampe auf 30 % bringen wollte, tippte sie an (volle
 * Helligkeit), wartete auf die Kachel, zog den Balken zurück. Drei
 * Griffe für einen Wunsch, und der erste blendet.
 *
 * Ein Streichen quer über die Kachel macht daraus einen: Es fängt beim
 * jetzigen Wert an und ändert ihn um so viel, wie der Finger von der
 * Kachelbreite zurückgelegt hat. Relativ und nicht absolut, denn die
 * Kachel ist kein Regler: Bei absoluter Zuordnung spränge die Lampe
 * beim Aufsetzen des Fingers dorthin, wo man zufällig hingegriffen hat.
 *
 * Reines Rechnen – die Geste selbst steht in components/entity.
 */

/** Ab so vielen Punkten waagrechter Bewegung ist es ein Streichen und
 *  kein verwackelter Tipp. */
export const SCHWELLE = 10;

/** So viel steiler muss die Bewegung waagrecht als senkrecht sein, damit
 *  sie als Dimmen gilt. Sonst nimmt die Kachel jedes Scrollen an, das
 *  ein bisschen schräg beginnt – und die Seite klebt. */
export const WAAGRECHT = 1.6;

/** Kleinster Schritt, der an den Hub geht. Jeder Punkt Bewegung wäre ein
 *  Befehl je Bild, und die Bridge kommt nicht nach. */
export const SCHRITT = 3;

/**
 * Ist diese Bewegung ein Dimm-Streichen? (rein, testbar)
 *
 * Wird bei jedem Fingerzucken gefragt, solange noch niemand die Geste
 * beansprucht hat. Sagt sie nein, bleibt alles beim Alten – der Tipp
 * schaltet, das Scrollen scrollt.
 */
export function istWischen(dx: number, dy: number): boolean {
  return Math.abs(dx) >= SCHWELLE && Math.abs(dx) > Math.abs(dy) * WAAGRECHT;
}

/**
 * Die Helligkeit, die zu dieser Bewegung gehört (rein, testbar).
 *
 * `start` ist der Wert beim Aufsetzen des Fingers, `dx` die Strecke seit
 * dann, `breite` die Breite der Kachel. Eine ganze Kachelbreite ist der
 * ganze Bereich von 0 bis 100 – auf einer schmalen Kachel wird also
 * feiner gedimmt als auf einer breiten, und das ist richtig so: Der
 * Daumen legt dort auch weniger Weg zurück.
 *
 * Nie unter 1: Auf 0 zu streichen hiesse ausschalten, und dafür gibt es
 * den Tipp. Wer streicht, will Licht – nur weniger.
 */
export function helligkeitAus(start: number, dx: number, breite: number): number {
  if (!Number.isFinite(breite) || breite <= 0) return start;
  const roh = start + (dx / breite) * 100;
  return Math.max(1, Math.min(100, Math.round(roh)));
}

/**
 * Lohnt es, diesen Wert zu schicken? (rein, testbar)
 *
 * `null` als letzter Wert heisst: noch nichts geschickt, also ja. Sonst
 * erst ab einem spürbaren Schritt – und die 0 und die 100 immer, damit
 * die Enden sicher erreicht werden.
 */
export function lohntSenden(letzter: number | null, neuer: number): boolean {
  if (letzter === null) return true;
  if (neuer === 100 || neuer === 1) return neuer !== letzter;
  return Math.abs(neuer - letzter) >= SCHRITT;
}
