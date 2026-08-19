# Anmelden mit E-Mail und Passwort

Bisher war ein Token die Anmeldung: gut für ein Wandpanel, unpraktisch für
Menschen. Wer sein Telefon wechselt, braucht sonst jemanden, der ihm einen
QR-Code hinhält. Mit E-Mail und Passwort meldet sich jeder selbst an, und
die Bestätigungs-E-Mail beweist nebenbei, dass die Adresse stimmt.

## Wie es aufgebaut ist

Die App spricht **nur mit dem Hub**. Der Hub wiederum spricht mit Supabase.
Damit bleibt der Schlüssel dort, wo er hingehört, und die App kennt
weiterhin genau eine Adresse.

Nach erfolgreicher Anmeldung stellt der Hub eine **eigene Sitzung** aus.
Ab dann läuft alles wie bisher über ein Token im Kopf jeder Anfrage – nur
dass dieses Token nicht verteilt wurde, sondern hinter einer Anmeldung
steht.

Das ist der wichtigste Punkt: **Der Hub steuert das Haus auch ohne
Internet.** Würde jede Anfrage bei Supabase nachfragen, stünde die Wohnung
bei jeder Störung still. So braucht nur die *erste* Anmeldung auf einem
Gerät eine Verbindung nach draussen.

Gespeichert wird nur der Hashwert der Sitzung. Wer die Datendatei in die
Hände bekommt, hat damit noch keinen Zugang.

## Einrichten

**1. Supabase-Projekt.** Du hast bereits eines (für den Verlauf). Unter
*Project Settings → API* stehen zwei Schlüssel: `service_role` (den kennt
der Hub schon) und `anon`. Nur der `anon`-Key ist neu nötig – er ist
öffentlich gedacht und erlaubt für sich allein nichts ausser dem
Anmeldeversuch.

**2. In der `config.yaml`:**

```yaml
supabase:
  url: "https://dein-projekt.supabase.co"
  service_key: "${SUPABASE_SERVICE_KEY}"
  anon_key: "${SUPABASE_ANON_KEY}"
```

Die Umgebungsvariable `SUPABASE_ANON_KEY` gehört in die Stack-Konfiguration
in Portainer, nicht in die Datei.

**3. In Supabase:** *Authentication → Providers → Email* einschalten und
**«Confirm email»** aktiviert lassen – das ist die Bestätigungs-E-Mail.
Unter *Authentication → URL Configuration* die Adresse des Hubs als *Site
URL* eintragen (`https://homepilot.familie-gross.ch`), damit der Link in
der E-Mail dorthin führt.

**4. Hub neu starten.** Danach zeigt die App beim ersten Start die
Anmeldemaske statt der Token-Eingabe.

## Wer darf sich registrieren

Nur, wessen Adresse im Haus schon eingetragen ist. Sonst legte sich jeder,
der die Adresse des Hubs kennt, ein Konto an – und der Hub verschickte auf
Zuruf E-Mails an Fremde.

Also: In der App unter **Benutzer** die Person auswählen und ihre
**Anmelde-Adresse** eintragen. Das ist die Einladung. Danach kann sie in
der App auf «Konto anlegen», bekommt die Bestätigungs-E-Mail, klickt den
Link und meldet sich an.

Ein Konto bei Supabase allein genügt nicht: Wer sich mit einer nicht
eingetragenen Adresse anmeldet, wird abgewiesen.

## Was mit den alten Tokens passiert

Nichts. Sie gelten weiter und sind der Rückweg:

- **Wandpanels** koppelt man weiterhin per QR-Code – die sollen nach einem
  Stromausfall von selbst hochkommen, ohne dass jemand ein Passwort
  eintippt.
- **Ist der Anmeldedienst gestört**, führt in der Anmeldemaske ein Tipp auf
  «Stattdessen QR-Code oder Token» zum alten Weg.
- **Siri-Kurzbefehle und NFC-Aufkleber** benutzen weiterhin das feste
  Token.

## Wenn ein Telefon verloren geht

Zwei Knöpfe, beide unter Einstellungen:

- **Überall abmelden** beendet alle Sitzungen dieser Person – auf jedem
  Gerät, auch dem, auf dem man gerade tippt.
- **Neues Token ausstellen** (unter Benutzer) macht zusätzlich das feste
  Token ungültig.

Das Passwort selbst ändert man über «Passwort vergessen» – die E-Mail
kommt von Supabase.
