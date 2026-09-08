/**
 * Kein Fenster mit Eingabefeld ohne Platz für die Tastatur.
 *
 * Dieser Test liest die Quelldateien, nicht ihre Ausgabe - und das ist
 * Absicht. Der Fall dahinter (Punkt 265 der Werkbank): Punkt 11 hiess
 * «Kein KeyboardAvoidingView in der ganzen App» und galt als erledigt.
 * Gelöst war er aber nur an der einen Stelle, wo er damals auffiel
 * (components/TopStrip.tsx). Zwölf weitere Fenster mit Eingabefeldern
 * kamen danach dazu, jedes mit demselben Fehler - beim Erfassen eines
 * Gutscheins lag die Tastatur über Notiz und Link.
 *
 * Von Auge findet man das nie: Es fällt nur auf dem iPhone auf, nur bei
 * einem Fenster, das weit genug unten ein Feld hat, und nur, wenn
 * jemand dort wirklich tippt. Der Bündler merkt nichts, der Typprüfer
 * auch nicht - es ist kein Fehler, es fehlt nur etwas. Genau dafür ist
 * ein Test da, der zählt statt hinzusehen.
 *
 * Er wird rot, sobald jemand ein neues Fenster mit Eingabefeld baut und
 * den Tastaturplatz vergisst. Das ist der Sinn: Beim nächsten Formular
 * soll es nicht wieder auffallen, indem es jemanden ärgert.
 */
import fs from 'fs';
import path from 'path';

const QUELLE = path.join(__dirname, '..');

/** Alle .tsx der App - Tests selbst zählen nicht (rein, testbar). */
function dateien(ordner: string): string[] {
  return fs.readdirSync(ordner, { withFileTypes: true }).flatMap((eintrag) => {
    const voll = path.join(ordner, eintrag.name);
    if (eintrag.isDirectory()) return dateien(voll);
    if (!eintrag.name.endsWith('.tsx') || eintrag.name.includes('.test.')) return [];
    return [voll];
  });
}

/**
 * Fenster mit Eingabefeld, die der Tastatur keinen Platz machen
 * (rein, testbar).
 *
 * Grob abgegrenzt vom `<Modal` bis zum nächsten `</Modal>`: Für die
 * Frage «steckt in diesem Fenster ein Eingabefeld» reicht das, und ein
 * echter Parser wäre für eine Zeile Antwort zu viel Maschine. Ein
 * verschachteltes Modal fiele höchstens zugunsten der Sicherheit aus -
 * der Test meldete dann eines zu viel, nicht eines zu wenig.
 */
export function fensterOhnePlatz(inhalt: string): number {
  // Wer die Datei irgendwo abdeckt, hat sich Gedanken gemacht - dann
  // entscheidet nicht mehr dieser Test, sondern der Mensch.
  if (inhalt.includes('KeyboardAvoidingView') || inhalt.includes('Tastaturplatz')) {
    return 0;
  }
  let offen = 0;
  let ab = 0;
  for (;;) {
    const start = inhalt.indexOf('<Modal', ab);
    if (start === -1) break;
    const ende = inhalt.indexOf('</Modal>', start);
    if (ende === -1) break;
    if (inhalt.slice(start, ende).includes('<TextInput')) offen += 1;
    ab = ende + 1;
  }
  return offen;
}

describe('Platz für die Tastatur', () => {
  it('kein Fenster der App lässt ein Eingabefeld ohne Platz', () => {
    const schuldige = dateien(QUELLE)
      .filter((datei) => fensterOhnePlatz(fs.readFileSync(datei, 'utf-8')) > 0)
      .map((datei) => path.relative(QUELLE, datei));

    expect(
      schuldige.length === 0
        ? []
        : // Die Meldung sagt gleich, was zu tun ist - sonst sucht der
          // Nächste erst, was «Tastaturplatz» überhaupt ist.
          schuldige.concat(
            'In diesen Fenstern wird getippt, aber die Tastatur legt sich ' +
              'darüber. Den Inhalt des <Modal> in <Tastaturplatz> fassen ' +
              '(components/Tastaturplatz.tsx).'
          )
    ).toEqual([]);
  });

  it('erkennt ein Fenster mit Eingabefeld - und lässt die anderen in Ruhe', () => {
    // Der Nachweis, dass dieser Test wirklich misst: Ein Prüfstand, der
    // nie rot wird, ist keiner.
    const mitFeld = '<Modal visible={x}><TextInput value={n} /></Modal>';
    expect(fensterOhnePlatz(mitFeld)).toBe(1);
    // Ein Fenster ohne Eingabe braucht nichts.
    expect(fensterOhnePlatz('<Modal visible={x}><Text>Hallo</Text></Modal>')).toBe(0);
    // Und wer sich schon gekümmert hat, wird nicht gemahnt.
    expect(fensterOhnePlatz(`<Tastaturplatz>${mitFeld}</Tastaturplatz>`)).toBe(0);
    expect(
      fensterOhnePlatz(`<KeyboardAvoidingView>${mitFeld}</KeyboardAvoidingView>`)
    ).toBe(0);
  });
});
