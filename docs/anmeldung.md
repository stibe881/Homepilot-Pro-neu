# Anmelden mit E-Mail und Passwort

Bisher war ein Token die Anmeldung: gut für ein Wandpanel, unpraktisch für
Menschen. Wer sein Telefon wechselt, braucht sonst jemanden, der ihm einen
QR-Code hinhält. Mit E-Mail und Passwort meldet sich jeder selbst an.

**Es gibt bewusst keine Selbstregistrierung.** Ein Haus ist kein Dienst,
bei dem man sich anmeldet. Wer Zugang bekommt, entscheidet der Besitzer:
Er trägt die Person unter *Benutzer* ein und schickt ihr eine Einladung.
In der E-Mail setzt sie ihr Passwort – fertig. Ohne diesen Weg gäbe es
zwei Löcher: Jeder, der die Adresse des Hubs kennt, könnte sich ein Konto
anlegen, und der Hub verschickte auf Zuruf E-Mails an Fremde.

## Ohne E-Mail: Einladung per Link und Passwort

Nicht jeder Haushalt hat Supabase eingerichtet, und nicht jeder Zugang
braucht ein Konto. Für diese Fälle gibt es unter *Benutzer* → Person →
**Einladen per Link** den zweiten Weg.

Bis dahin verschickte man den Kopplungstext als Nachricht – und der Hinweis
daneben sagte selbst, was das ist: der Schlüssel zum Haus. Ein Schlüssel,
der einmal in einem Chat liegt, liegt dort für immer: in der Sicherung des
Telefons, in der Wolke des Anbieters, in der Vorschau auf dem
Sperrbildschirm.

Jetzt reisen zwei Teile getrennt:

- Ein **Link** mit einer kurzen, zufälligen Kennung. Er allein öffnet
  nichts – er zeigt ein Feld für das Passwort.
- Ein **Passwort**, das du festlegst und auf einem anderen Weg durchgibst:
  am Telefon, persönlich, in einer anderen App. Nicht im selben Chat, sonst
  war die Übung umsonst.

Erst beides zusammen gibt den Zugang heraus. Drei Grenzen sind eingebaut:

- **Das Passwort wird nie gespeichert**, nur ein Abdruck davon (PBKDF2 mit
  Salz). Wer die `hub.data` liest, kann damit nichts anfangen – auch wir
  nicht. Wer es vergisst, stellt eine neue Einladung aus.
- **Fünf Versuche.** Eine kurze Kennung plus Passwort wäre ohne Deckel
  ratbar. Danach ist die Einladung nicht gesperrt, sondern tot.
- **Einen Tag gültig, einmal brauchbar.** Eine Einladung ist ein Türöffner,
  kein Zweitschlüssel. Je Person gibt es höchstens eine offene – eine neue
  löst die alte ab.

Der QR-Code daneben bleibt für den Fall, dass die Person neben dir steht.
Ihn kann nur abfotografieren, wer im selben Raum ist; das war nie das
Problem.

## Wie es aufgebaut ist

Die App spricht **nur mit dem Hub**. Der Hub wiederum spricht mit Supabase.
Damit bleiben die Schlüssel dort, wo sie hingehören, und die App kennt
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
der Hub schon – er ist es auch, der die Einladungen verschicken darf) und
`anon`. Nur der `anon`-Key ist neu nötig; er ist öffentlich gedacht und
erlaubt für sich allein nichts ausser dem Anmeldeversuch.

**2. In der `config.yaml`:**

```yaml
supabase:
  url: "https://dein-projekt.supabase.co"
  service_key: "${SUPABASE_SERVICE_KEY}"
  anon_key: "${SUPABASE_ANON_KEY}"

push:
  public_url: "https://homepilot.familie-gross.ch"
```

Die Umgebungsvariable `SUPABASE_ANON_KEY` gehört in die Stack-Konfiguration
in Portainer, nicht in die Datei. `push.public_url` gibt es meist schon
(für die Kamerabilder in den Push-Nachrichten); der Einladungslink führt
auf `<public_url>/einladung`.

**3. In Supabase:** *Authentication → Providers → Email* einschalten.
Unter *Authentication → URL Configuration* bei *Redirect URLs* die Adresse
`https://homepilot.familie-gross.ch/einladung` freigeben – sonst weist
Supabase den Link aus der E-Mail ab.

**3b. Die E-Mails.** Supabases Standardtext («You've been invited to
create an account») nennt HomePilot mit keinem Wort – wer ihn bekommt,
hält ihn zurecht für Werbung oder Betrug. Unter *Authentication → Emails
→ Templates* die beiden Vorlagen ersetzen:

| Vorlage | Betreff | Datei |
|---|---|---|
| Invite user | Dein Zugang zu HomePilot | [`email-vorlagen/einladung.html`](email-vorlagen/einladung.html) |
| Reset password | Neues Passwort für HomePilot | [`email-vorlagen/passwort.html`](email-vorlagen/passwort.html) |

Beide kommen ohne Bilder und ohne nachgeladene Schriften aus: Postfächer
blockieren beides, und eine Einladung, von der nur ein graues Kästchen
ankommt, wirkt erst recht unseriös.

Der **Absender** lässt sich damit nicht ändern – ohne eigenen SMTP-Server
verschickt Supabase alles als `noreply@mail.app.supabase.io`. Wer
«HomePilot &lt;post@familie-gross.ch&gt;» im Postfach stehen haben will,
hinterlegt unter *Project Settings → Authentication → SMTP Settings*
einen eigenen Mailserver. Der eingebaute Versand ist ausserdem auf wenige
Nachrichten pro Stunde begrenzt – für vier Einladungen reicht er.

**4. Hub neu starten.** Danach zeigt die App beim ersten Start die
Anmeldemaske statt der Token-Eingabe.

## Jemanden aufnehmen

In der App unter **Benutzer** die Person auswählen, dann:

1. **Anmelde-Adresse eintragen** und speichern.
2. **«Einladung schicken»** antippen.

Die Person bekommt eine E-Mail, tippt auf den Link, landet auf der Seite
`/einladung` des Hubs und setzt dort ihr Passwort. Danach meldet sie sich
in der App mit E-Mail und Passwort an.

Der Knopf funktioniert zugleich als Erinnerung: Eine zweite Einladung
ersetzt einfach die erste.

Zwei Riegel, unabhängig voneinander:

- Einladen darf nur, wer die Berechtigung **Benutzer verwalten** hat.
- Anmelden kann sich nur, wessen Adresse im Haus eingetragen ist. Ein
  Konto bei Supabase allein genügt nicht – wer mit einer unbekannten
  Adresse kommt, wird abgewiesen, mit derselben Auskunft wie bei einem
  falschen Passwort.

Das Ticket in der E-Mail ist der ganze Nachweis: Wer es hat, hat das
Postfach. Es steht im Fragment der Adresse (`#access_token=…`) und wird
deshalb nie an einen Server geschickt – die Seite gibt es bewusst an den
Hub weiter, und der spricht mit Supabase. Der Link gilt einmal und nur
begrenzt; ist er abgelaufen, sagt die Seite das und man schickt eine neue
Einladung.

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

Das Passwort ändert man über **«Passwort vergessen»** in der Anmeldemaske.
Die E-Mail kommt von Supabase und führt auf dieselbe Seite wie die
Einladung.
