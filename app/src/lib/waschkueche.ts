/**
 * Die Türe, an der «ausgeräumt» abgelesen wird.
 *
 * Die Erinnerung «Waschmaschine ist noch voll» kam genau einmal. Wer sie
 * am Abend liegen liess, hörte nie wieder davon, und die Wäsche lag über
 * Nacht in der Trommel.
 *
 * Nachhaken darf der Hub nur, wenn es etwas gibt, das die Mahnungen auch
 * beendet – sonst schaltet man die ganze Regel ab, und dann fehlt auch
 * die erste. Die Maschinen selbst geben das Zeichen nicht her: Weder
 * V-Zug noch die Messsteckdose merken, ob die Trommel leer ist. Die Türe
 * der Waschküche merkt es.
 *
 * Die Regeln stehen im Hub (core/waschkueche.py); hier steht nur, wie
 * die Auswahl aussieht.
 */

export interface Kontakt {
  id: string;
  name: string;
  room?: string | null;
}

export interface Tuerstand {
  /** Was jemand gewählt hat – leer heisst «der Hub soll raten». */
  door: string | null;
  /** Was daraus folgt: die Türe, an der gerade gemessen wird. */
  using: string | null;
  /** Was der Hub raten würde. */
  guess: string | null;
  candidates: Kontakt[];
}

/** Name und Raum in einer Zeile (rein, testbar). */
export function kontaktName(kontakt: Kontakt): string {
  // Der Raum nur, wenn er nicht ohnehin im Gerätenamen steckt: «Türe
  // Waschküche · Waschküche» liest sich wie ein Fehler.
  const raum = (kontakt.room ?? '').trim();
  if (!raum || kontakt.name.toLowerCase().includes(raum.toLowerCase())) {
    return kontakt.name;
  }
  return `${kontakt.name} · ${raum}`;
}

/**
 * Die Auswahl in einer sinnvollen Reihenfolge (rein, testbar).
 *
 * Die geratene Türe zuerst: Sie ist in aller Regel die richtige, und wer
 * sie oben sieht, muss die übrigen gar nicht lesen.
 */
export function geordnet(stand: Tuerstand | null): Kontakt[] {
  const liste = [...(stand?.candidates ?? [])];
  liste.sort((a, b) => {
    if (a.id === stand?.guess) return -1;
    if (b.id === stand?.guess) return 1;
    return kontaktName(a).localeCompare(kontaktName(b), 'de');
  });
  return liste;
}

/** Die Türe, an der gerade gemessen wird (rein, testbar). */
export function gemessenAn(stand: Tuerstand | null): Kontakt | null {
  if (!stand?.using) return null;
  return stand.candidates.find((kontakt) => kontakt.id === stand.using) ?? null;
}

/**
 * Was diese Einstellung gerade bewirkt, in einem Satz (rein, testbar).
 *
 * Ohne Türe steht hier bewusst, was *nicht* passiert: Sonst sucht man
 * die versprochene Wiederholung und hält ihr Ausbleiben für einen
 * Fehler.
 */
export function tuerSatz(stand: Tuerstand | null): string {
  const tuer = gemessenAn(stand);
  if (!tuer) {
    return (
      'Kein Kontakt gewählt – es bleibt bei einer Nachricht je Programm. ' +
      'Mit einer Türe wird nachgehakt, bis jemand unten war.'
    );
  }
  const geraten = !stand?.door;
  return (
    `Gemessen an «${kontaktName(tuer)}»${geraten ? ' (selbst gefunden)' : ''}. ` +
    'Solange sie zu bleibt, kommt die Erinnerung stündlich wieder – ' +
    'höchstens viermal, nachts gar nicht.'
  );
}

/**
 * Was beim Antippen eines Eintrags gespeichert wird (rein, testbar).
 *
 * Ein zweites Antippen derselben Türe hebt die Wahl wieder auf – dann
 * rät der Hub. Ohne diesen Weg zurück käme man aus einer einmal
 * getroffenen Wahl nicht mehr heraus.
 */
export function naechsteWahl(stand: Tuerstand | null, id: string): string | null {
  return stand?.door === id ? null : id;
}
