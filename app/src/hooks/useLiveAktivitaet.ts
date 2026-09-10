import { useEffect } from 'react';
import { Platform } from 'react-native';

import { HubSettings } from '../api/types';
import { OffenesToken, VERSUCHE_MS, tokenmeldungen } from '../lib/livetoken';
import { geraeteName } from '../lib/plattform';

/**
 * Die Karten auf dem Sperrbildschirm (Live-Aktivitäten) anmelden.
 *
 * Die App kann eine Karte nicht selbst aufstellen - im Moment des
 * Weggehens (oder wenn der Fernseher angeht) läuft sie nicht im
 * Vordergrund, und nur dort dürfte sie das. Also meldet sie dem Hub die
 * nötigen Apple-Tokens, und der Hub startet und beendet die Karten über
 * einen direkten Apple-Push (hub/homepilot/core/liveaktivitaet.py und
 * core/livekarten.py):
 *
 * - das «push-to-start»-Token des Geräts (zum Starten),
 * - je laufender Karte deren Aktivitäts-Token (zum Beenden).
 *
 * **Das zweite ist der wunde Punkt**, und daher der gemeldete Fehler
 * «der Fernseher ist aus, die Meldung liegt immer noch da»: Startet der
 * Hub eine Karte per Push, weckt iOS die App kurz auf, damit sie das
 * Token der neuen Aktivität abholt. Nur in diesem Fenster gibt es das
 * Token, ohne dass jemand die App öffnet - und ohne Token kann der Hub
 * die Karte nie beenden. Deshalb hängt hier nichts mehr an der
 * Verbindung zum Hub: Beobachtet wird, sobald die Zugangsdaten
 * dastehen, das native Modul beginnt schon beim App-Start
 * (LiveAktivitaetModule), und was es aufgehoben hat, wird nachgeholt.
 *
 * Alles hier ist doppelt abgesichert: Das native Modul gibt es nur in
 * einem Build, der es enthält (nicht in Expo Go, nicht auf Android,
 * nicht im Web), und `verfuegbar` ist erst ab iOS 17.2 wahr. Fehlt
 * etwas davon, tut der Hook nichts - die App läuft unverändert.
 */
export function useLiveAktivitaet(settings: HubSettings, erlaubt: boolean): void {
  useEffect(() => {
    if (!erlaubt || Platform.OS !== 'ios' || !settings.url || !settings.token) {
      return;
    }
    // Erst zur Laufzeit laden: In Builds ohne das Modul (Expo Go, alte
    // TestFlight-Fassungen) würde ein Import oben den Start zerlegen.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let modul: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { requireNativeModule } = require('expo-modules-core');
      modul = requireNativeModule('LiveAktivitaet');
    } catch {
      return;
    }

    let weg = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const abos: any[] = [];
    const uhren: ReturnType<typeof setTimeout>[] = [];

    /**
     * Ein Token beim Hub melden - hartnäckig, aber still.
     *
     * Hartnäckig, weil der erste Versuch im Weckfenster gut daneben
     * gehen kann: Das Telefon ist vielleicht noch nicht im WLAN daheim,
     * und ohne Wiederholung wäre das Token für immer verloren - mit ihm
     * die einzige Möglichkeit, die Karte je zu beenden. Still, weil ein
     * fehlgeschlagenes Anmelden kein Anlass für eine Einblendung ist.
     */
    const melden = (pfad: string, daten: Record<string, string>, versuch = 0) => {
      if (weg || versuch >= VERSUCHE_MS.length) return;
      const senden = () => {
        if (weg) return;
        fetch(`${settings.url.replace(/\/+$/, '')}${pfad}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${settings.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ label: geraeteName(), ...daten }),
        })
          .then((antwort) => {
            if (!antwort.ok) melden(pfad, daten, versuch + 1);
          })
          .catch(() => melden(pfad, daten, versuch + 1));
      };
      if (VERSUCHE_MS[versuch] === 0) senden();
      else uhren.push(setTimeout(senden, VERSUCHE_MS[versuch]));
    };

    modul
      .verfuegbar()
      .then((ja: boolean) => {
        if (!ja || weg) return;
        // `typ` unterscheidet die beiden Kartenarten (Haustüre und die
        // generische Karte) - Apple stellt die Start-Tokens je
        // Strukturtyp aus. Bei den generischen kommt zum Aktivitäts-
        // Token die `art` mit, damit der Hub die richtige Karte trifft.
        abos.push(
          modul.addListener(
            'onStartToken',
            ({ token, typ }: { token: string; typ?: string }) =>
              melden('/api/liveactivity/register', { token, typ: typ ?? 'tuer' })
          )
        );
        abos.push(
          modul.addListener(
            'onActivityToken',
            ({ token, art }: { token: string; typ?: string; art?: string }) =>
              melden('/api/liveactivity/activity', { token, art: art ?? '' })
          )
        );
        modul.beobachten();
        // Und nachholen, was kam, bevor hier jemand zuhörte - beim
        // Wecken im Hintergrund ist das der Normalfall, nicht die
        // Ausnahme. Ältere Hüllen kennen die Ablage nicht; dann bleibt
        // es beim bisherigen Verhalten.
        modul
          .offeneTokens?.()
          ?.then((offen: OffenesToken[]) => {
            for (const meldung of tokenmeldungen(offen ?? [])) {
              melden(meldung.pfad, meldung.daten);
            }
          })
          ?.catch(() => {});
      })
      .catch(() => {});

    return () => {
      weg = true;
      for (const abo of abos) abo?.remove?.();
      for (const uhr of uhren) clearTimeout(uhr);
    };
  }, [settings.url, settings.token, erlaubt]);
}
