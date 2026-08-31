import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts } from 'expo-font';

import { DISPLAY, DISPLAY_LEICHT } from './src/lib/schriftart';
import { LinearGradient } from 'expo-linear-gradient';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';


import { HubSettings } from './src/api/types';
import { Auffangnetz } from './src/components/Auffangnetz';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { kanaeleAnlegen } from './src/lib/kanaele';
import { knoepfeAnmelden } from './src/lib/mitteilungsknoepfe';
import { LoginScreen } from './src/screens/LoginScreen';
import { gueltig } from './src/lib/appsymbol';
import { persoenlichSetzen, persoenlichWert } from './src/lib/persoenlich';
import { startfehlerMerken, startmarke } from './src/lib/startfehler';
import { symbolWechseln } from './src/lib/symbolwechsel';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ThemeProvider, useTheme } from './src/theme';

/**
 * Benachrichtigungen auch bei offener App zeigen.
 *
 * Ohne diesen Handler wirft expo-notifications jede Nachricht weg, die
 * ankommt, während die App im Vordergrund ist – laut Doku ist genau das
 * die Voreinstellung. Der Hub hatte also recht mit «zugestellt», auf dem
 * Bildschirm passierte trotzdem nichts. Beim Klingeln oder wenn die
 * Waschmaschine fertig ist, schaut man aber oft gerade in die App.
 *
 * Steht bewusst auf Modulebene: Der Handler muss stehen, bevor die erste
 * Nachricht eintrifft, nicht erst wenn eine Komponente gemountet ist.
 */
//
// Einzeln abgesichert, wie alles hier unten: Diese vier Anweisungen
// laufen beim Laden des Moduls, also bevor React existiert. Wirft eine
// davon, nahm sie bisher die ganze App mit - und auf einem
// Release-Build sieht das aus wie ein wortloser Absturz. Jetzt fällt
// im schlimmsten Fall eine Nebensache aus, und das Haus geht auf.
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
} catch (fehler) {
  startfehlerMerken('setNotificationHandler', fehler);
}

/**
 * Die Android-Kanäle anlegen.
 *
 * Aus demselben Grund auf Modulebene wie der Handler darüber: Der Kanal
 * muss stehen, bevor die erste Nachricht eintrifft. Kommt sie früher,
 * legt Android sie in den Sammelkanal, und dort bleibt sie auch – ein
 * später angelegter Kanal holt sie nicht mehr heraus.
 *
 * Ohne `await` und mit stillem Fehlschlag: Das Anlegen ist eine
 * Nebensache beim Start und darf die App nicht aufhalten.
 */
try {
  void kanaeleAnlegen().catch(() => {});
} catch (fehler) {
  startfehlerMerken('kanaeleAnlegen', fehler);
}

/**
 * Die Knöpfe unter der Mitteilung anmelden («Später», «Erledigt»).
 *
 * Aus demselben Grund hier oben: Eine Nachricht, die vor der Anmeldung
 * eintrifft, zeigt schlicht keine Knöpfe - ohne Fehlermeldung, und man
 * sucht den Grund an der falschen Stelle.
 */
try {
  void knoepfeAnmelden().catch(() => {});
} catch (fehler) {
  startfehlerMerken('knoepfeAnmelden', fehler);
}

/**
 * Die Hintergrund-Aufgabe der Ortung registrieren (Punkt 194).
 *
 * Muss beim Laden des Moduls geschehen, nicht in einem Effekt: Wenn das
 * Betriebssystem die App wegen einer Zonengrenze weckt, gibt es keine
 * Komponente, die sie erst noch anmelden könnte.
 *
 * Auf Web bewusst nicht: Dort gibt es weder TaskManager noch
 * Hintergrund-Standort, und ein fehlschlagender Import nähme die ganze
 * Seite mit.
 */
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./src/lib/ortungstask');
  } catch (fehler) {
    // Ohne die Aufgabe meldet die App keine Zonenübertritte mehr - das
    // ist ärgerlich, aber kein Grund, das ganze Haus zuzusperren.
    startfehlerMerken('ortungstask', fehler);
  }
}

const STORAGE_KEY = 'homepilot.settings';

