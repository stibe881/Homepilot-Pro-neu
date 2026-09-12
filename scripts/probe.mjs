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
 *   5. Steht der Medienplayer auf der Raumliste im Kopf statt als
 *      Spalte daneben?  Beides zeigt denselben Player - nur die Lage
 *      unterscheidet sie, und die sieht man von Auge erst, wenn man
 *      beide Fassungen nebeneinander hält.
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

/** Die übrigen Seiten, die die Probe bis Punkt 421 nie gesehen hat.
 *
 *  Gemessen wurden Startseite, Räume und der Fernseher-Fall. Familie,
 *  Licht, Storen und Einstellungen - die Seiten mit den meisten
 *  Formularen und den längsten Listen - kamen nie vor: Ein seitlicher
 *  Überlauf in der Gutschein-Liste auf dem iPhone fiel erst auf, wenn
 *  jemand mit einem iPhone davorstand.
 *
 *  Nur der Überlauf und nur die Seiten, die ohne echten Hub etwas
 *  zeigen: Der Demo-Hub kennt kein Familienleben, aber er kennt Licht,
 *  Storen und die Einstellungen - und genau dort stehen die Formulare,
 *  die zu breit werden. */
const WEITERE_SEITEN = ['Licht', 'Storen', 'Familie', 'Einstellungen'];

async function zurSeite(seite, name) {
  const knopf = seite.getByRole('tab', { name }).first();
  if (!(await knopf.isVisible().catch(() => false))) return false;
  await knopf.click();
  await seite.waitForTimeout(900);
  return true;
}

