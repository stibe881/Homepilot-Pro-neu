/**
 * Der Babysitter-Abend: Zugang, Modus und die Handgriffe dazu.
 *
 * Zwei Dinge, die man auseinanderhalten muss: Der Zugang lässt jemanden
 * in die App, der Modus hält die Abläufe zurück, die «niemand zuhause»
 * annehmen. Beides gehört auf dieselbe Seite, aber an eigene Schalter -
 * man will den einen ohne den anderen haben können.
 */
import { useCallback, useEffect, useState } from 'react';

import { HubClient } from '../../api/client';
import { BabysitterStand, LEERER_BABYSITTER } from '../../lib/babysitter';
import { babysitterFrist, passwortHinweis } from '../../lib/einladung';
import {
  BABYSITTER_FEATURES,
  BABYSITTER_USER,
  babysitterKonto,
  babysitterZugang,
  istBabysitterKonto,
} from '../../lib/familie';
import { FamilyItem, ModuleKey } from './bausteine';

export function useBabysitterabend({
  hub,
  darfBenutzer,
  view,
  melde,
}: {
  hub: HubClient;
  /** Nur Eltern dürfen Zugänge anlegen - sonst wird gar nicht erst geladen. */
  darfBenutzer: boolean;
  /** Das offene Modul. Geladen wird erst, wenn man auf der Seite steht. */
  view: ModuleKey | null;
  /** Fehler in die Zeile ganz oben. */
  melde: (text: string) => void;
}) {
  // Babysitter-Zugang: der Gastbenutzer und sein frisches Token.
  const [babysitterUser, setBabysitterUser] = useState<FamilyItem | null>(null);
  // Das Passwort für den Abend und der Link, der daraus entsteht. Das
  // Token stand hier einmal im Klartext – von dort war es einen Tipp
  // weit in einen Chat.
  const [babysitterPass, setBabysitterPass] = useState('');
  const [babysitterLink, setBabysitterLink] = useState<string | null>(null);
  // Der Hinweis gehört in die Karte, nicht in die Fehlerzeile weit
  // oben: Wer auf «bis 21:00» tippt und nichts passieren sieht, hält
  // den Knopf für kaputt.
  const [babysitterNote, setBabysitterNote] = useState<string | null>(null);
  // Punkt 187: Mehrere Babysitter, jeder mit eigenem Zugang.
  const [babysitterKonten, setBabysitterKonten] = useState<FamilyItem[]>([]);
  const [babysitterName, setBabysitterName] = useState('');
  // Punkt 184: «So sieht es der Babysitter» – zeigt die Lücken vorher.
  const [babysitterVorschau, setBabysitterVorschau] = useState(false);

  const babysitterAktiv = !!babysitterUser?.enabled;
  // Der Modus ist etwas anderes als der Zugang: Der Zugang lässt jemanden
  // in die App, der Modus hält die Abläufe zurück, die «niemand zuhause»
  // annehmen. Beides gehört auf dieselbe Seite, aber an eigene Schalter -
  // man will den einen ohne den anderen haben können.
  const [modus, setModus] = useState<BabysitterStand>(LEERER_BABYSITTER);
  const [ablaufZahl, setAblaufZahl] = useState(0);

  const ladeBabysitter = useCallback(() => {
    if (!darfBenutzer) return;
    hub
      .get<FamilyItem[]>('/api/users', { still: true })
      .then((liste) => {
        // Punkt 187: Es gibt nicht mehr «den» Babysitter, sondern je
        // Person einen Zugang - dann steht im Protokoll auch, wer da war.
        const konten = (Array.isArray(liste) ? liste : []).filter(istBabysitterKonto);
        setBabysitterKonten(konten);
        setBabysitterUser(konten.find((user) => user.enabled) ?? konten[0] ?? null);
      })
      .catch(() => {
        setBabysitterKonten([]);
        setBabysitterUser(null);
      });
  }, [hub, darfBenutzer]);

  const ladeModus = useCallback(() => {
    hub
      .get<{ automations?: unknown[]; babysitter?: BabysitterStand } | null>(
        '/api/automations',
        { fallback: null, still: true }
      )
      .then((daten) => {
        setModus(daten?.babysitter ?? LEERER_BABYSITTER);
        setAblaufZahl(daten?.automations?.length ?? 0);
      });
  }, [hub]);

  const schalteModus = async (active: boolean) => {
    try {
      const antwort = await hub.post<{ babysitter?: BabysitterStand }>(
        '/api/automations/babysitter',
        { active },
        { still: true }
      );
      setModus(antwort?.babysitter ?? LEERER_BABYSITTER);
    } catch (err) {
      melde(
        `Babysitter-Modus nicht umgestellt (${err instanceof Error ? err.message : err})`
      );
    }
  };

  useEffect(() => {
    if (view === 'babysitter') {
      ladeBabysitter();
      ladeModus();
    }
  }, [view, ladeBabysitter, ladeModus]);

  const oeffneBabysitter = async (bis: string) => {
    // Erst das Passwort, dann die Türe: Ohne wäre der Link allein der
    // Schlüssel, und genau das wollten wir nicht mehr.
    const mangel = passwortHinweis(babysitterPass);
    if (mangel) {
      setBabysitterNote(`Zuerst ein Passwort setzen – ${mangel}`);
      return;
    }
    setBabysitterNote(null);
    const zugang = babysitterZugang(new Date(), bis);
    const konto = babysitterKonto(babysitterName);
    const vorhanden = babysitterKonten.find((user) => user.name === konto);
    try {
      if (vorhanden) {
        await hub.put(
          `/api/users/${encodeURIComponent(konto)}`,
          { enabled: true, features: BABYSITTER_FEATURES, ...zugang },
          { still: true }
        );
      } else {
        const antwort = await hub.post<{ user?: FamilyItem; token?: string }>(
          '/api/users',
          {
            name: konto,
            role: 'gast',
            features: BABYSITTER_FEATURES,
            ...zugang,
          },
          { still: true }
        );
        // Das Token wird nicht mehr angezeigt: Es stand hier im
        // Klartext und wanderte von dort in einen Chat. Statt seiner
        // gibt es unten einen Link mit Passwort.
        void antwort;
      }
      // Der Zugang steht – jetzt der Weg hinein. Der Link allein öffnet
      // nichts; das Passwort gibt man der Babysitterin am Telefon oder
      // an der Türe durch.
      const einladung = await hub.post<{ link: string; expires: number }>(
        `/api/users/${encodeURIComponent(konto)}/einladung`,
        {
          password: babysitterPass,
          minutes: babysitterFrist(new Date(), bis),
        },
        { still: true }
      );
      setBabysitterLink(einladung?.link ?? null);
      setBabysitterPass('');
      ladeBabysitter();
    } catch (err) {
      melde(
        `Zugang nicht geöffnet (${err instanceof Error ? err.message : err})`
      );
    }
  };

  /**
   * «Noch eine Stunde» (Punkt 185).
   *
   * Wenn es später wird, legt man sonst den Zugang neu an - und der
   * Babysitter muss sich neu anmelden, mitten im Abend.
   */
  const verlaengereBabysitter = async (konto: FamilyItem) => {
    const bisher = String(konto.hours?.to ?? '22:00');
    const [stunde, minute] = bisher.split(':').map(Number);
    const spaeter = `${String((stunde + 1) % 24).padStart(2, '0')}:${String(
      minute || 0
    ).padStart(2, '0')}`;
    try {
      await hub.put(
        `/api/users/${encodeURIComponent(String(konto.name))}`,
        { hours: { ...(konto.hours ?? {}), to: spaeter } },
        { still: true }
      );
      ladeBabysitter();
    } catch (err) {
      melde(
        `Zugang nicht verlängert (${err instanceof Error ? err.message : err})`
      );
    }
  };

  const schliesseBabysitter = async (name?: string) => {
    try {
      await hub.put(
        `/api/users/${encodeURIComponent(name ?? String(babysitterUser?.name ?? BABYSITTER_USER))}`,
        { enabled: false },
        { still: true }
      );
      setBabysitterLink(null);
      ladeBabysitter();
    } catch (err) {
      melde(
        `Zugang nicht geschlossen (${err instanceof Error ? err.message : err})`
      );
    }
  };

  return {
    babysitterAktiv,
    babysitterUser,
    babysitterKonten,
    babysitterName,
    setBabysitterName,
    babysitterPass,
    setBabysitterPass,
    babysitterLink,
    babysitterNote,
    babysitterVorschau,
    setBabysitterVorschau,
    modus,
    ablaufZahl,
    schalteModus,
    oeffneBabysitter,
    verlaengereBabysitter,
    schliesseBabysitter,
  };
}
