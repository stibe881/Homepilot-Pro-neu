# WCAG-Audit: www.sonnenberg-baar.ch

**Geprüft am:** 1. September 2026
**Prüfgegenstand:** Öffentliche Website der Stiftung SONNENBERG, Baar ZG –
Kompetenzzentrum Sehen, Verhalten, Sprechen (WordPress mit Avada/Fusion-Builder)
**Massstab:** WCAG 2.1/2.2, Konformitätsstufe AA (Referenznorm EN 301 549)
**Anlass:** Teilrevision des Behindertengleichstellungsgesetzes (BehiG),
geplantes Inkrafttreten 1. Januar 2027

---

## 1. Management Summary

Die Website ist in einem **überdurchschnittlich guten Grundzustand**: Sprachauszeichnung,
Skip-Link, Landmarken, Alt-Attribute, Formular-Beschriftungen, Zoom- und
Reflow-Verhalten sowie die Kontraste der definierten Markenfarben sind
weitgehend in Ordnung – für ein Kompetenzzentrum, das unter anderem blinde und
sehbehinderte Menschen begleitet, eine gute Ausgangslage.

**AA-konform ist die Seite aber noch nicht.** Das Audit fand **7 Befunde mit
Handlungsbedarf**, davon 4 mit direktem WCAG-AA-Verstoss auf praktisch allen
Seiten. Am schwersten wiegen: unbenannte Icon- und Bild-Links (Warenkorb auf
jeder Seite, 14 Produktlinks im Shop), fehlende sichtbare Tastatur-Fokusanzeige
in der Hauptnavigation, nur durch Farbe erkennbare Textlinks sowie ein
Google-reCAPTCHA im Bewerbungsformular. Alle Befunde sind mit überschaubarem
Aufwand behebbar; ein grosser Umbau ist nicht nötig.

## 2. Rechtlicher Rahmen: Was ab 2027 in der Schweiz gilt

**Heutige Lage.** Das geltende BehiG verpflichtet nur Gemeinwesen (Bund,
Kantone, konzessionierte Betriebe) zu barrierefreien Online-Angeboten. Private
Anbieter trifft bisher lediglich ein Diskriminierungsverbot ohne
Barrierefreiheits-Pflicht.

**Teilrevision BehiG (E-BehiG).** Der Bundesrat hat die Botschaft am
20. Dezember 2024 ans Parlament überwiesen; die Inkraftsetzung ist per
**1. Januar 2027** geplant (Vorbehalt: parlamentarische Beratung und
Referendumsfrist). Kernpunkte:

- **Erstmals werden Private verpflichtet**, die öffentlich zugängliche
  kommerzielle oder kulturelle Dienstleistungen anbieten – ausdrücklich auch
  digitale Dienstleistungen wie Websites, Online-Shops, Buchungs- und
  Kontaktportale.
- **Massstab ist die EN 301 549**, d. h. WCAG-Konformitätsstufe **AA**
  (aktuell WCAG 2.1; die Aktualisierung der Norm auf WCAG 2.2 ist
  angekündigt – wer heute saniert, nimmt sinnvollerweise gleich 2.2 AA als
  Ziel).
- **Ausnahme für Kleinstunternehmen:** weniger als 10 Beschäftigte und
  höchstens rund 2 Mio. Jahresumsatz bzw. Bilanzsumme.
- Daneben gilt für Anbieter mit Kundschaft in der EU seit **28. Juni 2025**
  bereits der **European Accessibility Act (EAA)**.

**Einordnung für den SONNENBERG.** Die Stiftung beschäftigt deutlich mehr als
10 Personen und bietet öffentlich zugängliche Dienstleistungen an (Beratung,
Fachstelle, Therapieangebote, Online-Shop mit Warenkorb, Spenden). Sie fällt
damit nach heutigem Entwurfsstand in den Anwendungsbereich der Revision.
Unabhängig von der juristischen Pflicht ist Barrierefreiheit für ein
Kompetenzzentrum mit dem Schwerpunkt Sehen/Blindheit Teil der eigenen
Glaubwürdigkeit – die Zielgruppe der Website ist zu einem erheblichen Teil
genau die, die von Barrieren betroffen ist.

