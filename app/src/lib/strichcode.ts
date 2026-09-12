/**
 * Eine Gutscheinnummer als Strichcode (alle rein, testbar).
 *
 * An der Kasse wird gescannt, nicht vorgelesen. Wer die Nummer vom
 * Telefon abliest, buchstabiert «B wie Berta, R, K, sieben, Bindestrich»
 * - und hinter ihm steht die Schlange. Der Code auf dem Bildschirm ist
 * derselbe, den der Laden auf die Karte druckt.
 *
 * Gerechnet und nicht geladen: Ein Strichcode ist Arithmetik, und ein
 * natives Modul dafür hiesse `runtimeVersion` hochzählen und einen
 * TestFlight-Build hinterher (siehe CLAUDE.md). Gezeichnet wird das
 * Ergebnis mit react-native-svg, das ohnehin schon dabei ist.
 *
 * Zwei Schriften, weil die Läden zwei benutzen:
 *
 * - **EAN-13** für die dreizehnstelligen Zahlen auf Geschenkkarten.
 * - **Code 128** für alles andere - Buchstaben, Bindestriche, beliebige
 *   Länge. Er ist die Schrift der Wahl, wenn man es sich aussuchen darf.
 *
 * Zurück kommen nur Balkenbreiten. Was daraus wird - Farbe, Höhe,
 * Ruhezone -, entscheidet `components/Strichcode.tsx`; so bleibt das
 * Rechnen prüfbar, ohne einen Bildschirm zu zeichnen.
 */

export type Schrift = 'ean13' | 'code128';

/** Ein Strichcode als Folge von Balken: `breit` in Modulen, `an` sagt
 *  schwarz oder weiss. */
export interface Balken {
  breit: number;
  an: boolean;
}

export interface Strichbild {
  schrift: Schrift;
  balken: Balken[];
  /** Die Zeichen, die unter dem Code stehen - bei EAN-13 mit Prüfziffer. */
  text: string;
  /** Wie viele Module der Code breit ist (für das viewBox der Zeichnung). */
  module: number;
}

// ── EAN-13 ───────────────────────────────────────────────────────────────

const EAN_L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const EAN_G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
const EAN_R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
/** Welche Hälfte der linken Seite in G-Kodierung steht - daraus liest
 *  der Scanner die erste Ziffer, die selbst gar nicht gedruckt wird. */
const EAN_MUSTER = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];

/**
 * Die Prüfziffer einer EAN (rein, testbar).
 *
 * Von rechts abwechselnd dreifach und einfach gewichtet, dann auf den
 * nächsten Zehner aufgefüllt. Wer sie falsch rechnet, bekommt einen
 * Code, den jede Kasse abweist - und zwar erst an der Kasse.
 */
