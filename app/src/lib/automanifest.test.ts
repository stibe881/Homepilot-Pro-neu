import fs from 'fs';
import path from 'path';

/**
 * Der Android-Auto-Teil des Manifests - gemessen statt geglaubt.
 *
 * Der Fall, der diesen Test gekostet hat: Im Modul stand
 * `<uses-feature android:name="android.hardware.type.automotive">`, mit
 * dem Kommentar, ohne sie erscheine die App im Auto gar nicht. Falsch -
 * und teuer: Google Play nahm die Einreichung nicht an.
 *
 *   «The app cannot declare 'android.hardware.type.automotive' device
 *    feature and 'com.google.android.gms.car.application' metadata at
 *    the same time.»
 *
 * Die beiden meinen zwei Welten: `automotive` ist Android Automotive OS
 * (das System *im* Auto), die Meta-Angabe ist Android Auto (das Telefon
 * spiegelt). Zusammen widersprechen sie sich.
 *
 * Ein Test dafür ist ungewöhnlich - eine XML-Datei prüft sich sonst
 * nicht selbst. Er steht hier, weil der Fehler nirgends sonst auffällt:
 * Der Bau läuft durch, der Web-Bau auch, und erst der Play Store sagt
 * Nein - eine halbe Stunde später, im Protokoll eines Dienstes, den man
 * dafür extra öffnet.
 */

const MANIFEST = path.join(
  __dirname,
  '..',
  '..',
  'modules',
  'auto-ablage',
  'android',
  'src',
  'main',
  'AndroidManifest.xml'
);

/** Das Manifest ohne Kommentare - im Kommentar steht die Erklärung des
 *  Fehlers, und die soll den Test nicht auslösen. */
function inhalt(): string {
  return fs.readFileSync(MANIFEST, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
}

describe('AndroidManifest des Auto-Moduls', () => {
  it('meldet sich bei Android Auto an', () => {
    expect(inhalt()).toContain('com.google.android.gms.car.application');
  });

  it('nennt den Dienst und seine Schublade', () => {
    const xml = inhalt();
    expect(xml).toContain('androidx.car.app.CarAppService');
    // IoT ist die zugelassene Kategorie für eine Haussteuerung.
    expect(xml).toContain('androidx.car.app.category.IOT');
  });

  it('beansprucht kein Automotive-OS-Gerät', () => {
    // Genau diese Zeile hat die Einreichung im Play Store gekostet.
    expect(inhalt()).not.toContain('android.hardware.type.automotive');
  });
});
