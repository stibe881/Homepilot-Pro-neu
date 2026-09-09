/**
 * Die Hilfe zu der Seite, auf der man gerade steht.
 *
 * Vorher gab es zwei Blätter, und beide erzählten die ganze App auf
 * einmal: die Einführung beim ersten Start (vier Schritte über Leiste,
 * «Alles aus» und Suche) und das Hilfeblatt mit drei häufigen Fragen.
 * Wer auf der Alarmseite stand und nicht weiterwusste, bekam dort einen
 * Absatz über die Bereichsleiste - richtig, aber nicht die Antwort auf
 * die Frage, die er gerade hatte. Und die Antworten *beschrieben* Wege
 * («unter Einstellungen → Verbindungen»), statt sie zu gehen.
 *
 * Deshalb hier: je Seite ein Blatt. Es sagt in einem Satz, wofür die
 * Seite da ist, dann in ein paar Punkten, was man hier tut - und wo
 * etwas woanders wohnt, trägt der Punkt ein Ziel, und die App geht
 * hin. Ein beschriebener Weg ist eine Aufgabe für den Leser; ein Knopf
 * ist keine.
 *
 * Reine Daten, kein React - damit ein Test nachhalten kann, dass jeder
 * Menüpunkt eine Hilfe hat und jedes Ziel wirklich existiert.
 */
import { SECTION_LABEL, type Section } from './bereiche';

export interface Hilfepunkt {
  text: string;
  /** Wohin es weitergeht. Ohne Ziel ist der Punkt bloss eine Auskunft. */
  ziel?: Section;
  /** Was auf dem Knopf steht. Ohne Angabe: «Zu ‹Name des Bereichs›». */
  knopf?: string;
}

export interface Seitenhilfe {
  /** Wofür die Seite da ist - ein Satz, keine Aufzählung. */
  wofuer: string;
  punkte: Hilfepunkt[];
}