export function eanPruefziffer(zwoelf: string): number {
  const ziffern = String(zwoelf).replace(/\D/g, '').slice(0, 12).padStart(12, '0');
  let summe = 0;
  for (let i = 0; i < 12; i += 1) {
    summe += Number(ziffern[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (summe % 10)) % 10;
}

/** Taugt die Nummer als EAN-13? Zwölf Ziffern (dann rechnen wir die
 *  Prüfziffer) oder dreizehn mit richtiger Prüfziffer. */
export function istEan(nummer: string): boolean {
  const ziffern = String(nummer ?? '').replace(/\D/g, '');
  if (ziffern.length === 12) return true;
  if (ziffern.length !== 13) return false;
  return eanPruefziffer(ziffern.slice(0, 12)) === Number(ziffern[12]);
}

function bitsZuBalken(bits: string): Balken[] {
  const balken: Balken[] = [];
  for (const bit of bits) {
    const an = bit === '1';
    const letzter = balken[balken.length - 1];
    if (letzter && letzter.an === an) letzter.breit += 1;
    else balken.push({ breit: 1, an });
  }
  return balken;
}

function eanBits(nummer: string): { bits: string; text: string } {
  let ziffern = String(nummer).replace(/\D/g, '');
  if (ziffern.length === 12) ziffern += String(eanPruefziffer(ziffern));
  const muster = EAN_MUSTER[Number(ziffern[0])];
  let bits = '101';
  for (let i = 1; i <= 6; i += 1) {
    const ziffer = Number(ziffern[i]);
    bits += muster[i - 1] === 'L' ? EAN_L[ziffer] : EAN_G[ziffer];
  }
  bits += '01010';
  for (let i = 7; i <= 12; i += 1) bits += EAN_R[Number(ziffern[i])];
  bits += '101';
  return { bits, text: ziffern };
}

// ── Code 128 ─────────────────────────────────────────────────────────────

/** Die Balkenbreiten der 107 Zeichen, als Ziffernfolge (sechs Paare aus
 *  schwarz/weiss). Aus der Norm übernommen; von Hand nachzurechnen wäre
 *  dieselbe Tabelle mit mehr Tippfehlern. */
const C128 = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112',
];
const START_B = 104;
const STOPP = 106;

/**
 * Code 128 in Satz B (rein, testbar).
 *
 * Satz B kann alle druckbaren Zeichen - Buchstaben, Ziffern,
 * Bindestriche. Satz C wäre für reine Ziffern kürzer, aber ein
 * Gutscheincode ist selten rein numerisch, und ein Code, der manchmal
 * anders kodiert, ist einer, den man doppelt prüfen muss.
 */
export function code128Bits(text: string): string {
  const zeichen = [...String(text)].filter((z) => {
    const code = z.charCodeAt(0);
    return code >= 32 && code <= 126;
  });
  const werte = [START_B, ...zeichen.map((z) => z.charCodeAt(0) - 32)];
  // Die Prüfsumme: Startzeichen einfach, danach mit der Stelle gewichtet.
  let summe = werte[0];
  for (let i = 1; i < werte.length; i += 1) summe += werte[i] * i;
  werte.push(summe % 103, STOPP);
  return werte
    .map((wert) =>
      [...C128[wert]]
        .map((breite, index) => (index % 2 === 0 ? '1' : '0').repeat(Number(breite)))
        .join('')
    )
    .join('');
}

/**
 * Die Nummer als Strichbild - oder null (rein, testbar).
 *
 * Null, wenn nichts dasteht oder nur Zeichen, die keine Schrift kennt:
 * Ein leerer Code auf dem Bildschirm ist schlimmer als keiner, weil man
 * damit an die Kasse geht.
 */
export function strichbild(nummer: string | null | undefined): Strichbild | null {
  const roh = String(nummer ?? '').trim();
  if (!roh) return null;
  if (istEan(roh)) {
    const { bits, text } = eanBits(roh);
    return { schrift: 'ean13', balken: bitsZuBalken(bits), text, module: bits.length };
  }
  const druckbar = roh.replace(/[^\x20-\x7e]/g, '');
  if (druckbar.length === 0) return null;
  const bits = code128Bits(druckbar);
  return { schrift: 'code128', balken: bitsZuBalken(bits), text: druckbar, module: bits.length };
}

// ── Welches Bild an die Kasse gehört (Punkt 420 der Werkbank) ────────────

/** Womit die Kasse den Gutschein liest. */
export type Codeart = 'strich' | 'qr';

/**
 * Ab so vielen Zeichen taugt Code 128 auf einem Telefon nicht mehr.
 *
 * Jedes Zeichen sind elf Module; bei dreissig Zeichen liegt der Code
 * über dreihundert Module breit, und auf einem Bildschirm von sieben
 * Zentimetern ist ein Modul dann dünner als ein Fünftelmillimeter.
 * Gezeichnet wird er trotzdem - lesen kann ihn keine Kasse mehr. Lieber
 * ein QR-Code, der lange Inhalte gerade dafür gebaut hat.
 */
export const STRICH_MAX = 24;

/**
 * Lässt sich diese Nummer sinnvoll als Strichcode zeigen? (rein, testbar)
 *
 * Eine dreizehnstellige EAN immer - das ist die Schrift der
 * Geschenkkarten. Sonst nur, was kurz genug ist und wie eine Nummer
 * aussieht: Ein Leerzeichen oder ein «https://» darin heisst, dass da
 * gar keine Nummer steht, sondern eine Adresse - und die stand auf der
 * Karte mit Sicherheit als QR-Code.
 */
export function strichTauglich(nummer: string | null | undefined): boolean {
  const roh = String(nummer ?? '').trim();
  if (!roh) return false;
  if (istEan(roh)) return true;
  if (roh.length > STRICH_MAX) return false;
  if (/\s|:\/\//.test(roh)) return false;
  return strichbild(roh) !== null;
}

/**
 * Was an der Kasse gezeigt wird - oder null (rein, testbar).
 *
 * `gewuenscht` ist, was am Gutschein steht: Beim Scannen merkt sich die
 * App, welche Schrift die Kamera gelesen hat, und von Hand lässt es
 * sich im Formular umstellen. Ohne Angabe entscheidet die Nummer
 * selbst - so bekommen auch die Gutscheine von vor dieser Frage das
 * richtige Bild, statt einen Strichcode, den niemand scannen kann.
 *
 * Null heisst: gar nichts zeigen. Ein leeres Feld an der Kasse ist
 * schlimmer als keins, weil man mit ihm losfährt.
 */
export function kassenart(
  nummer: string | null | undefined,
  gewuenscht?: Codeart | null
): Codeart | null {
  const roh = String(nummer ?? '').trim();
  if (!roh) return null;
  if (gewuenscht === 'qr') return 'qr';
  // Auch ein ausdrückliches «Strichcode» kann nicht gelten, wenn keine
  // Schrift die Zeichen hergibt - dann ist QR das einzige Bild, das
  // bleibt. Widerspricht der Angabe, ist aber das, was hilft.
  return strichTauglich(roh) ? 'strich' : 'qr';
}

/**
 * Was die Kamera gelesen hat, als Codeart (rein, testbar).
 *
 * `expo-camera` meldet die Schrift beim Scannen mit («qr», «ean13»,
 * «code128», auch «datamatrix» oder «aztec»). Nur «qr» wird hier zu
 * einem QR-Code: Gezeichnet werden kann ohnehin nur diese eine
 * Flächenschrift, und die anderen als QR auszugeben hiesse, an der
 * Kasse ein Bild zu zeigen, das dort nie stand. Was daraus kein
 * Strichcode werden kann, fängt `kassenart` am Inhalt wieder ab.
 */
export function gescannteArt(art: string | null | undefined): Codeart {
  return String(art ?? '').trim().toLowerCase() === 'qr' ? 'qr' : 'strich';
}