/** 6. Ragt auch auf den übrigen Seiten nichts hinaus? (Punkt 421) */
async function weitereSeiten(browser) {
  for (const groesse of GROESSEN) {
    const seite = await angemeldeteSeite(browser, groesse);
    for (const name of WEITERE_SEITEN) {
      if (!(await zurSeite(seite, name))) {
        // Kein Fehler: Nicht jede Seite steht jedem Benutzer offen, und
        // die Probe meldet sich als erste Person am Demo-Hub an. Eine
        // Messung über eine Seite, die es nicht gibt, wäre erfunden.
        continue;
      }
      const mass = await messeUeberlauf(seite);
      pruefe(
        !mass.zuBreit,
        `${groesse.name} · ${name}: nichts ragt seitlich hinaus`,
        mass.schuldige.join(' | ')
      );
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
 * 5. Bekommen die Raumkacheln die volle Breite - und steht der Player im Kopf?
 *
 * Die Spalte rechts ist auf der Raumliste weg (Punkt 507): Dort sucht
 * man ein Zimmer, und die Raumkacheln leben von der Breite ihrer Fotos.
 * Die Musik des Hauses steht seither oben im Kopf, neben der
 * Begrüssung (Punkt 509) - wie im Zimmer.
 *
 * Gemessen wird an der **Breite der Raumkachel**, nicht daran, ob ein
 * Player dasteht: Spalte und Kopf zeigen denselben Player, und beim
 * ersten Versuch war die Messung deshalb auch für die alte Fassung
 * grün. Was die zwei unterscheidet, ist, was den Kacheln bleibt - mit
 * Spalte 340 Punkte weniger.
 *
 * Auf dem Telefon gehört der Player nicht in den Kopf: Dort schöbe er
 * die Kacheln unter den Rand - genau der Grund, aus dem die Spalte dort
 * nie stand.
 */
async function raumlisteKopfspieler(browser) {
  for (const groesse of GROESSEN) {
    const seite = await angemeldeteSeite(browser, groesse);
    const waehler = () => seite.getByLabel('Lautsprecher wählen', { exact: true }).first();
    const schmal = groesse.width < 700;
    // Die Gegenprobe: Auf der Startseite steht der Player immer - sonst
    // wäre alles Weitere auch für eine kaputte App grün.
    pruefe(
      (await waehler().count()) > 0,
      `${groesse.name}: die Startseite zeigt den Medienplayer`
    );
    const raeume = seite.getByRole('tab', { name: 'Räume' }).first();
    if (!(await raeume.isVisible().catch(() => false))) {
      pruefe(false, `${groesse.name}: die Raumliste war erreichbar`);
      await seite.close();
      continue;
    }
    await raeume.click();
    await seite.waitForTimeout(1200);

    // Die Raumkachel: vom Namen aus hinauf bis zu dem Vorfahren, der
    // wirklich die Kachel ist (die erste Fläche über 250 Punkten).
    //
    // Gemessen wird dann die *rechteste* Kachel der Reihe, nicht die
    // gefundene: Ob «Flur» links oder rechts steht, hängt davon ab, wie
    // viele Zimmer davor kommen - und die Messung fiel prompt um, als
    // ein Zimmer dazukam. Die Frage ist «reicht das Raster bis an den
    // Rand», und die beantwortet die letzte Kachel der Reihe.
    const kachel = await seite.evaluate(() => {
      let el = [...document.querySelectorAll('div')].find(
        (kandidat) => kandidat.textContent?.trim() === 'Flur'
      );
      while (el && el.getBoundingClientRect().width < 250) el = el.parentElement;
      if (!el) return null;
      // Alle Kacheln des Rasters: dieselbe Breite wie die gefundene.
      // Über die Eltern zu gehen führt hier in die Irre - zwischen
      // Kachel und Raster liegt je Spalte ein eigener Kasten.
      const breite = el.getBoundingClientRect().width;
      const rechts = Math.max(
        ...[...document.querySelectorAll('div')]
          .map((kandidat) => kandidat.getBoundingClientRect())
          .filter((r) => Math.abs(r.width - breite) < 20)
          .map((r) => r.right)
      );
      return { rechts, fensterBreite: window.innerWidth };
    });
    if (!kachel) {
      pruefe(false, `${groesse.name}: die Raumkachel «Flur» war messbar`);
      await seite.close();
      continue;
    }
    // 80 Punkte Reserve für den Seitenrand der Seite; eine Spalte kostet
    // 340 und fällt damit weit durch.
    pruefe(
      kachel.rechts > kachel.fensterBreite - 80,
      `${groesse.name}: die Raumkacheln bekommen die volle Breite`,
      `Kachel endet bei ${Math.round(kachel.rechts)} von ${kachel.fensterBreite}`
    );

    const da = (await waehler().count()) > 0;
    pruefe(
      schmal ? !da : da,
      schmal
        ? 'iPhone: die Raumliste trägt keinen Medienplayer im Kopf'
        : `${groesse.name}: die Raumliste trägt den Medienplayer im Kopf`
    );
    await seite.close();
  }
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

/** Ein Gerät zweimal schalten, damit die Startseite sich neu aufbaut
 *  und am Ende steht wie vorher (für terminWandert, Punkt 530). */
async function geraetSchalten() {
  const kopf = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
  for (const befehl of ['turn_on', 'turn_off']) {
    await fetch(`${HUB}/api/entities/demo.light_livingroom/command`, {
      method: 'POST',
      headers: kopf,
      body: JSON.stringify({ command: befehl, data: {} }),
    });
    await new Promise((weiter) => setTimeout(weiter, 600));
  }
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
  // Gleich beim Start ein Gerät schalten: Das ist der «zusätzliche
  // Abruf beim Start der Startseite» aus Werkbank 353 - ein weiterer
  // Aufbau, während die Zeile sich noch misst.
  await geraetSchalten();
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

  // Der Fall aus Werkbank 353 (Punkt 530): Ein weiterer Aufbau der
  // Startseite - dort genügte ein einziger zusätzlicher Abruf - liess
  // den Text früher die Breite des Fensters statt seine eigene melden;
  // aus «muss wandern» wurde «passt», und die Zeile blieb stehen. Hier
  // erzwingt ihn ein Gerät, das seinen Zustand ändert: Der Hub meldet
  // es über den WebSocket, die Startseite baut sich neu auf, die Zeile
  // muss danach weiter wandern. Zwei Schaltungen, damit das Licht am
  // Ende steht wie vorher.
  await geraetSchalten();
  const danach = [];
  for (let i = 0; i < 26; i++) {
    await seite.waitForTimeout(400);
    const jetzt = await messen();
    if (jetzt) danach.push(jetzt.x);
  }
  const weiterhin = danach.length > 0 ? Math.max(...danach) - Math.min(...danach) : 0;
  pruefe(
    weiterhin > 20,
    'Die lange Terminzeile wandert auch nach einem weiteren Aufbau',
    `nur ${weiterhin} Punkte`
  );
  await seite.close();
}

/** 5. Stehen die Kacheln einer Reihe gleich hoch? (Punkt 448 der Werkbank)
 *
 *  Der Fall: Eine Kachel mit zweizeiligem Namen wächst, die daneben
 *  nicht - und die Reihe steht sichtbar schief. Von Auge sieht man es
 *  erst, wenn man danach sucht; gemessen fällt es beim ersten Lauf auf.
 *
 *  Gemessen wird nicht «alle gleich hoch» - Kacheln dürfen verschieden
 *  gross sein (Punkt 291: zwei Kachelgrössen). Gemessen wird, ob
 *  Kacheln, die in derselben Zeile *beginnen*, auch gleich enden. Genau
 *  das ist die Schieflage, die man sieht.
 */
async function kachelnStehenGleich(browser) {
  for (const groesse of GROESSEN) {
    const seite = await angemeldeteSeite(browser, groesse);
    if (!(await inDenRaum(seite))) {
      pruefe(false, `${groesse.name}: der Weg ins Zimmer steht offen`);
      await seite.close();
      continue;
    }
    const schief = await seite.evaluate(() => {
      // Die Gerätekacheln sind die Elemente mit einer Umschaltrolle
      // darin - dieselbe Spur, der auch der Tipp-Test folgt.
      const kacheln = [...document.querySelectorAll('[role="switch"]')]
        .map((el) => el.closest('div[class]')?.parentElement)
        .filter((el) => el instanceof HTMLElement)
        .map((el) => el.getBoundingClientRect())
        .filter((box) => box.width > 60 && box.height > 40);
      // Nach Zeilen gruppieren: Was innerhalb von acht Punkten gleich
      // hoch beginnt, steht nebeneinander. Acht, weil ein Rand oder ein
      // Schatten die Oberkante um ein, zwei Punkte verschiebt.
      const zeilen = new Map();
      for (const box of kacheln) {
        const schluessel = Math.round(box.top / 8);
        zeilen.set(schluessel, [...(zeilen.get(schluessel) ?? []), box]);
      }
      let schlimmste = 0;
      for (const reihe of zeilen.values()) {
        if (reihe.length < 2) continue;
        const hoehen = reihe.map((box) => box.height);
        schlimmste = Math.max(schlimmste, Math.max(...hoehen) - Math.min(...hoehen));
      }
      return { schlimmste: Math.round(schlimmste), reihen: zeilen.size };
    });
    // Vier Punkte Spielraum: Darunter sieht niemand etwas, und ein
    // Prüfstand, der auf einen halben Punkt besteht, wird abgeschaltet.
    pruefe(
      schief.schlimmste <= 4,
      `${groesse.name}: Kacheln einer Reihe stehen gleich hoch`,
      `${schief.schlimmste} Punkte Unterschied in einer Reihe`
    );
    await seite.close();
  }
}

/** 8. Zählt ein Fühler für zwei Zimmer? (Punkt 539, 541)
 *
 * Der Prüfstand hat den Klimafühler des Wohnzimmers zusätzlich im
 * Esszimmer stehen - einem Zimmer, das *nur* dadurch entsteht. Beide
 * Kacheln müssen seine Werte tragen.
 *
 * Gemessen und nicht bloss gelesen, weil die Kette lang ist: Der Hub
 * muss zwei Zimmer melden statt des zuletzt genannten, die App muss die
 * Raumliste aus allen Mitgliedschaften bilden statt aus dem Standort,
 * und die Kachel muss den Fühler in beiden Zimmern finden. Jedes Glied
 * war vorher einwertig.
 *
 * Seit Punkt 541 steht der Fühler dabei auf «Gilt für: nur diesen
 * Raum» (gesetzt in probe.sh). Das war der gemeldete Fehler: Im Bad
 * ist es wärmer und feuchter als im Rest der Wohnung, also stellt man
 * genau dort den Schalter um - und ausgerechnet dann blieb die Ecke
 * leer, weil die Kachel den Fühler aussortierte. Der Schalter hält ihn
 * aus der Kopfzeile des Hauses heraus; die Kachel *ist* der Raum.
 */
async function fuehlerInZweiZimmern(browser) {
  const seite = await angemeldeteSeite(browser, GROESSEN[0]);
  if (!(await zurSeite(seite, 'Räume'))) {
    await seite.close();
    return;
  }
  const werte = await seite.evaluate(() => {
    const kachel = (name) => {
      // Über die Höhe hinauf und nicht über die Breite: Der Raumname
      // liegt in einem Kasten, der bereits die volle Kachelbreite hat -
      // eine Suche nach «breit genug» bliebe an ihm hängen und läse nur
      // den Namen. Die ganze Kachel ist die erste Fläche über 150
      // Punkten Höhe.
      let el = [...document.querySelectorAll('div')].find(
        (kandidat) => kandidat.textContent?.trim() === name
      );
      while (el && el.getBoundingClientRect().height < 150) el = el.parentElement;
      return el ? (el.textContent || '') : '';
    };
    return { wohnzimmer: kachel('Wohnzimmer'), esszimmer: kachel('Esszimmer') };
  });
  // Der Demo-Fühler meldet 21,5 Grad; die Zahl wandert um ein Zehntel,
  // weil die Demo sie driften lässt - darum nur auf das Gradzeichen und
  // das Prozent sehen.
  const traegt = (text) => /\d+,\d+°/.test(text) && /\d+\s?%/.test(text);
  pruefe(
    traegt(werte.wohnzimmer),
    'Der Fühler steht auf der Kachel seines Standorts',
    werte.wohnzimmer.slice(0, 60)
  );
  pruefe(
    traegt(werte.esszimmer),
    'Und ebenso im zweiten Zimmer, dem er zugewiesen ist',
    werte.esszimmer.slice(0, 60) || 'keine Kachel «Esszimmer»'
  );
  await seite.close();
}

/** 7. Ragt im Ablauf-Editor etwas hinaus? (Punkt 537)
 *
 * Der gemeldete Fall: Beim gewählten Gerät stand «eigene Zeit» *neben*
 * dem Blatt, ausserhalb des sichtbaren Rands. Die Ursache war eine
 * Chip-Reihe in einem Kasten, der nicht umbrechen durfte - und keine
 * der sechs Messungen davor sah sie, weil keine den Editor je öffnete.
 *
 * Gemessen wird darum nicht die Seite, sondern jeder Kasten darin: Wo
 * mehr Inhalt steht, als hineinpasst (`scrollWidth > clientWidth`),
 * liegt etwas ausserhalb. Das findet auch den Fall, in dem die Seite
 * selbst nicht breiter wird, weil das Blatt den Überlauf abschneidet -
 * genau so war es hier.
 */
async function ablaufEditorPasst(browser) {
  for (const groesse of GROESSEN) {
    const seite = await angemeldeteSeite(browser, groesse);
    const weg = await zumEditor(seite);
    if (!weg) {
      // Kein Fehler: Wer die Abläufe nicht bearbeiten darf, kommt hier
      // nicht hin - und eine Messung über etwas Ungeöffnetes wäre
      // erfunden.
      await seite.close();
      continue;
    }
    const zuBreit = await seite.evaluate(() => {
      // Gemessen wird *im Blatt*, nicht auf der ganzen Seite: Die Leiste
      // der Einstellungen und der Streifen über der Startseite scrollen
      // von sich aus waagrecht und sind dabei breiter als ihr Kasten -
      // das ist ihre Aufgabe, kein Fehler. Ausgangspunkt ist das
      // Suchfeld der Geräteauswahl; darüber liegt der scrollende Kasten
      // des Editors, und nur was darin steht, gehört hierher.
      const feld = [...document.querySelectorAll('input')].find((el) =>
        (el.placeholder || '').startsWith('Gerät oder Raum')
      );
      if (!feld) return ['Suchfeld der Geräteauswahl nicht gefunden'];
      let blatt = feld.parentElement;
      while (
        blatt &&
        !(blatt.scrollHeight > blatt.clientHeight + 40 && blatt.clientHeight > 200)
      ) {
        blatt = blatt.parentElement;
      }
      if (!blatt) return [];
      return [...blatt.querySelectorAll('div')]
        .filter((el) => el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 120)
        .slice(0, 3)
        .map(
          (el) =>
            `${el.clientWidth}<${el.scrollWidth} ${(el.innerText || '')
              .slice(0, 40)
              .replace(/\n/g, ' / ')}`
        );
    });
    pruefe(
      zuBreit.length === 0,
      `${groesse.name} · Ablauf-Editor: nichts steht ausserhalb seines Kastens`,
      zuBreit.join(' | ')
    );
    await seite.close();
  }
}

/** Den Weg bis zum offenen Editor mit einem gewählten Licht.
 *
 * Über eine Vorlage und nicht über «Neuer Ablauf»: Die Vorlage bringt
 * Auslöser und Schritt schon mit, und gemessen werden soll das Blatt,
 * nicht das Ausfüllen.
 */
async function zumEditor(seite) {
  const einstellungen = seite.getByLabel('Einstellungen').first();
  if (!(await einstellungen.isVisible().catch(() => false))) return false;
  await einstellungen.click();
  await seite.waitForTimeout(900);
  const ablaeufe = seite.getByLabel('Abläufe').first();
  if (!(await ablaeufe.isVisible().catch(() => false))) return false;
  await ablaeufe.click();
  await seite.waitForTimeout(1200);
  const vorlage = seite
    .getByLabel(/^Neuer Ablauf aus /)
    .first();
  if (!(await vorlage.isVisible().catch(() => false))) return false;
  await vorlage.click();
  await seite.waitForTimeout(1200);
  // Ein Licht dazunehmen: Erst dann stehen die Chip-Reihen da, um die
  // es geht - Helligkeit, Nachlauf, Weisston.
  const lampe = seite.getByLabel('Licht Wohnzimmer, Licht').first();
  if (!(await lampe.isVisible().catch(() => false))) return false;
  await lampe.click();
  await seite.waitForTimeout(800);
  const um = seite.getByText('umschalten', { exact: true }).first();
  if (await um.isVisible().catch(() => false)) {
    await um.click();
    await seite.waitForTimeout(600);
  }
  return true;
}

/** 9. Der Rauchwarnmelder: keine Kachel im Zimmer, dafür eine Liste
 * unter System. (Punkt 542)
 *
 * Gewünscht im Haus: «Die Rauchwarnmelder-Kachel soll es in den Räumen
 * nicht anzeigen. Es soll aber in Einstellungen → System die
 * Rauchwarnmelder anzeigen mit Status, Batterie, Smoke density, Smoke
 * density dbm usw.»
 *
 * Beide Hälften gemessen und nicht nur die erste: Eine Kachel
 * wegzunehmen ist leicht, und wenn die Liste dann fehlt, ist der Melder
 * nirgends mehr zu sehen - schlimmer als vorher. Die Kette ist dabei
 * länger, als sie aussieht: Der Hub muss die Rauchdichten überhaupt
 * durchlassen (MESSWERTE in integrations/zigbee2mqtt.py liess sie
 * fallen), und die Karte muss sie ohne feste Liste finden.
 */
async function rauchmelderNichtImZimmer(browser) {
  const seite = await angemeldeteSeite(browser, GROESSEN[0]);
  if (!(await zurSeite(seite, 'Räume'))) {
    await seite.close();
    return;
  }
  const flur = seite.getByText('Flur', { exact: true }).first();
  if (await flur.isVisible().catch(() => false)) {
    await flur.click();
    await seite.waitForTimeout(1200);
    const imZimmer = await seite.evaluate(() =>
      document.body.innerText.includes('Rauchmelder Flur')
    );
    pruefe(!imZimmer, 'Im Zimmer steht keine Kachel für den ruhigen Rauchmelder');
  }

  if (!(await zurSeite(seite, 'Einstellungen'))) {
    await seite.close();
    return;
  }
  const system = seite.getByText('System', { exact: true }).first();
  if (!(await system.isVisible().catch(() => false))) {
    pruefe(false, 'Die Systemseite war erreichbar');
    await seite.close();
    return;
  }
  await system.click();
  await seite.waitForTimeout(2000);
  const kopf = seite.getByText('Rauchwarnmelder', { exact: true }).first();
  if (!(await kopf.isVisible().catch(() => false))) {
    pruefe(false, 'Unter System steht die Liste der Rauchwarnmelder');
    await seite.close();
    return;
  }
  // Zugeklappt zeigt die Karte nur, was meldet - der Demo-Melder ist
  // ruhig und steht erst nach dem Aufklappen da.
  await kopf.click();
  await seite.waitForTimeout(700);
  const text = await seite.evaluate(() => document.body.innerText);
  pruefe(
    text.includes('Rauchmelder Flur'),
    'Unter System steht die Liste der Rauchwarnmelder'
  );
  // Genau die beiden Zahlen, nach denen gefragt wurde. Sie fielen im
  // Hub durch, bevor sie je eine Oberfläche erreichten - ohne diese
  // Messung wäre das wieder unbemerkt möglich.
  pruefe(text.includes('Rauchdichte'), 'Und die Rauchdichte dabei');
  pruefe(text.includes('Rauchdichte (dB/m)'), 'Und die Rauchdichte in dB/m daneben');
  await seite.close();
}

/** 10. Steht der Melder im Ablauf-Editor mit «Signal geben»? (Punkt 544)
 *
 * Gemeldet im Haus: «Ich kann in den Abläufen nicht machen, dass wenn
 * etwas passiert, der Rauchwarnmelder ein Signal gibt.» Er stand dort
 * nicht zur Wahl, weil ein Melder für den Hub bis dahin nur *meldete* -
 * Befehle hatte er keine, und die Geräteliste im Editor zeigt nur, was
 * ein Gerät wirklich kann.
 *
 * Gemessen im Browser und nicht nur im Test, weil die Kette über drei
 * Schichten läuft: Der Hub muss die Sirene im Gerät erkennen
 * (`sirene_art`), sie als Befehle mitschicken, und der Editor muss aus
 * den Befehlen Chips machen. Jede Schicht war für sich grün, als die
 * Auswahl leer blieb.
 */
async function melderGibtSignal(browser) {
  const seite = await angemeldeteSeite(browser, GROESSEN[0]);
  const einstellungen = seite.getByLabel('Einstellungen').first();
  if (!(await einstellungen.isVisible().catch(() => false))) {
    await seite.close();
    return;
  }
  await einstellungen.click();
  await seite.waitForTimeout(900);
  const ablaeufe = seite.getByLabel('Abläufe').first();
  if (!(await ablaeufe.isVisible().catch(() => false))) {
    await seite.close();
    return;
  }
  await ablaeufe.click();
  await seite.waitForTimeout(1300);
  const vorlage = seite.getByLabel(/^Neuer Ablauf aus /).first();
  if (!(await vorlage.isVisible().catch(() => false))) {
    await seite.close();
    return;
  }
  await vorlage.click();
  await seite.waitForTimeout(1300);

  const melder = seite.getByLabel(/Rauchmelder Flur/).first();
  if (!(await melder.isVisible().catch(() => false))) {
    pruefe(false, 'Der Rauchmelder steht im Ablauf-Editor zur Wahl');
    await seite.close();
    return;
  }
  pruefe(true, 'Der Rauchmelder steht im Ablauf-Editor zur Wahl');
  await melder.click();
  await seite.waitForTimeout(900);
  const text = await seite.evaluate(() => document.body.innerText);
  pruefe(text.includes('Signal geben'), 'Und bietet «Signal geben» an');
  pruefe(text.includes('Signal aus'), 'Und «Signal aus» daneben');
  await seite.close();
}

/** 11. Steht auf der Geräteliste die Spalte rechts? (Punkt 549)
 *
 * Gemeldet im Haus: «Bei Einstellungen → Geräte sollen diese Karten
 * entfernt werden» - Wetter und Musik, unter der Liste.
 *
 * Gemessen wird mit eingebauter Gegenprobe: Auf der Startseite **muss**
 * die Musikkarte stehen. Ohne sie wäre die Messung auch für eine App
 * grün, in der die Spalte überall fehlt - und dieselbe Falle gab es
 * hier schon einmal (raumlisteKopfspieler, Punkt 509).
 *
 * Die Wetterkarte der Spalte bleibt hier **ungemessen**, und das mit
 * Absicht: Der Demo-Hub führt eine Wetter*warnung*, aber kein Gerät der
 * Art «weather» - die Karte erschiene also nirgends, und eine Zeile
 * «keine Wetterkarte» wäre immer grün, ohne etwas zu prüfen. Der
 * Versuch, dem Prüfstand ein Wettergerät zu geben, riss sechs fremde
 * Tests mit: Wer in seinem Test ein eigenes Wetter anlegt, bekam
 * plötzlich das der Demo. Beide Hälften der Spalte hängen ohnehin an
 * derselben Entscheidung (lib/seitenspalte.ts), und die ist dort
 * geprüft.
 */
async function geraetelisteOhneSpalte(browser) {
  for (const groesse of GROESSEN) {
    const seite = await angemeldeteSeite(browser, groesse);
    const musikkarte = () => seite.getByText('Musik', { exact: true });
    pruefe(
      (await musikkarte().count()) > 0,
      `${groesse.name}: die Startseite zeigt die Musikkarte`
    );
    if (!(await zurSeite(seite, 'Einstellungen'))) {
      await seite.close();
      continue;
    }
    const geraete = seite.getByText('Geräte', { exact: true }).first();
    if (!(await geraete.isVisible().catch(() => false))) {
      pruefe(false, `${groesse.name}: die Geräteliste war erreichbar`);
      await seite.close();
      continue;
    }
    await geraete.click();
    await seite.waitForTimeout(1500);
    pruefe(
      (await musikkarte().count()) === 0,
      `${groesse.name}: die Geräteliste trägt keine Musikkarte`
    );
    await seite.close();
  }
}

/** 12. Stehen Einrichten und Werkzeug unten - und zugeklappt? (Punkt 550)
 *
 * Gemeldet im Haus: «Die Karte ‹Noch einzurichten› und ‹Werkzeuge›
 * sollen ganz unten angezeigt werden und sollen ausserdem eingeklappt
 * sein.»
 *
 * Zwei Messungen, weil es zwei Versprechen sind. **Unten**: Beide
 * Karten müssen tiefer liegen als die letzte Gerätekachel - von Auge
 * ist das auf einem langen Bildschirm nicht zu sehen, weil man sie
 * beim Scrollen ohnehin nacheinander antrifft. **Zugeklappt**: Der
 * Inhalt darf nicht dastehen, die Überschrift schon - eine Karte, die
 * ganz verschwindet, hätte man ebenso gut löschen können.
 *
 * Die Gegenprobe steckt im Aufklappen: Nach einem Tipp auf «Werkzeuge»
 * muss der Knopf da sein. Ohne diese Zeile wäre die Messung auch für
 * eine App grün, in der es die Karte gar nicht mehr gibt.
 */
async function geraetewerkzeugeUnten(browser) {
  const seite = await angemeldeteSeite(browser, GROESSEN[0]);
  if (!(await zurSeite(seite, 'Einstellungen'))) {
    await seite.close();
    return;
  }
  const geraete = seite.getByText('Geräte', { exact: true }).first();
  if (!(await geraete.isVisible().catch(() => false))) {
    pruefe(false, 'Die Geräteliste war erreichbar');
    await seite.close();
    return;
  }
  await geraete.click();
  await seite.waitForTimeout(1800);

  const kopf = (text) => seite.getByText(text, { exact: true }).first();
  for (const titel of ['Noch einzurichten', 'Werkzeuge']) {
    if (!(await kopf(titel).count())) {
      pruefe(false, `«${titel}» steht auf der Geräteliste`);
      await seite.close();
      return;
    }
  }

  // Wie tief liegt was? Gemessen im Dokument, nicht im Sichtbaren:
  // Die Seite ist länger als der Bildschirm.
  //
  // Wogegen gemessen wird, ist der Punkt: gegen eine *Gerätekachel*.
  // «Unten» ohne Bezug wäre keine Messung - die beiden Karten lagen
  // vorher schon untereinander, nur eben über der Liste.
  const lage = await seite.evaluate(() => {
    const obenVon = (text) => {
      const el = [...document.querySelectorAll('div')].find(
        (kandidat) => kandidat.textContent?.trim() === text
      );
      return el ? el.getBoundingClientRect().top + window.scrollY : null;
    };
    return {
      einrichten: obenVon('Noch einzurichten'),
      werkzeuge: obenVon('Werkzeuge'),
      // Eine Kachel, die der Prüfstand immer hat.
      kachel: obenVon('Licht Wohnzimmer'),
    };
  });

  if (lage.kachel === null) {
    pruefe(false, 'Eine Gerätekachel war als Bezugspunkt zu finden');
    await seite.close();
    return;
  }
  pruefe(
    lage.einrichten > lage.kachel,
    '«Noch einzurichten» steht unter den Gerätekacheln',
    `Karte bei ${Math.round(lage.einrichten)}, Kachel bei ${Math.round(lage.kachel)}`
  );
  pruefe(
    lage.werkzeuge > lage.kachel,
    '«Werkzeuge» steht unter den Gerätekacheln',
    `Karte bei ${Math.round(lage.werkzeuge)}, Kachel bei ${Math.round(lage.kachel)}`
  );
  pruefe(
    lage.werkzeuge > lage.einrichten,
    'Und «Werkzeuge» unter «Noch einzurichten»'
  );

  // Zugeklappt: Der Inhalt fehlt, die Überschrift steht.
  pruefe(
    (await seite.getByText('Mehrere zuweisen', { exact: true }).count()) === 0,
    '«Werkzeuge» ist zugeklappt'
  );
  await kopf('Werkzeuge').click();
  await seite.waitForTimeout(600);
  pruefe(
    (await seite.getByText('Mehrere zuweisen', { exact: true }).count()) > 0,
    'Und geht auf, wenn man ihn antippt'
  );
  await seite.close();
}

/** 13. Öffnet der Tipp auf die Grillkachel das Blatt - und lässt sich
 * dort ein Ziel setzen, das der Hub behält? (Punkte 554, 555, 557)
 *
 * Gewünscht im Haus: «Wenn ich auf die Grillkarte drücke, schaltet sich
 * der Grill aus» - und: «Soll der Grill beim Antippen als Popup öffnen.»
 * Die Kachel trägt seit Punkt 557 keine Griffe mehr; der Tipp irgendwo
 * darauf öffnet das Blatt. Gemessen wird deshalb genau das: ein Tipp auf
 * die Fühlerzeile (die vorher selbst ein Griff war) - und danach, dass
 * der Grill noch läuft.
 *
 * Die Kette läuft über drei Schichten: Die Kachel muss den Grill als
 * Grill erkennen, das Blatt muss aufgehen, und der Hub muss das Ziel
 * behalten. Der Fehler, der diese Messung wert macht, sass in der
 * letzten: `hub.data` führt Listen, und das Ziel lag als Wörterbuch
 * darin - geschrieben wurde es, gelesen kam nichts zurück.
 */
async function grillzielSetzen(browser) {
  const seite = await angemeldeteSeite(browser, GROESSEN[0]);
  if (!(await zurSeite(seite, 'Räume'))) {
    await seite.close();
    return;
  }
  const terrasse = seite.getByText('Terrasse', { exact: true }).first();
  if (!(await terrasse.isVisible().catch(() => false))) {
    pruefe(false, 'Der Raum mit dem Grill war erreichbar');
    await seite.close();
    return;
  }
  await terrasse.click();
  await seite.waitForTimeout(1800);

  const zeile = seite.getByText(/^Fühler 2:/).first();
  if (!(await zeile.isVisible().catch(() => false))) {
    // Die Gegenprobe steckt hier: Ohne Grillkachel gibt es keine
    // Fühlerzeile - dann ist schon die erste Schicht kaputt.
    pruefe(false, 'Die Grillkachel zeigt ihre Fühler');
    await seite.close();
    return;
  }
  pruefe(true, 'Die Grillkachel zeigt ihre Fühler');
  // Und ihr Bild (Punkt 559) - je Bauart eines, hier der liegende
  // Grill, weil der Demo-Smoker dasselbe Modell trägt wie der im Haus.
  // Seit Punkt 564 das Foto - der Demo-Smoker trägt dasselbe Modell wie
  // der im Haus, und für das gibt es eines.
  pruefe(
    await seite.getByLabel('Foto: Pelletgrill').first().isVisible().catch(() => false),
    'Und das Foto des Grills daneben'
  );

  // Der Tipp auf die Kachel - auf die Zeile, die früher selbst ein
  // Griff war.
  await zeile.click();
  await seite.waitForTimeout(900);
  const blatt = seite.getByText('GRILL TEMP', { exact: true }).first();
  if (!(await blatt.isVisible().catch(() => false))) {
    pruefe(false, 'Ein Tipp auf die Kachel öffnet das Grillblatt');
    await seite.close();
    return;
  }
  pruefe(true, 'Ein Tipp auf die Kachel öffnet das Grillblatt');

  // Und der Grill läuft noch - das ist der Fehler aus dem Haus.
  const laeuftNoch = await seite.evaluate(async ([url, token]) => {
    const antwort = await fetch(`${url}/api/entities`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const liste = await antwort.json();
    const grill = (Array.isArray(liste) ? liste : liste.entities ?? []).find(
      (e) => e.id === 'demo.smoker'
    );
    return grill?.state?.state;
  }, [HUB, TOKEN]);
  pruefe(laeuftNoch === 'running', 'Und der Grill läuft danach noch', String(laeuftNoch));

  // Die Zieltemperatur (Punkt 565): «+» springt vom Demo-Ziel 110 zur
  // nächsten Raste 121 - und der Hub bestätigt sie.
  await seite.getByLabel('Ziel erhöhen').first().click();
  await seite.waitForTimeout(1500);
  pruefe(
    await seite.getByText('ZIEL 121°', { exact: true }).first().isVisible().catch(() => false),
    'Ein Tipp auf + hebt das Ziel auf die nächste Raste'
  );
  const zielBeimHub = await seite.evaluate(async ([url, token]) => {
    const antwort = await fetch(`${url}/api/entities`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const liste = await antwort.json();
    const grill = (Array.isArray(liste) ? liste : liste.entities ?? []).find(
      (e) => e.id === 'demo.smoker'
    );
    return grill?.state?.target;
  }, [HUB, TOKEN]);
  pruefe(Number(zielBeimHub) === 121, 'Und der Hub hat das neue Ziel', String(zielBeimHub));

  const kreis = seite.getByLabel('Fühler 2, Ziel setzen').first();
  if (!(await kreis.isVisible().catch(() => false))) {
    pruefe(false, 'Der eingesteckte Fühler lässt sich antippen');
    await seite.close();
    return;
  }
  await kreis.click();
  await seite.waitForTimeout(700);
  const stufe = seite.getByText('Schwein 63°', { exact: true }).first();
  pruefe(
    await stufe.isVisible().catch(() => false),
    'Ein Tipp darauf bietet die Garstufen an'
  );
  if (!(await stufe.isVisible().catch(() => false))) {
    await seite.close();
    return;
  }
  await stufe.click();
  await seite.waitForTimeout(1500);
  pruefe(
    await seite.getByText('ZIEL 63°', { exact: true }).first().isVisible().catch(() => false),
    'Und der Kreis zeigt das Ziel'
  );

  // Und der Hub hat es behalten - die Schicht, in der der Fehler sass.
  const gespeichert = await seite.evaluate(async ([url, token]) => {
    const antwort = await fetch(`${url}/api/grillziele`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return antwort.json();
  }, [HUB, TOKEN]);
  pruefe(
    (gespeichert?.ziele ?? []).some(
      (zeile) => zeile.entity_id === 'demo.smoker' && Number(zeile.ziel) === 63
    ),
    'Der Hub hat das Ziel behalten',
    JSON.stringify(gespeichert)
  );

  // Der Timer direkt im Blatt (Punkt 561): stellen, Restzeit lesen,
  // abbrechen - und der Hub führt ihn als Küchen-Timer.
  await seite.getByLabel('Timer stellen').first().click();
  await seite.waitForTimeout(500);
  const fuenfzehn = seite.getByText('15 Min.', { exact: true }).first();
  if (await fuenfzehn.isVisible().catch(() => false)) {
    await fuenfzehn.click();
    await seite.waitForTimeout(1500);
    const rest = await seite.getByText(/^NOCH \d+:\d\d$/).first().textContent().catch(() => null);
    pruefe(/^NOCH 1[45]:\d\d$/.test(rest ?? ''), 'Der Timer läuft im Blatt mit Restzeit', rest ?? '');
    const beimHub = await seite.evaluate(async ([url, token]) => {
      const antwort = await fetch(`${url}/api/timers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return antwort.json();
    }, [HUB, TOKEN]);
    pruefe(
      (beimHub?.timers ?? []).some((t) => t.text === 'Smoker – nachsehen'),
      'Und der Hub führt ihn als Küchen-Timer',
      JSON.stringify(beimHub)
    );
    await seite.getByLabel('Timer abbrechen').first().click();
    await seite.waitForTimeout(800);
    pruefe(
      await seite.getByLabel('Timer stellen').first().isVisible().catch(() => false),
      'Abgebrochen steht der Knopf wieder da'
    );
  } else {
    pruefe(false, 'Der Timer läuft im Blatt mit Restzeit', 'keine Minuten-Stufen');
  }

  // Zurück auf der Kachel steht es auch - sie holt die Ziele nicht mehr
  // selbst, sondern bekommt sie vom selben Stand wie das Blatt.
  // Über den Hintergrund und nicht über «Schliessen»: Den Namen trägt
  // auch ein Knopf unter dem Blatt, und der fing den Klick ab.
  await seite.getByLabel('Grill schliessen').first().click({ position: { x: 5, y: 5 } });
  await seite.waitForTimeout(700);
  const danach = await seite.getByText(/^Fühler 2:/).first().textContent();
  pruefe(
    /noch \d+ bis 63/.test(danach ?? ''),
    'Und die Kachel sagt, wie weit es noch ist',
    danach ?? ''
  );
  await seite.close();
}

/** 14. Stehen alle vier Fühler im Blatt - auch die leeren? (Punkt 555)
 *
 * Am Demo-Grill stecken zwei Fühler, und eine Fassung, die nur die
 * steckenden zeigt, sieht für sich richtig aus. Eine Messung, die nur
 * «es stehen Kreise da» prüft, bliebe also grün, während das Blatt zwei
 * Plätze verschluckt - und dann sucht man am Grill, ob man den richtigen
 * Anschluss erwischt hat. Gemessen auf dem Telefon: Dort müssen die
 * vier Kreise auch in die Breite passen.
 */
async function grillblattVierPlaetze(browser) {
  const seite = await angemeldeteSeite(browser, GROESSEN[1]);
  if (!(await zurSeite(seite, 'Räume'))) {
    await seite.close();
    return;
  }
  const terrasse = seite.getByText('Terrasse', { exact: true }).first();
  if (!(await terrasse.isVisible().catch(() => false))) {
    pruefe(false, 'Der Raum mit dem Grill war erreichbar (Telefon)');
    await seite.close();
    return;
  }
  await terrasse.click();
  await seite.waitForTimeout(1800);
  await seite.getByText(/^Fühler 2:/).first().click();
  await seite.waitForTimeout(900);

  const kreise = [];
  for (const nummer of ['1', '2', '3', '4']) {
    const kreis = seite.getByText(`P${nummer}`, { exact: true }).first();
    if (await kreis.isVisible().catch(() => false)) kreise.push(nummer);
  }
  pruefe(
    kreise.length === 4,
    'Alle vier Fühlerplätze stehen im Blatt - auch die leeren',
    `sichtbar: ${kreise.join(', ') || 'keiner'}`
  );
  // Und der leere Platz sagt das auch: «- - -°» statt einer Zahl.
  const leer = await seite.getByText('- - -°', { exact: true }).count();
  pruefe(leer >= 2, 'Die leeren Plätze zeigen keinen Wert', `gefunden: ${leer}`);
  // Auf dem Telefon darf das Blatt nicht seitlich hinausragen - vier
  // Kreise von je 150 Punkten täten das.
  const ueber = await messeUeberlauf(seite);
  pruefe(
    !ueber.zuBreit,
    'Das Grillblatt ragt auf dem Telefon nicht hinaus',
    ueber.schuldige.join(', ')
  );
  await seite.close();
}

/** 15. Öffnet «Smoker läuft» neben der Begrüssung das Grillblatt? (Punkt 563)
 *
 * Die Zeile war bisher bewusst nichts zum Tippen. Für den Grill ist sie
 * der kürzeste Weg zum Blatt - und eine Zeile, die nach Knopf aussieht
 * und keiner ist, merkt man erst am Grill.
 */
async function smokerLaeuftOeffnetBlatt(browser) {
  const seite = await angemeldeteSeite(browser, GROESSEN[0]);
  await seite.waitForTimeout(1500);
  const zeile = seite.getByText('Smoker läuft', { exact: true }).first();
  if (!(await zeile.isVisible().catch(() => false))) {
    pruefe(false, '«Smoker läuft» steht neben der Begrüssung');
    await seite.close();
    return;
  }
  pruefe(true, '«Smoker läuft» steht neben der Begrüssung');
  await zeile.click();
  await seite.waitForTimeout(900);
  pruefe(
    await seite.getByText('GRILL TEMP', { exact: true }).first().isVisible().catch(() => false),
    'Und ein Tipp darauf öffnet das Grillblatt'
  );
  await seite.close();
}

const { chromium } = playwrightLaden();
const browser = await chromium.launch({ executablePath: browserOrt() });
try {
  await ueberlauf(browser);
  await blattBleibt(browser);
  await druckKommtAn(browser);
  await terminWandert(browser);
  await kachelnStehenGleich(browser);
  await raumlisteKopfspieler(browser);
  await weitereSeiten(browser);
  await ablaufEditorPasst(browser);
  await fuehlerInZweiZimmern(browser);
  await rauchmelderNichtImZimmer(browser);
  await melderGibtSignal(browser);
  await geraetelisteOhneSpalte(browser);
  await geraetewerkzeugeUnten(browser);
  await grillzielSetzen(browser);
  await grillblattVierPlaetze(browser);
  await smokerLaeuftOeffnetBlatt(browser);
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
