import { Dispatch, SetStateAction, useCallback, useState } from 'react';

import { Entity } from '../../api/types';

/**
 * Was gerade über der Seite liegt – und wie man es alles zumacht.
 *
 * Vierzehn Zustände für vierzehn Blätter, Menüs und Vollbilder, jeder
 * für sich harmlos. Zusammen ergaben sie eine Stelle, an der man sich
 * verlässlich vergisst: `waehleBereich` zählte sie von Hand auf, um
 * beim Bereichswechsel alles zuzumachen. Wer ein fünfzehntes Blatt
 * baut, trägt es dort ein – oder eben nicht, und dann bleibt es beim
 * Wechsel offen liegen und deckt die neue Seite zu. Der Fehler fällt
 * erst auf, wenn jemand darüber stolpert, und dann sieht es aus, als
 * hätte der Menüpunkt nichts getan.
 *
 * Also einmal an einem Ort: Wer ein Blatt dazunimmt, schreibt es hier
 * hin, und `allesZu()` kennt es von da an. Ein Test hält fest, dass es
 * wirklich alle zumacht – gezählt und nicht nachgelesen.
 *
 * **Was hier nicht hineingehört**: alles, was der Bereichswechsel
 * *behalten* soll. Halb Getipptes zum Beispiel: Der Ablauf-Editor liegt
 * als eigenes Blatt über der Leiste, dort ist der Menüpunkt gar nicht
 * erreichbar, und so bleibt er auch. Die Trennlinie ist nicht «ist es
 * ein Blatt», sondern «soll es beim Ortswechsel verschwinden».
 */
export interface Blaetter {
  /** Gerät im Vollbild (Kamera, Klingel). */
  fullscreen: string | null;
  setFullscreen: Dispatch<SetStateAction<string | null>>;
  /** Verlauf eines Geräts. */
  historyFor: string | null;
  setHistoryFor: Dispatch<SetStateAction<string | null>>;
  /** Raumbild wählen. */
  bildFuer: string | null;
  setBildFuer: Dispatch<SetStateAction<string | null>>;
  /** «Sag mir später Bescheid» zu einem Gerät. */
  erinnernAn: Entity | null;
  setErinnernAn: Dispatch<SetStateAction<Entity | null>>;
  /** Das Menü der Raumkachel. */
  raumMenue: boolean;
  setRaumMenue: Dispatch<SetStateAction<boolean>>;
  /** Der Wechsler zwischen den Einstellungsseiten. */
  wechselOffen: boolean;
  setWechselOffen: Dispatch<SetStateAction<boolean>>;
  /** Kacheln ordnen. */
  reorderOpen: boolean;
  setReorderOpen: Dispatch<SetStateAction<boolean>>;
  /** Räume ordnen. */
  roomsReorderOpen: boolean;
  setRoomsReorderOpen: Dispatch<SetStateAction<boolean>>;
  /** Das Batterieblatt. */
  batterienOffen: boolean;
  setBatterienOffen: Dispatch<SetStateAction<boolean>>;
  /** Das Sorgenblatt: was nicht in Ordnung ist. */
  sorgenOffen: boolean;
  setSorgenOffen: Dispatch<SetStateAction<boolean>>;
  /** Die allgemeine Hilfe. */
  hilfeOffen: boolean;
  setHilfeOffen: Dispatch<SetStateAction<boolean>>;
  /** Die Hilfe zu dieser einen Seite. */
  seitenhilfe: boolean;
  setSeitenhilfe: Dispatch<SetStateAction<boolean>>;
  /** Das Gäste-WLAN-Blatt. */
  wandOffen: boolean;
  setWandOffen: Dispatch<SetStateAction<boolean>>;
  /** Das Suchfeld. */
  searchOpen: boolean;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  /** Alles zumachen – beim Wechsel des Bereichs. */
  allesZu: () => void;
  /** Liegt gerade etwas darüber? Für Tests und für den Riegel. */
  etwasOffen: boolean;
}

export function useBlaetter(): Blaetter {
  const [fullscreen, setFullscreen] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [bildFuer, setBildFuer] = useState<string | null>(null);
  const [erinnernAn, setErinnernAn] = useState<Entity | null>(null);
  const [raumMenue, setRaumMenue] = useState(false);
  const [wechselOffen, setWechselOffen] = useState(false);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [roomsReorderOpen, setRoomsReorderOpen] = useState(false);
  const [batterienOffen, setBatterienOffen] = useState(false);
  const [sorgenOffen, setSorgenOffen] = useState(false);
  const [hilfeOffen, setHilfeOffen] = useState(false);
  const [seitenhilfe, setSeitenhilfe] = useState(false);
  const [wandOffen, setWandOffen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const allesZu = useCallback(() => {
    setFullscreen(null);
    setHistoryFor(null);
    setBildFuer(null);
    setErinnernAn(null);
    setRaumMenue(false);
    setWechselOffen(false);
    setReorderOpen(false);
    setRoomsReorderOpen(false);
    setBatterienOffen(false);
    setSorgenOffen(false);
    setHilfeOffen(false);
    setSeitenhilfe(false);
    setWandOffen(false);
    setSearchOpen(false);
  }, []);

  return {
    fullscreen,
    setFullscreen,
    historyFor,
    setHistoryFor,
    bildFuer,
    setBildFuer,
    erinnernAn,
    setErinnernAn,
    raumMenue,
    setRaumMenue,
    wechselOffen,
    setWechselOffen,
    reorderOpen,
    setReorderOpen,
    roomsReorderOpen,
    setRoomsReorderOpen,
    batterienOffen,
    setBatterienOffen,
    sorgenOffen,
    setSorgenOffen,
    hilfeOffen,
    setHilfeOffen,
    seitenhilfe,
    setSeitenhilfe,
    wandOffen,
    setWandOffen,
    searchOpen,
    setSearchOpen,
    allesZu,
    etwasOffen:
      fullscreen !== null ||
      historyFor !== null ||
      bildFuer !== null ||
      erinnernAn !== null ||
      raumMenue ||
      wechselOffen ||
      reorderOpen ||
      roomsReorderOpen ||
      batterienOffen ||
      sorgenOffen ||
      hilfeOffen ||
      seitenhilfe ||
      wandOffen ||
      searchOpen,
  };
}
