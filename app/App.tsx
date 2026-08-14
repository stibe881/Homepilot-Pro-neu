import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts } from 'expo-font';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HubSettings } from './src/api/types';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ThemeProvider, useTheme } from './src/theme';

const STORAGE_KEY = 'homepilot.settings';

export default function App() {
  // undefined = lädt noch, null = noch nie konfiguriert
  const [settings, setSettings] = useState<HubSettings | null | undefined>(undefined);
  // Ohne dieses Warten zeichnet das erste Symbol, bevor die Icon-Schrift da
  // ist – und bleibt dann dauerhaft leer. Scheitert das Laden, geht es
  // trotzdem weiter: lieber ohne Symbole als gar keine Oberfläche.
  const [fontsLoaded, fontError] = useFonts(Ionicons.font);
  const fontsSettled = fontsLoaded || fontError != null;

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => setSettings(raw ? JSON.parse(raw) : null))
      .catch(() => setSettings(null));
  }, []);

  const save = (next: HubSettings) => {
    setSettings(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  };

  return (
    <SafeAreaProvider>
      <ThemeProvider mode={settings?.theme ?? 'system'}>
        <Background>
          {settings === undefined || !fontsSettled ? null : settings === null ? (
            <SettingsScreen initial={null} onSave={save} />
          ) : (
            <DashboardScreen settings={settings} onSaveSettings={save} />
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
