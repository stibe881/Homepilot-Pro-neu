import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { HubSettings } from './src/api/types';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { colors } from './src/theme';

const STORAGE_KEY = 'homepilot.settings';

export default function App() {
  // undefined = lädt noch, null = noch nie konfiguriert
  const [settings, setSettings] = useState<HubSettings | null | undefined>(undefined);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => setSettings(raw ? JSON.parse(raw) : null))
      .catch(() => setSettings(null));
  }, []);

  const save = (next: HubSettings) => {
    setSettings(next);
    setShowSettings(false);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {settings === undefined ? null : settings === null || showSettings ? (
        <SettingsScreen
          initial={settings ?? null}
          onSave={save}
          onCancel={settings ? () => setShowSettings(false) : undefined}
        />
      ) : (
        <DashboardScreen settings={settings} onOpenSettings={() => setShowSettings(true)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
