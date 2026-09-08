"""Dateien an Familieneinträgen – der Zwilling von core/bilder.py.

Punkt 266 der Werkbank. Ein Gutschein kommt heute selten als Karte im
Couvert und fast immer als PDF im Mail-Anhang: «Ihr Geschenkgutschein»,
angehängt, gelesen, vergessen. Das Foto der Karte gibt es schon
(core/bilder.py) – es hilft nur dem, der eine Karte in der Hand hält.
Was fehlte, ist das PDF selbst; solange es allein im Postfach liegt,
sucht es im Juni niemand mehr.

Gleiche Bauart wie die Bilder, mit Absicht: Die Datei kommt als data-URI
herein, wird einmal neben die Daten geschrieben und danach unter einer
eigenen Adresse ausgeliefert, deren Fingerabdruck den Zwischenspeicher
sauber hält. Wer eine der beiden Dateien gelesen hat, kennt die andere.

**Was von bilder.py mitbenutzt wird.** `safe_id` und `fingerprint`
rechnen an der Kennung und an den Bytes und wissen nichts von Bildern –
die werden von hier aufgerufen und nicht kopiert. Dasselbe gilt fürs
Zerlegen des data-URI und fürs base64 (`data_uri_teile`,
`entschluessle`). Eigen ist hier nur, was wirklich anders ist: die
Typentabelle, die Obergrenze – und dass eine abgelehnte Datei sagt,
*warum* sie abgelehnt wurde. Beim Bild genügt ein None; eine Datei, die
jemand bewusst anhängt, braucht eine Antwort.

Hier steht nur das Rechnen; wer schreibt und ausliefert, ist
api/routes/family.py.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import quote

from . import bilder

# Welche Familiensammlung ihre Dateien in welchem Ordner ablegt – neben
# der Datendatei, wie die Bilder. Eigener Ordner und nicht der der
# Bilder: Derselbe Gutschein kann beides tragen (das Foto der Karte und
# das PDF aus der Mail), und in einem Ordner lägen sie unter derselben
# Kennung nebeneinander. Getrennt sagt schon der Ordnername, was man vor
# sich hat.
ORDNER: dict[str, str] = {
    "vouchers": "gutscheindateien",
}

# Was wir annehmen. Zuerst das, worum es geht: PDF – so kommt ein
# Gutschein aus dem Netzladen. Dann Bilder (ein abfotografierter oder
# eingescannter Brief), Word und Excel (der Gutschein einer Firma an
# ihre Angestellten kommt gern als .docx), Text und CSV, und ZIP für
# den Fall, dass ein Laden mehrere Codes zusammenpackt.
#
# Was NICHT drinsteht, ist der eigentliche Punkt dieser Tabelle:
# ausführbare Dateien und alles, was ein Programm sein könnte – .exe,
# .sh, .py, .apk, .dmg, HTML und SVG. Ein Hub ist keine Dateiablage: Er
# läuft rund um die Uhr im Haus, jeder in der Familie darf hineinlegen,
# und was hier liegt, liefert er unter seiner eigenen Adresse wieder
# aus. HTML und SVG dürfen Skripte enthalten und liefen im Browser
# dann unter der Adresse des Hubs – mit dessen Zugangsdaten im
# Speicher. Ein PDF kann der Browser anzeigen, ohne dass es zum Hub
# gehört; genau diesen Unterschied hält die Tabelle fest.
TYPES: dict[str, str] = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "text/plain": "txt",
    "text/csv": "csv",
    "application/zip": "zip",
}

#: Rückwärts: von der Endung auf der Platte zum Typ in der Antwort. Auf
#: der Platte steht nur die Endung, der Kopf der Antwort braucht den
#: Typ. Jede Endung kommt in TYPES genau einmal vor.
ENDUNGEN: dict[str, str] = {endung: typ for typ, endung in TYPES.items()}

# Obergrenze je Datei – deutlich höher als bei den Bildern (4 MB), denn
# ein Bild verkleinert die App vorher, ein PDF kommt, wie es kommt. Ein
# Gutschein-PDF sind 100 bis 500 KB, ein eingescannter Brief mit ein
# paar Seiten auch mal drei; zehn Megabyte lassen dafür Luft.
#
# Warum überhaupt eine Grenze: Ein data-URI kommt im JSON-Rumpf des
# PUT herein, wird als base64 (+33 %) gelesen, als Python-String
# gehalten und dann noch einmal als Bytes ausgepackt. Ein 200-MB-Video
# wären so über eine halbe Gigabyte im Arbeitsspeicher eines Rechners,
# der sonst Lampen schaltet – und danach dauerhaft auf derselben
# Partition, auf der die Datendatei liegt. Was hier nicht hineinpasst,
# gehört nicht an einen Gutschein, sondern in eine Cloud.
MAX_BYTES = 10 * 1024 * 1024

#: Wie lang ein Dateiname höchstens sein darf. Nicht aus technischer
#: Not (der Name steht im Eintrag, nicht auf der Platte), sondern weil
#: eine Kachel mit 400 Zeichen Dateiname nichts anderes mehr zeigt.
MAX_NAME = 120

#: Der Name, wenn nichts Brauchbares mitkam.
NAME_ERSATZ = "Datei"


class DateiFehler(ValueError):
    """Was mit der geschickten Datei nicht stimmt – samt Status.

    `status` ist der HTTP-Code, den die Route daraus macht: 413 für «zu
    gross», 415 für «so etwas nehmen wir nicht». Zwei Codes und nicht
    einer, weil die beiden Fälle verschiedene Antworten des Benutzers
    verlangen – bei «zu gross» hilft ein kleinerer Scan, bei «falscher
    Typ» hilft nur eine andere Datei.
    """

    def __init__(self, text: str, status: int) -> None:
        super().__init__(text)
        self.status = status


def entpacke(value: Any) -> tuple[bytes, str, str]:
    """«data:application/pdf;base64,…» → (Bytes, Endung, Typ) (rein, testbar).

    Wirft DateiFehler, statt None zurückzugeben – anders als beim Bild,
    und zwar aus einem Grund: Eine Datei lässt sich nicht klemmen. Ein
    zu grosses PDF ist abgeschnitten kein PDF mehr, und wer seinen
    Gutschein anhängt und danach einen Eintrag ohne Anhang sieht, hält
    das für geglückt und wirft die Mail weg. Beim Rest eines Gutscheins
    ist Klemmen richtig (ein Betrag von -5 heisst «aufgebraucht»); hier
    wäre es eine Lüge.
    """
    teile = bilder.data_uri_teile(value)
    if teile is None:
        raise DateiFehler("Das ist keine Datei, die der Hub versteht", 415)
    typ, rumpf = teile
    endung = TYPES.get(typ)
    if endung is None:
        raise DateiFehler(f"Dateien vom Typ {typ} nimmt der Hub nicht an", 415)
    # Erst am base64 messen, dann auspacken: Vier Zeichen werden drei
    # Bytes, ein 200-MB-Video käme also als 267 MB Text herein. Das muss
    # man nicht auch noch entschlüsseln, um es abzulehnen.
    zu_gross = f"Die Datei ist grösser als {MAX_BYTES // (1024 * 1024)} MB"
    if len(rumpf) > (MAX_BYTES // 3 + 1) * 4 + 4:
        raise DateiFehler(zu_gross, 413)
    roh = bilder.entschluessle(rumpf)
    if roh is None:
        raise DateiFehler("Die Datei kam beschädigt an", 415)
    if not roh:
        raise DateiFehler("Die Datei ist leer", 415)
    if len(roh) > MAX_BYTES:
        raise DateiFehler(zu_gross, 413)
    return roh, endung, typ


def ordner(data_path: Any, collection: str) -> Path | None:
    """Der Dateiordner einer Sammlung neben der Datendatei (rein, testbar).

    None ohne Datendatei (Tests, im Speicher gebaute Hubs) und für
    Sammlungen, die keine Dateien führen.
    """
    name = ORDNER.get(collection)
    if not data_path or name is None:
        return None
    return Path(data_path).parent / name


def loeschen(folder: Path | None, item_id: Any) -> None:
    """Die Datei eines Eintrags wegräumen – ohne Klage, wenn es keine gibt.

    Dasselbe Aufräumen wie beim Bild; unterschieden werden die beiden
    durch den Ordner, nicht durch den Code.
    """
    bilder.loeschen(folder, item_id)


def media_type(name: str) -> str:
    """Aus der Dateiendung den Typ (rein, testbar).

    Unbekanntes wird zum Byte-Haufen: Dann lädt der Browser die Datei
    herunter, statt zu raten, was er damit anstellen soll.
    """
    endung = name.rsplit(".", 1)[-1].lower()
    return ENDUNGEN.get(endung, "application/octet-stream")


def sauberer_name(value: Any, endung: str = "") -> str:
    """Ein Dateiname, der keinen Kopf und keinen Pfad sprengt (rein, testbar).

    Der Name kommt aus einer Mail und damit von aussen. Ein
    Zeilenumbruch darin begänne im `Content-Disposition` eine zweite
    Kopfzeile (so schmuggelt man Kopfzeilen in eine Antwort), ein
    Anführungszeichen beendete den Namen vorzeitig, und ein «/» machte
    daraus einen Pfad. Alles drei fliegt hier raus, damit die Route sich
    darauf verlassen kann.

    `endung` wird angehängt, wenn der Name nicht schon so endet: Wer
    «Gutschein Brack» tippt, soll auf dem Telefon trotzdem ein PDF
    öffnen können und nicht eine Datei ohne Endung, die niemand kennt.
    """
    text = "".join(
        " " if zeichen in "\r\n\t" else zeichen
        for zeichen in str(value or "")
        if zeichen.isprintable() or zeichen in "\r\n\t"
    )
    for schlimm in '"\\/':
        text = text.replace(schlimm, "-")
    text = " ".join(text.split())[:MAX_NAME].strip()
    if not text:
        text = NAME_ERSATZ
    if endung and not text.lower().endswith(f".{endung.lower()}"):
        text = f"{text}.{endung}"
    return text


def disposition(name: Any) -> str:
    """Der `Content-Disposition`-Kopf zu einem Dateinamen (rein, testbar).

    `inline`, damit ein PDF im Telefon aufgeht statt im Download-Ordner
    zu landen – man will den Gutschein an der Kasse zeigen, nicht
    archivieren.

    Der Name steht zweimal darin: einmal in reinem ASCII und einmal als
    `filename*` in UTF-8 (RFC 5987). Ohne den zweiten hiesse die Datei
    «Gutschein Kche»; ohne den ersten scheiterte die ganze Antwort,
    sobald ein Emoji im Namen steht – Kopfzeilen gehen als latin-1 über
    die Leitung und können das nicht darstellen.
    """
    sauber = sauberer_name(name)
    einfach = "".join(z for z in sauber if 32 <= ord(z) < 127).strip() or NAME_ERSATZ
    return f"inline; filename=\"{einfach}\"; filename*=UTF-8''{quote(sauber, safe='')}"


def block(url: str, name: str, typ: str, groesse: int) -> dict[str, Any]:
    """Der Datei-Block, wie er am Eintrag steht (rein, testbar).

    Genau diese vier Felder, und sie sind der Vertrag mit der App: Sie
    zeigt `name` und `bytes` in der Kachel (ein Name allein sagt nicht,
    ob das Laden über Mobilfunk eine gute Idee ist), wählt am `type` das
    Symbol und öffnet `url`.
    """
    return {"url": url, "name": name, "type": typ, "bytes": int(groesse)}


def bereinigen(value: Any) -> dict[str, Any] | None:
    """Einen Datei-Block auf seine vier Felder zurückschneiden (rein, testbar).

    None für alles, was keiner ist: irgendein Dict aus einem Skript, ein
    Block ohne Adresse – und namentlich der `{"data": …}`, den die App
    zum Ablegen schickt. Der steht hier nur noch, wenn das Ablegen gar
    nicht stattgefunden hat; bliebe er stehen, läge der ganze data-URI
    in der Datendatei, also genau dort, wo er nach Punkt 266 nie sein
    soll.
    """
    if not isinstance(value, dict):
        return None
    url = str(value.get("url") or "").strip()
    # Nur eigene Adressen: Ein «https://…» hier hiesse, dass die App
    # beim Öffnen eines Gutscheins irgendeinen fremden Server aufruft –
    # und dass jeder, der einen Eintrag schreiben darf, bestimmen kann,
    # welchen.
    if not url.startswith("/api/family/"):
        return None
    typ = str(value.get("type") or "").strip().lower()
    try:
        groesse = max(0, int(value.get("bytes") or 0))
    except (TypeError, ValueError):
        groesse = 0
    return block(
        url,
        sauberer_name(value.get("name")),
        typ if typ in TYPES else "application/octet-stream",
        groesse,
    )
