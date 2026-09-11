/**
 * Die Browser-Probe: messen statt schauen.
 *
 * Sie beantwortet drei Fragen, die man von Auge nicht verlässlich
 * beantwortet – jede stammt aus einem Fehler, der einmal wirklich
 * passiert ist:
 *
 *   1. Ragt etwas seitlich hinaus?  So ist die leere 340-Punkte-Spalte
 *      auf der Startseite aufgefallen: Die rechte Spalte beanspruchte
 *      ihre Breite auch dann, wenn nichts darin lag.
 *   2. Bleibt ein offenes Blatt stehen?  Die Fernbedienung hing an einer
 *      Bedingung, die vom gemeldeten Zustand des Fernsehers abhing, und
 *      flog bei jedem Tastendruck aus dem Baum. Auf dem iPhone sah man
 *      ein Wegblinken; hier ist es eine Zahl.
 *   3. Kommt ein Druck am Hub an?  Die Fernbedienung war monatelang
 *      stumm, und niemand konnte sagen, wo der Druck stirbt.
 *   5. Steht auf der Raumliste die Wetter-/Musikspalte, die dort nicht
 *      hingehört?  Auf dem Telefon steht sie nie - wer nur dort
 *      nachsieht, hält jede Regel darüber für erfüllt.
 *   4. Wandert die zu lange Terminzeile durch?  Sie endete auf «Si…»,
 *      und der zweite Termin des Tages stand damit nirgends. Beim
 *      Beheben zeigte sich der eigentliche Fehler: Der Griff um die
 *      Zeile schrumpfte gar nicht (449 Punkte in einer Zeile von 315),
 *      und beides sieht von Auge gleich aus – abgeschnitten.
 *
 * Aufruf über `scripts/probe.sh` – der startet Demo-Hub und Web-Fassung
 * und übergibt die Adressen hier hinein.
 *
 * Was der Browser NICHT beantwortet: alles, was nur nativ passiert –
 * Tastatur, Haptik, Widgets, Sicherheitsabstände. Dafür führt kein Weg
 * am Gerät vorbei.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const WEB = process.env.PROBE_WEB ?? 'http://127.0.0.1:8188';
const HUB = process.env.PROBE_HUB ?? 'http://127.0.0.1:8199';
const TOKEN = process.env.PROBE_TOKEN ?? 'probe-token';

/** Die Grössen, auf denen gemessen wird. Beide, nicht eine: Der
 *  Überlauf, der zu dieser Probe geführt hat, zeigte sich nur auf dem
 *  iPad – auf dem Telefon war die Spalte ohnehin ausgeblendet. */
const GROESSEN = [
  { name: 'iPad 11" quer', width: 1180, height: 820 },
  { name: 'iPhone', width: 390, height: 844 },
];

function playwrightLaden() {
  try {
    return require('playwright');
  } catch {
    console.error(
      'Playwright fehlt. Einmalig einrichten:\n' +
        '  npm --prefix scripts install\n' +
        '  npm --prefix scripts run browser'
    );
    process.exit(2);
  }
}

/** Wo der Browser liegt. In vorbereiteten Umgebungen steht er woanders,
 *  und Playwright sucht ihn dann vergeblich im eigenen Ordner. */
function browserOrt() {
  return process.env.PROBE_CHROMIUM || undefined;
}

const fehler = [];
const gemeldet = [];

function pruefe(bestanden, satz, nachsatz = '') {
  gemeldet.push(`  ${bestanden ? '✓' : '✗'} ${satz}`);
  if (!bestanden) fehler.push(satz + (nachsatz ? ` – ${nachsatz}` : ''));
}

async function angemeldeteSeite(browser, groesse) {
  const seite = await browser.newPage({
    viewport: { width: groesse.width, height: groesse.height },
  });
  // Die Zugangsdaten müssen vor dem ersten Zeichnen liegen, sonst zeigt
  // die App den Anmeldebildschirm und misst man dessen Breite.
  await seite.goto(WEB);
  await seite.evaluate(
    ([url, token]) => {
      localStorage.setItem(
        'homepilot.settings',
        JSON.stringify({ url, token, theme: 'dark' })
      );
    },
    [HUB, TOKEN]
  );
  await seite.goto(WEB);
  await seite.waitForTimeout(2500);
  await einfuehrungWegtippen(seite);
  return seite;
}

/** Das Einführungsblatt wegtippen, falls es steht.
 *
 *  Seit Punkt 248 der Werkbank begrüsst die App jede Person genau
 *  einmal – und die Probe startet immer mit frischem Profil, ist also
 *  immer die «erste Person». Sie tippt das Blatt weg wie ein Mensch;
 *  stünde es noch, fingen die Messklicks im Blatt statt in der App. */