export const SEITENHILFE: Partial<Record<Section, Seitenhilfe>> = {
  start: {
    wofuer:
      'Der Blick ins Haus: was gerade läuft, wer da ist, was heute ansteht.',
    punkte: [
      { text: 'Die Begrüssungskarte oben zeigt Uhrzeit, Termine und Geburtstage. Die Zeichen rechts öffnen das Gäste-WLAN und den Besuchsmodus.' },
      { text: 'Die Kacheln darunter sind die Favoriten. Welche das sind, entscheidest du in der Geräteliste.', ziel: 'devices' },
      { text: 'Was gerade läuft - Waschmaschine, Sauger, Musik - steht als Zeile unter der Begrüssung und ist antippbar.' },
    ],
  },
  home: {
    wofuer: 'Die Wohnung nach Zimmern - erst der Raum, dann die Geräte darin.',
    punkte: [
      { text: 'Ein Raum öffnet seine Kacheln. Antippen schaltet, langes Drücken öffnet die Karte mit allem, was das Gerät kann.' },
      { text: '«Alles aus» erscheint, sobald etwas an ist - für den Raum oder das ganze Haus. Laufende Haushaltgeräte bleiben verschont.' },
      { text: 'Die Reihenfolge der Kacheln lässt sich ziehen: «Anpassen» oben rechts.' },
    ],
  },
  settings: {
    wofuer: 'Alles, was man selten braucht, aber irgendwo finden muss.',
    punkte: [
      { text: 'Jeder Punkt führt auf eine eigene Seite; der Name oben ist der Wechsler zwischen ihnen.' },
      { text: 'Auf jeder dieser Seiten steht oben rechts ein Fragezeichen - dort steht dann, wofür genau diese Seite da ist.' },
      { text: 'Wer ein Gerät sucht, statt zu scrollen, nimmt die Suche in der Geräteliste.', ziel: 'devices' },
    ],
  },
  devices: {
    wofuer: 'Jedes Gerät, das der Hub kennt - auch die ausgeblendeten.',
    punkte: [
      { text: 'Die Suche findet über Name, Raum, Gruppe und Art: «Storen», «Küche» oder «Melder» genügen.' },
      { text: 'Die Knöpfe darunter beantworten die vier häufigen Fragen: Was ist nicht erreichbar, wo ist die Batterie schwach, was hat keinen Raum, was ist ausgeblendet.' },
      { text: 'Ein neu gefundenes Gerät bekommt hier Name und Raum - «Noch einzurichten» steht zuoberst, solange es offene gibt.' },
      { text: 'Was nicht in Ordnung ist, steht mit Verlauf und Quittierung im eigenen Blatt.', ziel: 'system', knopf: 'Zu System' },
    ],
  },
  alarm: {
    wofuer: 'Die Alarmanlage: welche Sensoren in welchem Modus wachen.',
    punkte: [
      { text: 'Drei Modi - Nacht, Ausser Haus, Urlaub -, und jeder bekommt seine eigene Auswahl an Sensoren. Nachts gehören meist nur Türen und Fenster dazu.' },
      { text: 'Unter jedem Sensor steht, was für einer es ist: Türkontakt, Fensterkontakt, Bewegungsmelder.' },
      { text: '«Verzögert» ist für die Türe, durch die du selbst hereinkommst; «überbrückt» für das Fenster, das gekippt bleiben soll.' },
      { text: 'Wer die Anlage schalten darf und mit welcher PIN, steht bei den Benutzern.', ziel: 'users' },
    ],
  },
  automations: {
    wofuer: 'Was das Haus von selbst tut - und die Szenen auf Knopfdruck.',
    punkte: [
      { text: 'Die Kategorien sind zugeklappt; die Zahl daneben sagt, wie viele Abläufe drin sind und wie viele davon laufen.' },
      { text: '«Push» ist ein eigener Block: alles, was aufs Telefon geht, an einem Ort.' },
      { text: 'Ein Ablauf, der nichts mehr tut, wird als «verwaist» angeschrieben - er ist seit über 90 Tagen still.' },
      { text: 'Soll heute Abend nichts von selbst geschehen, ist der Besuchsmodus der richtige Schalter.', ziel: 'besuch' },
    ],
  },
  besuch: {
    wofuer: 'Besuch oder Babysitter: die Abläufe ruhen, bis wieder Alltag ist.',
    punkte: [
      { text: 'Mit Frist endet der Modus von selbst - für den Abend, an dem garantiert niemand ans Ausschalten denkt.' },
      { text: 'Die Alarmanlage bleibt unberührt. Ein Knopf, der sie entschärft, wäre ein Loch und kein Komfort.' },
      { text: 'Welche Abläufe trotzdem laufen sollen, hakst du beim Ablauf selbst an.', ziel: 'automations' },
      { text: 'Denselben Schalter gibt es auf der Startseite hinter dem Leute-Zeichen der Begrüssungskarte.', ziel: 'start' },
    ],
  },
  personen: {
    wofuer: 'Wer wo ist - und was über wen gemeldet wird.',
    punkte: [
      { text: 'Der grüne Punkt heisst «zuhause». Wer im Haushalt steht, hat einen Zugang; darunter stehen die, die der Hub nur ortet.' },
      { text: 'Antippen zeigt die Schalter: ob eine Ankunft eine Nachricht wert ist, und an wen.' },
      { text: 'Ein spontaner Gast-Zugang entsteht direkt bei der Person - ohne Umweg über die Verwaltung.' },
      { text: 'Zugänge anlegen, sperren und Rollen ändern gehört in die Benutzerverwaltung.', ziel: 'users' },
    ],
  },
  users: {
    wofuer: 'Wer ins Haus darf - und wie weit.',
    punkte: [
      { text: 'Vier Gruppen: Haushalt, Kinder, Gäste und die Geräte an der Wand. Antippen zeigt den QR-Code zum Koppeln.' },
      { text: 'Ein Gast sieht nur die Bereiche, die du ihm gibst, und lässt sich jederzeit sperren, ohne dass er ein neues Token braucht.' },
      { text: 'Für Besuch ohne Zugang gibt es die Einmal-Türöffnung und den WLAN-Zettel - beides zuunterst auf dieser Seite.' },
      { text: 'Wo jemand gerade ist, steht nicht hier, sondern bei Familie und Freunde.', ziel: 'personen' },
    ],
  },
  account: {
    wofuer: 'Dein Konto auf diesem Gerät: Name, Passwort, Aussehen, Nachrichten.',
    punkte: [
      { text: 'Der Name im Profil ist dein Benutzername - er gilt überall: in der Verwaltung, in der Anwesenheit, als Empfänger von Nachrichten.' },
      { text: '«Meine Geräte» zeigt jede Anmeldung deines Kontos. Das vergessene iPad im Ferienhaus wirft man einzeln hinaus.' },
      { text: 'Erscheinungsbild, Wandpanel-Modus und Ortung gelten nur für dieses eine Gerät.' },
      { text: 'Wer sonst noch Zugang hat, steht in der Benutzerverwaltung.', ziel: 'users' },
    ],
  },
  connection: {
    wofuer: 'Womit dieses Gerät spricht - und was das Haus an Diensten kennt.',
    punkte: [
      { text: 'Oben steht, ob die App den Hub gerade erreicht. Adresse und Token braucht man nur beim Einrichten - sie liegen hinter «Adresse von Hand ändern».' },
      { text: 'Der QR-Code des Hubs verbindet ein neues Gerät ohne Abtippen.' },
      { text: 'Die Dienste - Kalender, Spotify, Google Home - gelten fürs ganze Haus. Jede Karte sagt, was ihr nächster Schritt ist.' },
      { text: 'Ob eine Integration läuft und was ihr fehlt, steht unter System.', ziel: 'system' },
    ],
  },
  system: {
    wofuer: 'Der Zustand des Hubs: Integrationen, Sicherung, Konfiguration.',
    punkte: [
      { text: '«Integrationen» sind die Verbindungen zu den Geräten - Homematic, Hue, Matter, Zigbee. Sie sagen je Zeile, ob sie laufen.' },
      { text: '«Zusatzteile» sind Programmteile, die der Hub dafür braucht. Fehlt eines, läuft die Integration und genau eine Funktion bleibt still - etwa die Durchsage ohne Sprachausgabe.' },
      { text: 'Der Update-Knopf baut den Hub neu und stösst die App-Builds an. Was danach läuft, steht auf derselben Seite.' },
      { text: 'Zugangsdaten und Dienste ändert man nicht hier, sondern bei den Verbindungen.', ziel: 'connection' },
    ],
  },
  energy: {
    wofuer: 'Was der Haushalt verbraucht - je Gerät und in Franken.',
    punkte: [
      { text: 'Gezählt wird, was messende Steckdosen und Geräte melden. Was nichts misst, taucht nicht auf.' },
      { text: 'Der Preis pro Kilowattstunde steht in der Hub-Konfiguration; ohne ihn zeigt die Seite nur Kilowattstunden.' },
    ],
  },
  speakers: {
    wofuer: 'Die Boxen im Haus: Gruppen, Lautstärke, Durchsagen.',
    punkte: [
      { text: 'Boxen lassen sich zu Gruppen zusammenfassen - dieselbe Musik in Küche und Stube.' },
      { text: 'Eine Durchsage spricht der Hub; das Mikrofon-Zeichen nimmt stattdessen deine Stimme auf.' },
    ],
  },
  activity: {
    wofuer: 'Was im Haus geschehen ist - der Rückblick über alle Geräte.',
    punkte: [
      { text: 'Der obere Teil übersteht einen Neustart; die Liste darunter zeigt, was seit dem Öffnen der App geschah.' },
      { text: 'Wer wissen will, warum ein Ablauf nicht lief, findet die Begründung beim Ablauf selbst.', ziel: 'automations' },
    ],
  },
  widgets: {
    wofuer: 'Knöpfe für den Homescreen und den Sperrbildschirm.',
    punkte: [
      { text: 'Bis zu vier Knöpfe. «Direkt» heisst: Der Tipp schaltet sofort, ohne dass die App aufgeht.' },
      { text: 'Neue Widgets kommen erst mit einem frisch gebauten App-Paket aufs Telefon, nicht über eine nachgeladene Fassung.' },
    ],
  },
  family: {
    wofuer: 'Der Familienalltag: Einkauf, Termine, Ämtli, Rezepte.',
    punkte: [
      { text: 'Die Listen liegen beim Hub, nicht auf dem Telefon - alle sehen dasselbe.' },
      { text: 'Ein abgehaktes Ämtli lässt sich zurücknehmen, solange die Meldung unten noch steht.' },
    ],
  },
};

/** Die Hilfe zu einem Bereich - oder nichts, wenn es keine gibt. */
export function hilfeFuer(section: Section): Seitenhilfe | null {
  return SEITENHILFE[section] ?? null;
}

/** Was auf dem Knopf eines Punktes steht (rein, testbar). */
export function knopfWort(punkt: Hilfepunkt): string {
  if (punkt.knopf) return punkt.knopf;
  return punkt.ziel ? `Zu ${SECTION_LABEL[punkt.ziel]}` : '';
}
