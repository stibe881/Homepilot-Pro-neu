import React from 'react';
import { Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Codeart, kassenart } from '../lib/strichcode';
import { Strichcode } from './Strichcode';

/**
 * Das Bild, das an der Kasse über den Scanner geht (Punkt 420 der Werkbank).
 *
 * Bis hierher zeichnete die App immer einen Strichcode - auch für die
 * Gutscheine, die auf der Karte einen QR-Code tragen. Aus einem
 * QR-Inhalt einen Code 128 zu machen ist keine Übersetzung: Die Kasse
 * erwartet das eine Bild und bekommt das andere, und gemerkt hat man es
 * dort, wo die Schlange steht.
 *
 * Welche Schrift es ist, weiss die App aus zwei Quellen: Beim Scannen
 * meldet die Kamera mit, was sie gelesen hat, und im Formular lässt es
 * sich umstellen. Steht nichts da, entscheidet die Nummer selbst
 * (`kassenart` in lib/strichcode.ts).
 *
 * Weiss und schwarz, auch im dunklen Thema - aus demselben Grund wie
 * beim Strichcode: Ein Scanner misst den Unterschied zwischen hell und
 * dunkel, und ein hellgrauer Code auf dunklem Grund ist für ihn keiner.
 */
export function Kassencode({
  nummer,
  art,
  hoehe = 120,
}: {
  nummer: string | null | undefined;
  /** Was am Gutschein steht; ohne Angabe entscheidet die Nummer. */
  art?: Codeart | null;
  /** Höhe des Strichcodes bzw. Kantenlänge des QR-Codes. */
  hoehe?: number;
}) {
  const gewaehlt = kassenart(nummer, art);
  if (!gewaehlt) return null;
  if (gewaehlt === 'strich') return <Strichcode nummer={nummer} hoehe={hoehe} />;

  // Der QR-Code bleibt quadratisch und wächst nicht auf die Zeilenbreite:
  // Ein Scanner braucht die Ruhezone rundum, und in die Breite gezogen
  // wäre er keiner mehr. Deshalb hier eine Kantenlänge statt `stretch`.
  const kante = Math.max(160, hoehe * 2);
  const text = String(nummer ?? '').trim();
  return (
    <View
      accessibilityLabel={`QR-Code ${text}`}
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 8,
        padding: 16,
        alignItems: 'center',
        gap: 10,
      }}
    >
      <QRCode value={text} size={kante} backgroundColor="#FFFFFF" color="#000000" />
      {/* Der Inhalt darunter, wie die Ziffern unter dem Strichcode: Wenn
          der Scanner streikt, tippt die Kassiererin ab. Eine lange
          Adresse darf dabei umbrechen - abgeschnitten wäre sie wertlos. */}
      <Text
        style={{
          color: '#000000',
          fontSize: 13,
          letterSpacing: 1,
          textAlign: 'center',
        }}
      >
        {text}
      </Text>
    </View>
  );
}