async function einfuehrungWegtippen(seite) {
  const spaeter = seite.getByText('Später', { exact: true }).first();
  if (await spaeter.isVisible().catch(() => false)) {
    await spaeter.click();
    await seite.waitForTimeout(400);
  }
}

/** Misst die offene Seite: Ragt etwas über den rechten Rand? */
async function messeUeberlauf(seite) {
  return seite.evaluate(() => ({
    zuBreit: document.documentElement.scrollWidth > window.innerWidth,
    schuldige: [...document.querySelectorAll('div')]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 3)
      .map((el) => el.className || el.tagName),
  }));
}

/** 1. Ragt etwas seitlich hinaus? */
async function ueberlauf(browser) {
  for (const groesse of GROESSEN) {
    const seite = await angemeldeteSeite(browser, groesse);
    const start = await messeUeberlauf(seite);
    pruefe(
      !start.zuBreit,
      `${groesse.name}: nichts ragt seitlich hinaus`,
      start.schuldige.join(' | ')
    );
    // Und dasselbe im Zimmer: Dort liegen im Kopf die Szenenknöpfe als
    // waagrechte Liste neben dem Musikstreifen, der eine Mindestbreite
    // hat (components/Raumspieler.tsx). Zwei Nachbarn, von denen einer
    // nicht schrumpfen will, sind der klassische Weg, eine Seite
    // seitlich hinauszuschieben - und auf der Startseite ist davon
    // nichts zu sehen.
    if (await inDenRaum(seite)) {
      const raum = await messeUeberlauf(seite);
      pruefe(
        !raum.zuBreit,
        `${groesse.name}: auch im Raumkopf ragt nichts hinaus`,
        raum.schuldige.join(' | ')
      );
    } else {
      pruefe(false, `${groesse.name}: der Weg ins Zimmer steht offen`);
    }
    await seite.close();
  }
}

/** In den Wohnzimmer-Raum, wo die Gerätekacheln stehen.
 *
 *  Die Startseite zeigt Favoriten und Schnellaktionen, keine Geräte -
 *  wer dort nach einer Kachel sucht, findet sie nie und hält das für
 *  einen Fehler der Probe. */
async function inDenRaum(seite) {
  const raeume = seite.getByRole('tab', { name: 'Räume' }).first();
  if (!(await raeume.isVisible().catch(() => false))) return false;
  await raeume.click();
  await seite.waitForTimeout(1000);
  const raum = seite.getByText('Wohnzimmer', { exact: true }).first();
  if (!(await raum.isVisible().catch(() => false))) return false;
  await raum.click();
  await seite.waitForTimeout(1200);
  return true;
}

/**
 * 5. Steht auf der Raumliste die Wetter-/Musikspalte?
 *
 * Sie soll dort weg sein (lib/seitenspalte.ts): «Räume» ist die Seite,
 * auf der man ein Zimmer sucht, und die Raumkacheln leben von der
 * Breite ihrer Fotos. Von Auge ist das leicht zu übersehen - auf dem
 * Telefon steht die Spalte ohnehin nie, und wer nur dort nachsieht,
 * hält es für erledigt. Gemessen wird darum auf iPad-Breite, und zwar
 * am Wetter: Es ist das einzige, was nur die Spalte zeigt.
 */
async function raumlisteOhneSpalte(browser) {
  const seite = await angemeldeteSeite(browser, GROESSEN[0]);
  // Gemessen am Lautsprecher-Wähler der Musikkarte: Er steht in der
  // Spalte und sonst nirgends auf diesen beiden Seiten. Am Wetter wäre
  // es das Naheliegende, aber der Demo-Hub hat keines - eine Messung,
  // die schon am Prüfstand nichts findet, misst die Regel nicht.
  const spalteDa = async () =>
    (await seite.getByLabel('Lautsprecher wählen', { exact: true }).count()) > 0;
  // Die Gegenprobe zuerst: Auf der Startseite muss die Spalte stehen -
  // sonst wäre die Zeile darunter für eine kaputte App auch grün.
  const aufStart = await spalteDa();
  const raeume = seite.getByRole('tab', { name: 'Räume' }).first();
  if (!(await raeume.isVisible().catch(() => false))) {
    pruefe(false, 'Die Raumliste war erreichbar');
    await seite.close();
    return;
  }
  await raeume.click();
  await seite.waitForTimeout(1200);
  const aufRaeumen = await spalteDa();
  pruefe(aufStart, 'Die Startseite behält die Wetter- und Musikspalte');
  pruefe(!aufRaeumen, 'Die Raumliste zeigt keine Wetter- und Musikspalte');
  await seite.close();
}