## 3. Methodik

- **Automatisiert:** axe-core (Deque) über Playwright/Chromium, Regelsätze
  WCAG 2.0/2.1 A+AA, WCAG 2.2 AA und Best Practices, auf **13 Seiten**:
  Startseite, Angebot (Übersicht und Detail «Sehen»), Fachstelle Sehen,
  Organisation, Kontakt, Intake, Shop, Jobs, Pinnwand, News-Artikel, Spenden.
- **Ergänzend gemessen:** Tastaturbedienung (25 Tab-Stopps, Fokus-Sichtbarkeit),
  Reflow bei 320 px Breite, Kontrastberechnung der zentralen Farbpaare,
  Viewport-/Zoom-Verhalten, Landmarken, Formular-Beschriftungen,
  Bewegtinhalte.
- **Grenzen:** Automatische Tests decken erfahrungsgemäss nur 30–50 % der
  WCAG-Kriterien ab. Nicht geprüft wurden u. a. Screenreader-Nutzungsfluss
  (VoiceOver/NVDA), die Barrierefreiheit der verlinkten PDFs, der
  Bestellprozess im Shop hinter dem Warenkorb sowie Verständlichkeit der
  Sprache. Diese Punkte stehen in Abschnitt 6.

## 4. Was bereits gut ist

| Bereich | Befund |
| --- | --- |
| Sprache | `lang="de"` korrekt gesetzt, aussagekräftige Seitentitel auf allen Seiten |
| Struktur | Skip-Link «Zum Inhalt springen» als erster Tab-Stopp; `main`- und `nav`-Landmarken vorhanden |
| Bilder | Kein einziges `<img>` ohne Alt-Attribut (Schmuckbilder korrekt mit leerem Alt) |
| Formulare | Suchfeld und Formularfelder fast durchgehend beschriftet |
| Zoom/Reflow | Kein Zoom-Blocking im Viewport-Meta; bei 320 px Breite kein horizontaler Überlauf (WCAG 1.4.10 erfüllt) |
| Kontrast der Markenfarben | Gelber Button mit schwarzem Text 11.7:1, grüne Textlinks auf Weiss 9.1:1, Cookie-Leiste 10.0:1 bzw. 7.5:1 – alles deutlich über AA |
| Bewegtinhalte | Keine Autoplay-Slider, -Videos oder Laufschriften gefunden (WCAG 2.2.2) |

## 5. Befunde mit Handlungsbedarf

Sortiert nach Dringlichkeit. «Alle Seiten» heisst: auf allen 12 erfolgreich
geprüften Seiten vorhanden (Header/Footer-Template).

### A1 – Icon- und Bild-Links ohne zugänglichen Namen
**WCAG 2.4.4 / 4.1.2 (Stufe A) · axe «link-name», serious · alle Seiten + Shop**

Der Warenkorb-Link im Kopfbereich (`awb-menu__main-a_icon-only`) hat weder
Text noch `aria-label` – Screenreader lesen «Link» ohne Ziel vor, und das auf
jeder Seite. Im Shop kommen **14 Produkt-Bildlinks** ohne Namen dazu
(`fusion-column-anchor` mit Hintergrundbild). Zusätzlich trägt das Logo den
Dateinamen als Alt-Text («Logo_Sonnenberg_Baar_CMYK_o_Tagline») statt z. B.
«SONNENBERG – zur Startseite».

**Empfehlung:** `aria-label="Warenkorb"` auf den Icon-Link; im Shop den
Produktnamen als Linktext bzw. `aria-label`; Logo-Alt-Text im Avada-Theme
ersetzen.

### A2 – Tastatur-Fokus in der Hauptnavigation nicht sichtbar
**WCAG 2.4.7 (Stufe AA) · eigene Messung · alle Seiten**