export default function App() {
  // undefined = lädt noch, null = noch nie konfiguriert
  const [settings, setSettings] = useState<HubSettings | null | undefined>(undefined);
  // Ohne dieses Warten zeichnet das erste Symbol, bevor die Icon-Schrift da
  // ist – und bleibt dann dauerhaft leer. Scheitert das Laden, geht es
  // trotzdem weiter: lieber ohne Symbole als gar keine Oberfläche.
  // Dazu die Display-Schrift für Begrüssung, Raumnamen und die grossen
  // Werte (lib/schriftart.ts). Scheitert sie, gilt dort Systemschrift -
  // deshalb steht sie im selben Aufruf und blockiert nichts extra.
  const [fontsLoaded, fontError] = useFonts({
    ...Ionicons.font,
    // require, kein import: Nur so nimmt Metro die Schriftdateien mit
    // ins Bundle - ein statischer import kennt keine .ttf-Assets.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    [DISPLAY]: require('./assets/fonts/FamiljenGrotesk-Bold.ttf'),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    [DISPLAY_LEICHT]: require('./assets/fonts/FamiljenGrotesk-Regular.ttf'),
  });
  // Beim ersten Start: Anmeldung oder doch der alte Weg über den QR-Code?
  const [useToken, setUseToken] = useState(false);
  const fontsSettled = fontsLoaded || fontError != null;

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        startmarke(raw ? 'Einstellungen geladen' : 'Einstellungen leer (erster Start)');
        setSettings(raw ? JSON.parse(raw) : null);
      })
      .catch(() => {
        startmarke('Einstellungen: Lesen fehlgeschlagen, weiter ohne');
        setSettings(null);
      });
  }, []);

  // Die Etappen für den Startbericht. «bereit» ist die Marke, auf die
  // die Startwache wartet - fehlt sie nach ein paar Sekunden, legt sie
  // den Bericht über den schwarzen Bildschirm.
  useEffect(() => {
    if (fontsSettled) startmarke(fontError ? 'Schrift: Fehler, weiter ohne' : 'Schrift bereit');
  }, [fontsSettled, fontError]);
  const inhaltBereit = settings !== undefined && fontsSettled;
  useEffect(() => {
    if (inhaltBereit) startmarke('bereit');
  }, [inhaltBereit]);

  const save = (next: HubSettings) => {
    setSettings(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
    // Der gewählte Anblick zusätzlich beim Hub: Hier im Gerät hält er
    // genau so lange wie die Installation, und wer nach einem neuen Build
    // wieder im hellen Blau sitzt, stellt ihn zum dritten Mal ein.
    //
    // «system» auf einem Gerät, auf dem noch nie einer stand, ist keine
    // Wahl, sondern die Vorgabe des Formulars - und würde beim ersten
    // Speichern im Profil den Anblick vom anderen Telefon löschen.
    const gewaehlt = next.theme && !(settings?.theme === undefined && next.theme === 'system');
    if (gewaehlt && next.theme !== settings?.theme) {
      persoenlichSetzen(next, 'theme', next.theme);
    }
  };

  /**
   * Den zuletzt gewählten Anblick zurückholen - einmal, nach der ersten
   * Anmeldung auf diesem Gerät.
   *
   * Nur wenn hier keiner steht: Wer gerade eben umgestellt hat, soll
   * nicht eine Sekunde später wieder das sehen, was auf dem anderen
   * Telefon gilt.
   */
  const themaGeholt = React.useRef(false);
  useEffect(() => {
    if (themaGeholt.current || !settings?.token || settings.theme) return;
    themaGeholt.current = true;
    persoenlichWert<HubSettings['theme'] | null>(settings, 'theme', null)
      .then((thema) => {
        if (!thema) return;
        setSettings((vorher) => {
          if (!vorher || vorher.theme) return vorher;
          const next = { ...vorher, theme: thema };
          AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
          return next;
        });
      })
      .catch(() => {});
  }, [settings]);

  // Das App-Symbol nachziehen, sobald die Einstellungen stehen.
  //
  // Auch beim blossen Start und nicht nur beim Wechseln: Im Web wird der
  // Favicon bei jedem Laden neu aus dem HTML gesetzt, also auch das
  // blaue - wer Pink gewählt hat, sähe sonst bis zum nächsten Wechsel
  // wieder das alte Haus im Tab.
  const symbol = settings?.appSymbol;
  useEffect(() => {
    if (settings === undefined || settings === null) return;
    symbolWechseln(gueltig(symbol));
  }, [settings, symbol]);

  return (
    <SafeAreaProvider>
      <ThemeProvider mode={settings?.theme ?? 'system'}>
        <Background>
          {settings === undefined || !fontsSettled ? null : settings === null ? (
            // Beim ersten Start die Anmeldung mit E-Mail und Passwort; der
            // QR-Code-Weg liegt einen Tipp daneben – für Wandpanels und
            // für den Fall, dass der Anmeldedienst gerade nicht mag.
            useToken ? (
              <SettingsScreen initial={null} onSave={save} onCancel={() => setUseToken(false)} />
            ) : (
              <LoginScreen initial={null} onSave={save} onUseToken={() => setUseToken(true)} />
            )
          ) : (
            // Das äusserste Netz. Weiter innen sitzen weitere, je Bereich –
            // dieses hier fängt nur, was gar nicht mehr anders zu fangen ist.
            <Auffangnetz bereich="Die App">
              <DashboardScreen settings={settings} onSaveSettings={save} />
            </Auffangnetz>
          )}
        </Background>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/** Der Verlauf muss innerhalb des Providers liegen, sonst kennt er die Palette nicht. */
function Background({ children }: { children: React.ReactNode }) {
  const { colors, dark } = useTheme();
  return (
    <LinearGradient
      colors={colors.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.background}
    >
      <StatusBar style={dark ? 'light' : 'light'} />
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  background: { flex: 1 },
});