/** Das volle Fernbedienungs-Blatt öffnen.
 *
 *  Auf der Kachel steht seit Kurzem schon ein Steuerkreuz; das Blatt
 *  mit allen Tasten liegt hinter «Ganze Fernbedienung». Beides prüft
 *  die Probe: das Kreuz beim Überlauf, das Blatt hier. */
async function fernbedienungOeffnen(seite) {
  if (!(await inDenRaum(seite))) return false;
  // Die letzte Kachel im Raum ist der zappelige Fernseher (gremlin) -
  // an ihm wird gemessen. Am zahmen Demo-Fernseher bliebe das Blatt
  // immer stehen, und die Messung wäre eine, die nie rot wird.
  const knopf = seite.getByLabel('Ganze Fernbedienung', { exact: true }).last();
  if (!(await knopf.isVisible().catch(() => false))) return false;
  await knopf.click();
  await seite.waitForTimeout(700);
  return true;
}

/** 2. Bleibt ein offenes Blatt stehen, während der Hub meldet? */
async function blattBleibt(browser) {
  const seite = await angemeldeteSeite(browser, GROESSEN[0]);
  if (!(await fernbedienungOeffnen(seite))) {
    pruefe(false, 'Fernbedienung liess sich öffnen', 'Kachel oder Knopf nicht gefunden');
    await seite.close();
    return;
  }

  // Merken, welches Element gerade das Blatt ist - fliegt es aus dem
  // Dokument, ist es abgeräumt und neu aufgebaut worden. Genau das sieht
  // man auf dem Telefon als Wegblinken.
  await seite.evaluate(() => {
    // Die letzte «Hoch»-Taste im Dokument ist die im Blatt: Das Blatt
    // liegt über der Kachel, deren Steuerkreuz dieselbe Beschriftung
    // trägt. Die erste zu nehmen hiesse, die Kachel zu messen.
    const alle = document.querySelectorAll('[aria-label="Hoch"]');
    window.__taste = alle[alle.length - 1];
    window.__weg = 0;
    const beobachter = new MutationObserver(() => {
      if (window.__taste && !document.contains(window.__taste)) window.__weg++;
    });
    beobachter.observe(document.body, { childList: true, subtree: true });
  });

  for (const taste of ['Hoch', 'Runter', 'Links', 'Rechts']) {
    await seite.getByLabel(taste, { exact: true }).last().click();
    await seite.waitForTimeout(350);
  }

  const weg = await seite.evaluate(() => window.__weg);
  pruefe(
    weg === 0,
    'Das offene Blatt bleibt bei jedem Tastendruck stehen',
    `${weg}-mal aus dem Dokument geflogen`
  );
  await seite.close();
}

/** 3. Kommt ein Druck wirklich am Hub an? */
async function druckKommtAn(browser) {
  const kopf = { Authorization: `Bearer ${TOKEN}` };
  const lesen = async () => {
    const antwort = await fetch(`${HUB}/api/entities`, { headers: kopf });
    const daten = await antwort.json();
    const liste = Array.isArray(daten) ? daten : (daten.entities ?? []);
    return liste.find((e) => e.id === 'demo.light_livingroom');
  };

  const vorher = await lesen();
  if (!vorher) {
    pruefe(false, 'Der Demo-Hub antwortet mit seinen Geräten');
    return;
  }

  const seite = await angemeldeteSeite(browser, GROESSEN[0]);
  if (!(await inDenRaum(seite))) {
    pruefe(false, 'Der Weg zu den Gerätekacheln steht offen');
    await seite.close();
    return;
  }
  const kachel = seite.getByText('Licht Wohnzimmer').first();
  if (!(await kachel.isVisible().catch(() => false))) {
    pruefe(false, 'Die Lichtkachel ist da');
    await seite.close();
    return;
  }
  await kachel.click();
  await seite.waitForTimeout(1200);

  const nachher = await lesen();
  pruefe(
    nachher?.state?.state !== vorher.state?.state,
    'Ein Tipp auf die Kachel erreicht den Hub',
    `Zustand blieb «${vorher.state?.state}»`
  );
  await seite.close();
}