Beim Durch-Tabben zeigen die Einträge der Hauptnavigation (Intake, Shop,
Jobs, Medien, Spenden, «Angebot», «Kompetenzen», «Über uns», Kontakt, Suche)
und auch der Skip-Link **keine sichtbare Fokusmarkierung** (weder Outline
noch Box-Shadow). Nur die Untermenü-Einträge erhalten die Browser-Outline.
Tastaturnutzende – darunter viele sehbehinderte Menschen – verlieren so die
Orientierung. Zudem landet der Fokus auf einem **unsichtbaren
Instagram-Link** (Tab-Stopp ohne sichtbare Fläche).

**Empfehlung:** durchgehende `:focus-visible`-Gestaltung (z. B. 2 px Outline
in Gelb/Weiss je nach Untergrund) im Theme aktivieren; unsichtbare, aber
fokussierbare Elemente mit `tabindex="-1"` bzw. `display:none` aus der
Tab-Reihenfolge nehmen.

### A3 – Links im Fliesstext nur durch Farbe erkennbar
**WCAG 1.4.1 (Stufe A) · axe «link-in-text-block», serious · u. a. Angebot/Sehen, Kontakt, Intake, News-Artikel**

Textlinks (z. B. auf die Datenschutzerklärung) unterscheiden sich vom
umgebenden Text nur durch die grüne Farbe; der Farbabstand zum schwarzen
Fliesstext liegt unter dem geforderten Wert von 3:1, und eine
Unterstreichung fehlt.

**Empfehlung:** Fliesstext-Links generell unterstreichen (eine Zeile CSS im
Theme) – löst den Befund siteweit.

### A4 – Google-Maps-iframe ohne Titel
**WCAG 4.1.2 (Stufe A) · axe «frame-title», serious · Kontakt**

Der eingebettete Kartenausschnitt hat kein `title`-Attribut; Screenreader
können den Rahmen nicht benennen.

**Empfehlung:** `title="Karte: Standort SONNENBERG, Landhausstrasse 20, Baar"`.

### B1 – Überschriften-Hierarchie lückenhaft
**WCAG 1.3.1 (Stufe A, Grenzfall) / Best Practice · mehrere Seiten**

- Keine `<h1>` auf /angebot/, /ueber-uns/organisation/ und /kontakt/;
  /spenden-2/ hat deren vier.
- Sprünge in der Hierarchie (h1 → h3, Team-Namen als h4 ohne
  Zwischenebenen) auf 8 der 12 Seiten.
- Leere Überschriften-Tags auf Kontakt (2×) und Spenden (3×) –
  Fusion-Builder-Elemente ohne Inhalt.

**Empfehlung:** Pro Seite genau eine H1; leere Title-Elemente im Builder
entfernen; Ebenen der Reihe nach nutzen. Für Screenreader-Nutzende ist die
Überschriftenliste das wichtigste Navigationsmittel.

### B2 – reCAPTCHA und unbeschriftetes Feld im Bewerbungsformular
**WCAG 1.1.1 / 1.3.1 / 3.3.2 · Jobs**

Das Bewerbungsformular nutzt Google reCAPTCHA v2 («Ich bin kein Roboter») –
für blinde und motorisch eingeschränkte Menschen eine bekannte, teils
unüberwindbare Hürde – und enthält eine Textarea ohne Beschriftung. Der
reCAPTCHA-iframe hat zwar einen Titel, die Bildaufgaben selbst sind jedoch
visuell.

**Empfehlung:** Textarea mit `<label>` versehen. reCAPTCHA durch eine
barrierearme Alternative ersetzen (Honeypot, zeitbasierte Prüfung,
Cloudflare Turnstile im unsichtbaren Modus) – gerade beim Jobformular eines
Kompetenzzentrums Sehen sollten sich blinde Bewerber:innen ohne fremde Hilfe
bewerben können.

### B3 – Inhalte ausserhalb von Landmarken
**Best Practice (axe «region», moderate) · alle Seiten**

Footer und Cookie-/Datenschutzleiste liegen ausserhalb jeder Landmark-Region
(`<div class="fusion-tb-footer">` statt `<footer>`; die Privacy-Bar ebenso).
Screenreader-Nutzende können diese Bereiche nicht gezielt anspringen.

