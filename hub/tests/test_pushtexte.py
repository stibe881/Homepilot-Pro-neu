"""Eine Runde über alle Meldungen - was jede haben muss.

Dreiunddreissig Kategorien, verteilt über den Wächter, die Alarmanlage,
die Familienseite und ein Dutzend Integrationen. Jede einzelne ist
irgendwann von jemandem sorgfältig gebaut worden; was fehlt, ist der
Blick über alle auf einmal. Genau dort entstehen die Löcher: eine neue
Kategorie ohne Ziel, eine ohne Gruppe (die dann unter «Weiteres»
landet), ein Knopf, der nichts tut, ein «ß» in einem Text, den ein
Haushalt in Zell LU liest.

Die Regel unter allen Zusagen hier: Eine neue Kategorie ist erst fertig,
wenn sie in jeder dieser Listen steht - und dieser Test ist die Liste
der Listen.
"""

from __future__ import annotations

from homepilot.core import notifyrules, push, pushbeispiel, pushruhe
from homepilot.core.push import (
    _KNOEPFE,
    CATEGORIES,
    KNOEPFE_ERLEDIGT,
)

#: Kategorien, die nicht in einer der Gruppen stehen müssen.
#:
#: Nur der Test: Ein Schalter dafür wäre eine Attrappe, er kommt immer
#: an (siehe components/PushPrefs.tsx).
OHNE_GRUPPE = {"test"}


def test_jede_kategorie_hat_ein_beispiel() -> None:
    """Sonst steht in den Einstellungen «Vorschau» und darunter nichts."""
    fehlen = sorted(set(CATEGORIES) - set(pushbeispiel.BEISPIELE))
    assert not fehlen, f"Ohne Beispieltext: {fehlen}"


def test_kein_beispiel_ohne_kategorie() -> None:
    """Die andere Richtung: ein Beispiel zu einer Kategorie, die es
    nicht mehr gibt, ist eine Vorschau auf eine Meldung, die nie
    kommt."""
    verwaist = sorted(set(pushbeispiel.BEISPIELE) - set(CATEGORIES))
    assert not verwaist, f"Beispiel ohne Kategorie: {verwaist}"


def test_jede_kategorie_steht_in_einer_gruppe() -> None:
    """«Weiteres» ist das Auffangbecken für Vergessenes - und dass es
    eines gibt, ist kein Grund, es zu benutzen."""
    heimatlos = sorted(
        key
        for key in CATEGORIES
        if key not in OHNE_GRUPPE and push.group_of(key) == push.OTHER_GROUP
    )
    assert not heimatlos, f"Ohne Gruppe: {heimatlos}"


def test_kein_text_traegt_ein_scharfes_s() -> None:
    """Schweizer Deutsch: «ss» statt «ß». Steht in der CLAUDE.md und
    fällt sonst erst auf dem Sperrbildschirm auf."""
    texte: list[tuple[str, str]] = []
    for key, label in CATEGORIES.items():
        texte.append((f"CATEGORIES[{key}]", label))
    for key, (titel, text) in pushbeispiel.BEISPIELE.items():
        texte.append((f"BEISPIELE[{key}].titel", titel))
        texte.append((f"BEISPIELE[{key}].text", text))
    for regel in notifyrules.RULES:
        texte.append((f"RULES[{regel['key']}].title", regel["title"]))
        texte.append((f"RULES[{regel['key']}].detail", regel["detail"]))
        for spec in regel["params"]:
            texte.append((f"RULES[{regel['key']}].{spec['key']}", spec["label"]))
    schlimm = [wo for wo, text in texte if "ß" in text]
    assert not schlimm, f"«ß» statt «ss»: {schlimm}"


def test_kein_titel_ist_laenger_als_der_sperrbildschirm() -> None:
    """Was über etwa vierzig Zeichen hinausgeht, wird abgeschnitten -
    und dann steht dort die Hälfte einer Auskunft."""
    zu_lang = [
        key
        for key, (titel, _) in pushbeispiel.BEISPIELE.items()
        if len(titel) > 40
    ]
    assert not zu_lang, f"Titel zu lang für den Sperrbildschirm: {zu_lang}"


def test_jeder_knopf_gehoert_zu_einer_echten_kategorie() -> None:
    """Ein Knopf unter einer Kategorie, die es nicht gibt, zeigt sich
    nie - und niemand merkt es."""
    verwaist = sorted(set(_KNOEPFE) - set(CATEGORIES))
    assert not verwaist, f"Knöpfe ohne Kategorie: {verwaist}"


def test_der_erledigt_knopf_steht_nur_wo_er_etwas_quittiert() -> None:
    """Er hing einmal auch unter der Wartung - die schickt aber keine
    Kennung mit, also fand die App nichts zu quittieren und tat
    schlicht nichts. Ein Knopf, der nichts tut und «Erledigt» heisst,
    ist schlimmer als keiner."""
    mit = {key for key, art in _KNOEPFE.items() if art == KNOEPFE_ERLEDIGT}
    assert mit == {"battery"}


def test_was_immer_durchkommt_ist_auch_dringend() -> None:
    """Sonst hielte Android die Nachricht in Doze zurück, die keine
    Ruhezeit aufhalten darf - und wir hätten die Nacht durch die
    Hintertür wieder."""
    leise_und_wichtig = sorted(pushruhe.IMMER_DURCH & push.LEISE)
    assert not leise_und_wichtig, f"Wichtig, aber leise: {leise_und_wichtig}"


def test_jede_waechter_regel_ist_eine_kategorie() -> None:
    """Der Schlüssel einer Regel ist zugleich ihre Push-Kategorie -
    sonst greift die persönliche Abbestellung nicht."""
    fremd = sorted(
        regel["key"] for regel in notifyrules.RULES if regel["key"] not in CATEGORIES
    )
    assert not fremd, f"Regel ohne Kategorie: {fremd}"