/** 4. Wandert die zu lange Terminzeile durch – und bleibt sie dabei in
 *  der Karte?
 *
 *  Nur auf dem Telefon: Auf dem iPad ist die Karte breit genug, dort
 *  gibt es nichts zu wandern. Und ein Umlauf dauert acht Sekunden – die
 *  gibt man nicht zweimal aus.
 *
 *  Der Demo-Kalender liefert dafür einen Termin, der mit Absicht zu
 *  lang ist (hub/homepilot/integrations/demo.py); er ist der gemeldete
 *  aus dem Haus.
 */
async function terminWandert(browser) {
  const seite = await angemeldeteSeite(browser, GROESSEN[1]);
  // Die wandernde Ausfertigung ist die zweite – die erste ist der
  // Platzhalter, der den Platz bestimmt (components/Lauftext.tsx).
  const messen = () =>
    seite.evaluate(() => {
      const treffer = [...document.querySelectorAll('div,span')].filter(
        (el) => el.children.length === 0 && el.textContent?.includes('Chrabbelzwergli')
      );
      if (treffer.length === 0) return null;
      const el = treffer[treffer.length - 1];
      // Beides über den Baum und nicht über Klassen oder Stilangaben:
      // React Native Web schreibt seine Stile mal als Klasse, mal
      // eingebettet - ein Sucher darauf findet je nach Bau nichts und
      // meldet dann Grün, weil er nichts zu messen fand.
      let fenster = el.parentElement;
      while (fenster && getComputedStyle(fenster).overflowX !== 'hidden') {
        fenster = fenster.parentElement;
      }
      // Die Begrüssungskarte findet man an ihrem Gruss - und der
      // wechselt mit der Tageszeit: «Guten Morgen», «Hallo», «Guten
      // Abend» (app/src/lib/begruessung.ts). Gesucht wurde nur nach
      // «Guten », und damit war diese Messung jeden Nachmittag rot:
      // «Zeile nicht gefunden», ohne dass am Code etwas fehlte.
      const GRUSS = /Guten Morgen|Guten Abend|Hallo/;
      let karte = fenster;
      while (karte && !GRUSS.test(karte.textContent)) karte = karte.parentElement;
      if (!fenster || !karte) return null;
      return {
        x: Math.round(el.getBoundingClientRect().left),
        ueberDieKarte: Math.round(
          fenster.getBoundingClientRect().right - karte.getBoundingClientRect().right
        ),
      };
    });

  const erste = await messen();
  if (erste === null) {
    pruefe(false, 'Die lange Terminzeile steht in der Karte', 'Zeile nicht gefunden');
    await seite.close();
    return;
  }
  pruefe(
    erste.ueberDieKarte <= 1,
    'Die lange Terminzeile bleibt in der Karte',
    `ragt ${erste.ueberDieKarte} Punkte hinaus`
  );

  // Zehneinhalb Sekunden sind ein Umlauf mit Reserve: 3 Sekunden Ruhe,
  // rund 3 Sekunden Wanderung, 2 Sekunden Ruhe.
  const spur = [erste.x];
  for (let i = 0; i < 26; i++) {
    await seite.waitForTimeout(400);
    const jetzt = await messen();
    if (jetzt) spur.push(jetzt.x);
  }
  const ruhe = Math.max(...spur);
  const weiteste = ruhe - Math.min(...spur);
  pruefe(weiteste > 20, 'Die lange Terminzeile wandert nach links', `nur ${weiteste} Punkte`);
  // Nach der Wanderung wieder von vorne: Ein Lauftext, der am Ende
  // liegen bleibt, zeigt den Anfang nie wieder.
  // «Ist zurück» ohne «hat sich bewegt» wäre für jede stehende Zeile
  // wahr - eine Messung, die auch dann grün ist, wenn gar nichts
  // passiert, ist keine.
  const zurueck = weiteste > 20 && spur.lastIndexOf(ruhe) > spur.indexOf(Math.min(...spur));
  pruefe(zurueck, 'Die lange Terminzeile fängt wieder von vorne an', 'blieb am Ende stehen');
  await seite.close();
}

const { chromium } = playwrightLaden();
const browser = await chromium.launch({ executablePath: browserOrt() });
try {
  await ueberlauf(browser);
  await blattBleibt(browser);
  await druckKommtAn(browser);
  await terminWandert(browser);
  await raumlisteOhneSpalte(browser);
} finally {
  await browser.close();
}

console.log('\nBrowser-Probe:');
for (const zeile of gemeldet) console.log(zeile);
if (fehler.length) {
  console.log(`\n${fehler.length} Messung(en) fehlgeschlagen:`);
  for (const zeile of fehler) console.log(`  ${zeile}`);
  process.exit(1);
}
console.log('\nAlle Messungen bestanden.');