**Empfehlung:** Footer-Template in `<footer>`/`role="contentinfo"` fassen,
Privacy-Bar als `role="region"` mit `aria-label` auszeichnen.

## 6. Offene manuelle Prüfungen (vor 2027 einplanen)

1. **Kontrast von Text auf Bildern:** Die weisse Hauptnavigation und
   Titeltexte liegen über Foto-Hintergründen; axe konnte 8–27 Elemente pro
   Seite nicht automatisch bewerten. Sichtprüfung nötig; ggf. Abdunkelungs-
   Overlay verstärken. (Die weisse Menüschrift dürfte über hellen
   Bildpartien unter 4.5:1 fallen; auf Gelb läge sie bei 1.8:1.)
2. **Screenreader-Durchgang** (VoiceOver/iOS und NVDA/Windows) für die
   Kernabläufe: Kontaktaufnahme, Intake, Shop-Bestellung, Bewerbung, Spende.
3. **Verlinkte PDFs** (mind. 5 gefunden, u. a. auf Angebots- und
   Organisationsseiten): auf Tagging/Barrierefreiheit prüfen oder Inhalte als
   HTML anbieten.
4. **Shop-Checkout und Warenkorb** (hinter dem ersten Klick) inkl.
   Fehlermeldungen der Formulare (WCAG 3.3.x).
5. **Instagram-Einbettung** auf der Startseite: Tastatur- und
   Screenreader-Verhalten des Widgets.
6. **Barrierefreiheitserklärung** aufschalten (nach EAA für den
   EU-Markt Pflicht, nach E-BehiG empfohlen): Stand, bekannte Lücken,
   Feedback-Kanal.

## 7. Empfohlenes Vorgehen

| Wann | Was | Aufwand |
| --- | --- | --- |
| Sofort (Quick Wins) | A1 (aria-labels, Logo-Alt), A3 (Link-Unterstreichung), A4 (iframe-Titel), B2-Label | Stunden, kein Redesign |
| Q4 2026 | A2 Fokus-Stile im Theme, B1 Überschriften im Builder aufräumen, B3 Landmarken | 1–2 Tage im Avada-Theme |
| Q4 2026–Q1 2027 | Manuelle Prüfungen aus Abschnitt 6, reCAPTCHA-Ersatz, PDF-Triage, Barrierefreiheitserklärung | je nach Befund |
| Danach laufend | axe-Check in den Publikationsprozess aufnehmen (jede neue Seite, jeder neue Beitrag) | gering |

Mit den Quick Wins verschwinden alle auf jeder Seite wiederkehrenden
AA-Verstösse; der Rest ist Theme-Pflege. Ziel-Niveau: **WCAG 2.2 AA** – dann
ist die Seite sowohl für die BehiG-Revision 2027 als auch für den EAA
gerüstet.

## 8. Quellen

- [MME: Behindertengleichstellung und digitale Barrierefreiheit](https://www.mme.ch/de-ch/magazin/artikel/behindertengleichstellung-und-digitale-barrierefreiheit-eine-neue-rechtliche-herausforderung-f%C3%BCr-unternehmen)
- [HÄRTING Rechtsanwälte: Neue Pflichten nach dem Entwurf des neuen Schweizer BehiG](https://haerting.ch/wissen/barrierefreie-websites-apps-neue-pflichten-nach-dem-entwurf-des-neuen-schweizer-behig/)
- [Stiftung «Zugang für alle»: Teilrevision des BehiG](https://access-for-all.ch/teilrevision-des-behig-was-schweizer-unternehmen-bei-digitalen-inhalten-beachten-mussen/)
- [SiteCockpit: BehiG – digitale Barrierefreiheit wird Pflicht](https://www.sitecockpit.com/de/wissenswertes/behig)
- [SEEWERK: Barrierefreie Website 2027 – Pflicht für KMU](https://seewerk.ch/blog/barrierefreie-website-schweiz-2027)
- Messdaten: axe-core via Playwright, eigene Skripte, 1. September 2026
