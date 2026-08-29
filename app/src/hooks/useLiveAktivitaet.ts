import { useEffect } from 'react';
import { Platform } from 'react-native';

import { HubSettings } from '../api/types';
import { geraeteName } from '../lib/plattform';

/**
 * Die Haustür-Karte auf dem Sperrbildschirm (Live-Aktivität) anmelden.
 *
 * Die App kann die Karte nicht selbst aufstellen - im Moment des
 * Weggehens läuft sie nicht im Vordergrund, und nur dort dürfte sie
 * das. Also meldet sie dem Hub die nötigen Apple-Tokens, und der Hub
 * startet und beendet die Karte über einen direkten Apple-Push
 * (hub/homepilot/core/liveaktivitaet.py):
 *
 * - das «push-to-start»-Token des Geräts (zum Starten beim Weggehen),
 * - je laufender Karte deren Update-Token (zum Beenden beim Heimkommen).
 *
 * Alles hier ist doppelt abgesichert: Das native Modul gibt es nur in
 * einem Build, der es enthält (nicht in Expo Go, nicht auf Android,
 * nicht im Web), und `verfuegbar` ist erst ab iOS 17.2 wahr. Fehlt
 * etwas davon, tut der Hook nichts - die App läuft unverändert.
 */
export function useLiveAktivitaet(settings: HubSettings, connected: boolean): void {
  useEffect(() => {
    if (!connected || Platform.OS !== 'ios' || !settings.url || !settings.token) {
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

    const melden = (pfad: string, daten: Record<string, string>) => {
      // Still: Ein fehlgeschlagenes Anmelden ist kein Anlass für eine
      // Einblendung - beim nächsten App-Start kommt der nächste Versuch.
      fetch(`${settings.url.replace(/\/+$/, '')}${pfad}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ label: geraeteName(), ...daten }),
      }).catch(() => {});
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
      })
      .catch(() => {});

    return () => {
      weg = true;
      for (const abo of abos) abo?.remove?.();
    };
  }, [settings.url, settings.token, connected]);
}
