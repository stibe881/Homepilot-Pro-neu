/**
 * Ein neues Gerät anlernen - die Rechnerei dazu (Punkt 632 der Werkbank).
 *
 * Zigbee: «Permit join» gab es nur an der Zigbee2MQTT-Oberfläche auf
 * Port 8099; Matter: `pair(code)` nur an der Kommandozeile des
 * Hub-Rechners. Beides steht jetzt unter Einstellungen → Verbindungen,
 * neben der Fernseher-Kopplung - dort, wo Einrichten zuhause ist. Der
 * Hub meldet Restzeit und die Geräte, die angeklopft haben
 * (`/api/verbindungen/anlernen`); hier stehen die Sätze dazu.
 */

/** Ein Gerät, das seit dem Öffnen des Netzes angeklopft hat. */
export interface Gefunden {
  name: string;
  model: string;
  status: 'joined' | 'successful' | 'failed' | 'unsupported' | string;
  at?: number;
}

export interface AnlernStand {
  offen: boolean;
  rest: number;
  gefunden: Gefunden[];
  verbunden?: boolean;
}

/** So lange steht das Netz offen, wenn niemand etwas anderes wählt. */
export const ANLERN_MINUTEN = 4;

/** «noch 3:07» - die Restzeit als Uhr (rein, testbar). */
export function restText(sekunden: number): string {
  const rest = Math.max(0, Math.round(sekunden));
  const minuten = Math.floor(rest / 60);
  const sek = rest % 60;
  return `noch ${minuten}:${sek < 10 ? '0' : ''}${sek}`;
}

/**
 * Die Zeile je gefundenem Gerät (rein, testbar).
 *
 * «Aqara Türkontakt gefunden» ist der Satz, für den das Ganze da ist.
 * Vorher steht «klopft an», und ein Gerät, das Zigbee2MQTT nicht kennt,
 * bekommt keine Kachel - das soll hier stehen, statt dass man wartet.
 */
export function gefundenZeile(eintrag: Gefunden): string {
  const wer = eintrag.model || eintrag.name;
  switch (eintrag.status) {
    case 'joined':
      return `${wer} klopft an …`;
    case 'successful':
      return `${wer} gefunden`;
    case 'unsupported':
      return `${wer} gefunden – Zigbee2MQTT kennt dieses Modell nicht, es bekommt keine Kachel`;
    case 'failed':
      return `${wer} – das Anlernen ist gescheitert, noch einmal die Taste am Gerät drücken`;
    default:
      return wer;
  }
}

/** Der Satz über dem Knopf, je nach Lage (rein, testbar). */
export function anlernSatz(stand: AnlernStand | null): string {
  if (!stand) return 'Der Hub sagt gerade nichts über Zigbee.';
  if (stand.verbunden === false) return 'Kein Broker – Zigbee2MQTT läuft gerade nicht.';
  if (stand.offen) {
    return `Das Netz ist offen (${restText(stand.rest)}). Jetzt die Anlerntaste am Gerät drücken.`;
  }
  return 'Das Netz ist zu. Öffnen, dann die Anlerntaste am Gerät drücken.';
}

/**
 * Lässt sich das als Matter-Code an den Hub schicken? (rein, testbar)
 *
 * Dieselbe Regel wie im Hub (routes/verbindungen.py, matter_code_sauber):
 * der QR-Inhalt «MT:…» oder elf beziehungsweise einundzwanzig Ziffern,
 * gern mit Bindestrichen. Geprüft wird vor dem Senden, damit der Knopf
 * nicht dreissig Sekunden lang auf eine Absage wartet.
 */
export function matterCodeGueltig(text: string): boolean {
  const code = String(text ?? '').trim();
  if (/^mt:/i.test(code)) return code.length > 3;
  const ziffern = code.replace(/[-\s]/g, '');
  return /^\d+$/.test(ziffern) && (ziffern.length === 11 || ziffern.length === 21);
}

/** Was nach dem Koppeln dasteht (rein, testbar). */
export function gekoppeltSatz(geraete: string[], nodeId: number | null | undefined): string {
  if (geraete.length > 0) return `Aufgenommen: ${geraete.join(', ')}.`;
  return nodeId != null
    ? `Als Knoten ${nodeId} aufgenommen – der Hub erkennt darin noch kein Gerät.`
    : 'Aufgenommen.';
}
