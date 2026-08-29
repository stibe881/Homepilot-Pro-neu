#!/usr/bin/env bash
# Baut das Hub-Abbild frisch aus dem Repository und räumt das alte weg -
# der ganze manuelle Dreisatz (stop/rm/clone/build) in einem Befehl, für
# den Fall, dass "Update the stack" in Portainer den neuesten Commit nicht
# selbst zieht.
#
# ── Einmalige Einrichtung auf dem Docker-Host ──────────────────────────
#
#   sudo mkdir -p /opt/homepilot
#   sudo nano /opt/homepilot/github-credentials.env
#
# Dort rein (GitHub-Benutzername + ein Personal Access Token mit
# Lesezugriff auf dieses private Repository):
#
#   GITHUB_USER=dein-github-benutzername
#   GITHUB_TOKEN=dein-personal-access-token
#
#   sudo chmod 600 /opt/homepilot/github-credentials.env
#
# Dieses Skript selbst nach /opt/homepilot/rebuild-hub.sh kopieren
# (Inhalt aus dem Repository oder direkt von hier) und ausführbar machen:
#
#   sudo chmod +x /opt/homepilot/rebuild-hub.sh
#
# ── Ab dann bei jedem Update ────────────────────────────────────────────
#
#   sudo /opt/homepilot/rebuild-hub.sh
#
# ...und danach in Portainer einmal Stacks → homepilot → "Update the
# stack" → Deploy klicken, damit der Container das frische Abbild nutzt.
#
# ── Wegweiser durch die ~740 Zeilen ─────────────────────────────────────
#
# Das Skript ist lang, weil es die ganze Auslieferung trägt. Die Abschnitte
# (suchbar über «── Titel ──»):
#
#   Selbst-Auffrischung   Das Skript holt sich zuerst selbst den neuesten
#                         Stand – Änderungen daran greifen deshalb erst
#                         beim ÜBERNÄCHSTEN Lauf.
#   Platzmessung          Vor dem Bau prüfen, ob die Platte reicht.
#   Klonen + Hub-Abbild   Frischer Klon von BRANCH, Docker-Build.
#   Web-Fassung           expo export, atomar nach web_root getauscht.
#   App-Abhängigkeiten    Ein Abbild mit node_modules, gecacht über den
#                         Hash von package-lock.json.
#   iOS-Build             Nur mit HOMEPILOT_IOS_BUILD=1; EAS baut, Apple
#                         bekommt ihn direkt.
#
# Zwei Regeln fürs Ändern: shellcheck muss sauber bleiben (läuft in der
# CI), und wer einen Schritt anfasst, testet ihn über den Update-Knopf
# zweimal – wegen der Selbst-Auffrischung zählt erst der zweite Lauf.
#
# ── Optional: auch den letzten Klick automatisieren ─────────────────────
#
# Dieses Skript startet den Container absichtlich nicht selbst - deine
# Tokens (HOMEPILOT_TOKEN, TOKEN_STEFAN, SUPABASE_SERVICE_KEY, ...) liegen
# ausschliesslich in Portainers Stack-Konfiguration, und das soll auch so
# bleiben, statt sie zusätzlich in eine Datei auf der Platte zu duplizieren.
#
# Wer trotzdem einen einzigen Befehl will: In Portainer unter Stacks →
# homepilot → "Webhook" einen Stack-Webhook aktivieren (löst bei einem
# POST-Aufruf automatisch "Update the stack" aus, ohne dass Portainer
# dafür Tokens preisgibt) und die angezeigte URL in
# github-credentials.env eintragen:
#
#   PORTAINER_WEBHOOK_URL=https://portainer.example.com/api/stacks/webhooks/xxxxxxxx
#
# Laeuft Portainer auf Port 9443 mit seinem selbst ausgestellten
# Zertifikat, kommt eine Zeile dazu - sonst bricht curl mit einem
# Zertifikatsfehler ab, mitten im sonst fertigen Update:
#
#   PORTAINER_INSECURE=1
#
# Ist die Variable gesetzt, ruft dieses Skript sie am Ende automatisch auf.
#
# ── Optional: die Web-Fassung der App gleich mit ──────────────────────
#
# Existiert der Zielordner der Web-Fassung (siehe docs/app-ohne-vpn.md)
# schon, baut dieses Skript sie bei jedem Lauf gleich mit - in einem
# Wegwerf-Container, ohne dass Node auf dem Host installiert sein muss.
# Ein eigener Ordner dafür ist der einzige Schalter; ohne ihn passiert
# hier nichts Neues.

set -euo pipefail

# Welcher Stand ins Haus geht.
#
# Der Name stand hier lange als Arbeitszweig und wurde beim Weiterziehen
# nicht mitgeführt - der Knopf baute dann beharrlich das Falsche, und von
# aussen sah es aus, als käme die Änderung nicht an. Deshalb ein fester
# Zweig als Vorgabe; wer etwas anderes bauen will, setzt HOMEPILOT_BRANCH
# in /opt/homepilot/github-credentials.env.
BRANCH="${HOMEPILOT_BRANCH:-claude/custom-home-automation-t9lvq3}"
REPO="stibe881/Homepilot-Pro-neu"
WORKDIR="/tmp/homepilot-build"
CREDENTIALS_FILE="/opt/homepilot/github-credentials.env"
CONTAINER="homepilot-hub"
IMAGE="homepilot-hub"
WEB_ROOT="${HOMEPILOT_WEB_ROOT:-/opt/homepilot/web}"

if [ -f "$CREDENTIALS_FILE" ]; then
  # shellcheck disable=SC1090
  . "$CREDENTIALS_FILE"
fi
# Wagenrücklauf am Zeilenende wegschneiden. Wer die Datei einmal unter
# Windows bearbeitet hat, hat CRLF drin – dann ist der Wert nicht "1",
# sondern "1\r", der Vergleich weiter unten schlägt fehl und die Prüfung
# des Zertifikats bleibt an, ohne dass man sähe warum. Dasselbe bei der
# Adresse: ein angehängtes \r macht aus ihr eine, die es nicht gibt.
PORTAINER_INSECURE="${PORTAINER_INSECURE:-0}"
PORTAINER_INSECURE="${PORTAINER_INSECURE%$'\r'}"
PORTAINER_WEBHOOK_URL="${PORTAINER_WEBHOOK_URL:-}"
PORTAINER_WEBHOOK_URL="${PORTAINER_WEBHOOK_URL%$'\r'}"
GITHUB_USER="${GITHUB_USER:-}"; GITHUB_USER="${GITHUB_USER%$'\r'}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"; GITHUB_TOKEN="${GITHUB_TOKEN%$'\r'}"
: "${GITHUB_USER:?GITHUB_USER fehlt – siehe Kopf dieses Skripts}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN fehlt – siehe Kopf dieses Skripts}"

# ── Platzmessung ───────────────────────────────────────────────────────
#
# Nach jedem Update war weniger Platz da, und wir haben mehrfach geraten
# statt gemessen. Das hier schreibt vor und nach jedem Lauf mit, wieviel
# frei ist und was Docker belegt - nach zwei Läufen steht in der Datei,
# was wirklich wächst, statt einer Vermutung.
#
# Bewusst kein "du" über /var/lib/docker: Auf einer gewachsenen
# Installation läuft das minutenlang und würde jedes Update ausbremsen.
# "docker system df" beantwortet dieselbe Frage in einer Sekunde. Bleibt
# Docker flach und der freie Platz sinkt trotzdem, liegt es ausserhalb -
# dann sagt das die Zeile mit /opt und /var/log.
PLATZ_LOG="/opt/homepilot/platz.log"

# Wo Docker seine Daten hält. Nicht fest verdrahten: Auf einer
# Snap-Installation liegt alles unter /var/snap/docker/common/…, und
# /var/lib/docker ist ein fast leerer Rest. Wer dort nachsieht, misst am
# eigentlichen Verbrauch vorbei - genau das ist mir passiert.
docker_root() {
  docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker
}

platz_frei_kb() { df --output=avail -k / | tail -1 | tr -d ' '; }

# Ausgabe fremder Werkzeuge kenntlich machen.
#
# Der Update-Dienst liest jede Zeile dieses Skripts mit und nimmt «⚠ …»
# als Warnung des Laufs, «✗ …» als Abbruch. Durch dieselbe Ausgabe laufen
# aber auch die Werkzeuge, die hier aufgerufen werden - und `eas build`
# schreibt eigene Warnzeichen. «Detected that your app uses Expo Go for
# development» stand danach in der App als Hinweis zum letzten Update,
# obwohl der Satz mit dem Update nichts zu tun hat.
#
# Der senkrechte Strich nimmt jeder fremden Zeile diese Bedeutung, und
# man sieht ihr an, dass sie von woanders kommt. `sed -u` gibt sie sofort
# weiter statt blockweise - sonst stünde der Fortschritt minutenlang.
fremde_ausgabe() { sed -u 's/^/| /'; }

platz_notiz() {
  # $1 = "vorher" | "nachher"
  {
    echo "── $1  $(date '+%Y-%m-%d %H:%M:%S')"
    echo "   frei: $(numfmt --to=iec --from-unit=1024 "$(platz_frei_kb)")"
    docker system df 2>/dev/null | tail -n +2 | sed 's/^/   /'
    du -sxh /opt/homepilot /var/log "$(docker_root)" 2>/dev/null | sed 's/^/   /'
  } >> "$PLATZ_LOG" 2>/dev/null || true
}

FREI_VORHER=$(platz_frei_kb)
platz_notiz vorher

# Vorabprüfung: Antwortet Portainer überhaupt, und stolpert curl über
# das Zertifikat? Das kostet eine Sekunde und erspart die Enttäuschung,
# nach fünf Minuten Bauzeit am letzten Schritt zu scheitern. Bewusst nur
# eine Warnung: Das Abbild zu bauen lohnt sich auch dann, denn ausrollen
# lässt es sich danach von Hand.
#
# Bewusst GET auf /api/status und nicht der Webhook selbst - ein POST
# dorthin würde genau das Ausrollen auslösen, das hier erst geprüft wird.
if [ -n "${PORTAINER_WEBHOOK_URL:-}" ]; then
  PRE_INSECURE=""
  if [ "${PORTAINER_INSECURE:-0}" = "1" ]; then
    PRE_INSECURE="--insecure"
  fi
  PORTAINER_BASE="${PORTAINER_WEBHOOK_URL%%/api/*}"
  # shellcheck disable=SC2086
  curl -fsS $PRE_INSECURE -o /dev/null --max-time 10 "$PORTAINER_BASE/api/status" \
    2>/dev/null || PRE_CODE=$?
  case "${PRE_CODE:-0}" in
    0|22) ;;   # 22 = Portainer antwortet, mag nur diese Adresse nicht
    60|35|51)
      echo "⚠ Portainer: Zertifikatsfehler (curl-Code ${PRE_CODE})."
      echo "  Es stellt sein Zertifikat auf 9443 selbst aus. In"
      echo "  $CREDENTIALS_FILE gehört die Zeile:"
      echo "    PORTAINER_INSECURE=1"
      echo "  Ohne sie wird das Ausrollen am Ende scheitern - gebaut wird"
      echo "  trotzdem, ausrollen geht dann von Hand in Portainer."
      ;;
    7|28)
      echo "⚠ Portainer ist nicht erreichbar (curl-Code ${PRE_CODE})."
      echo "  Läuft der Container?  docker ps --filter name=portainer"
      ;;
  esac
fi

# Der alte Container läuft absichtlich weiter, während gebaut wird: Das
# neue Abbild entsteht daneben, unter demselben Namen. Erst ganz am Ende,
# unmittelbar vor dem Neuausrollen, wird gewechselt - so ist der Hub
# Sekunden weg statt Minuten. Und geht der Bau schief, läuft der alte
# Stand einfach weiter, statt dass das Haus ohne Steuerung dasteht.

echo "→ Hole den neuesten Code von ${REPO}@${BRANCH} …"
# Reste eines abgebrochenen Laufs zuerst weg. Aufgeräumt wird sonst erst
# ganz am Ende - bricht ein Lauf vorher ab (Portainer weg, Bau
# fehlgeschlagen), bleibt der Ordner liegen, und der nächste `git clone`
# scheitert an «destination path already exists». Mit `set -e` stirbt das
# Skript dann sofort, und der Update-Knopf tut scheinbar grundlos nichts.
rm -rf "$WORKDIR"
# --depth 50 statt 1: Aus der jüngeren Geschichte entsteht die
# «Was ist neu»-Liste in der App (Commit-Betreffzeilen seit dem Stand,
# der gerade läuft). Fünfzig reichen für jede realistische Update-Lücke.
git clone --depth 50 -b "$BRANCH" \
  "https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/${REPO}.git" "$WORKDIR"

# ── Die anderen Zweige mit hineinnehmen ────────────────────────────────
#
# Der Knopf baut genau einen Zweig (BRANCH). Wer nebenher auf einem
# zweiten arbeitet, drückt auf «Update» und findet seine Änderung nicht
# im Haus - von aussen sieht das aus, als wäre sie nie gebaut worden.
# Genau das ist passiert.
#
# Deshalb wandern hier alle anderen Zweige des Repos in den Bau. Nur
# lokal: Nichts davon wird nach GitHub zurückgeschrieben, der Zweig auf
# GitHub bleibt, wie er ist.
#
# Was dabei schiefgehen kann, geht einzeln schief: Ein Zweig, der sich
# nicht ohne Konflikt hineinnehmen lässt, bleibt draussen und wird
# gemeldet - der Rest wird trotzdem gebaut. Sonst stünde das Haus wegen
# eines halbfertigen Versuchs ohne Update da.
#
# Abschalten: HOMEPILOT_MERGE_ALL=0 in /opt/homepilot/github-credentials.env.
# Dann baut der Knopf wieder ausschliesslich BRANCH.
MERGE_ALL="${HOMEPILOT_MERGE_ALL:-1}"
ZUSAETZLICH=""
AUSGELASSEN=""
if [ "$MERGE_ALL" = "1" ]; then
  # Zwei Dinge fehlen dem Klon von oben: Er ist flach (--depth 50), und
  # `clone -b … --depth` holt *nur* diesen einen Zweig - die anderen
  # kennt er gar nicht. Beides hier nachholen; ohne die Zeile mit der
  # Refspec fände die Schleife unten nie etwas.
  git -C "$WORKDIR" config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
  if git -C "$WORKDIR" fetch --quiet --unshallow origin 2>/dev/null \
     || git -C "$WORKDIR" fetch --quiet origin 2>/dev/null; then
    for ZWEIG in $(git -C "$WORKDIR" for-each-ref --format='%(refname:short)' \
                     refs/remotes/origin \
                   | grep -v -e '^origin/HEAD$' -e "^origin/${BRANCH}\$"); do
      KURZ="${ZWEIG#origin/}"
      # Schon enthalten? Dann gibt es nichts zu tun und nichts zu melden.
      if git -C "$WORKDIR" merge-base --is-ancestor "$ZWEIG" HEAD 2>/dev/null; then
        continue
      fi
      # -c user.*: Ein Zusammenführen erzeugt einen Commit, und ohne
      # Namen bricht git ab. Der Name sagt, woher der Commit stammt.
      if git -C "$WORKDIR" \
           -c user.name='HomePilot Update' \
           -c user.email='update@homepilot.local' \
           merge --no-edit --no-ff "$ZWEIG" >/dev/null 2>&1; then
        ZUSAETZLICH="$ZUSAETZLICH $KURZ"
      else
        git -C "$WORKDIR" merge --abort >/dev/null 2>&1 || true
        AUSGELASSEN="$AUSGELASSEN $KURZ"
      fi
    done
  else
    echo "⚠ Die übrigen Zweige liessen sich nicht holen - gebaut wird nur ${BRANCH}."
  fi
  if [ -n "$ZUSAETZLICH" ]; then
    echo "→ Zusätzlich hineingenommen:$ZUSAETZLICH"
  fi
  if [ -n "$AUSGELASSEN" ]; then
    echo "⚠ Nicht hineingenommen (Konflikt mit ${BRANCH}):$AUSGELASSEN"
    echo "  Diese Zweige gehören auf GitHub zusammengeführt - von hier aus"
    echo "  liesse sich das nur raten."
  fi
fi

# Sich selbst auffrischen - gilt ab dem NÄCHSTEN Lauf. mv ersetzt die Datei
# atomar über einen neuen Inode; die gerade laufende Instanz liest ungestört
# aus der alten weiter. Damit entfällt das ewige Von-Hand-Kopieren nach
# jeder Skript-Änderung.
if ! cmp -s "$WORKDIR/deploy/rebuild-hub.sh" "$0"; then
  cp "$WORKDIR/deploy/rebuild-hub.sh" "$0.neu"
  chmod +x "$0.neu"
  mv "$0.neu" "$0"
  echo "→ Skript selbst aktualisiert - der neue Stand gilt ab dem nächsten Lauf."
fi
# Den Update-Dienst hier nur hinlegen, nie sofort neu starten: Ein
# Neustart würde genau den Bau abwürgen, den er gerade beaufsichtigt (er
# ist dessen Elternprozess). Der Neustart wird stattdessen für gleich
# nach diesem Lauf vorgemerkt - siehe dienst_neustart_planen unten.
#
# Bis hierher stand an dieser Stelle «danach einmal von Hand». Genau das
# blieb verlässlich liegen, und der Dienst lief monatelang mit einer
# Fassung, die neuere Knöpfe der App nicht kennt - ohne dass irgendwo
# stand, dass er der Grund ist.
LISTENER_ERNEUERT=0
if [ -f /opt/homepilot/update-listener.py ] \
   && ! cmp -s "$WORKDIR/deploy/update-listener.py" /opt/homepilot/update-listener.py; then
  if cp "$WORKDIR/deploy/update-listener.py" /opt/homepilot/update-listener.py; then
    LISTENER_ERNEUERT=1
    echo "→ update-listener.py aktualisiert - der Dienst startet gleich nach"
    echo "  diesem Lauf von selbst neu."
  else
    echo "⚠ update-listener.py liess sich nicht nach /opt/homepilot kopieren."
    echo "  Der Update-Dienst bleibt damit auf seinem alten Stand."
  fi
elif [ ! -f /opt/homepilot/update-listener.py ]; then
  # Ohne diese Zeile bliebe es still: Liegt der Dienst woanders, greift
  # die Auffrischung oben nie - und niemand erfährt davon.
  echo "⚠ /opt/homepilot/update-listener.py gibt es nicht - der Update-Dienst"
  echo "  liegt offenbar anderswo und frischt sich hier nicht mit auf."
  echo "  Wo er wirklich liegt, sagt: systemctl show -p ExecStart homepilot-update"
fi

# Der Neustart, sobald dieser Lauf vorbei ist. systemd-run legt dafür eine
# eigene, kurzlebige Einheit an - die hängt nicht am Dienst, den sie neu
# startet, und überlebt deshalb dessen Neustart. Ein «systemctl restart»
# von hier aus würde sich selbst (und diesen Bau) mitnehmen.
dienst_neustart_planen() {
  [ "$LISTENER_ERNEUERT" = "1" ] || return 0
  if ! command -v systemd-run >/dev/null 2>&1; then
    echo "⚠ systemd-run fehlt - den Update-Dienst bitte von Hand neu starten:"
    echo "  sudo systemctl restart homepilot-update"
    return 0
  fi
  # 20 Sekunden: genug, damit der Dienst die letzten Zeilen dieses Laufs
  # noch liest und der App «fertig» meldet, bevor er sich neu startet.
  if systemd-run --collect --on-active=20 \
      systemctl restart homepilot-update >/dev/null 2>&1; then
    echo "→ Der Update-Dienst startet in 20 Sekunden mit dem neuen Stand neu."
  else
    echo "⚠ Der Neustart des Update-Dienstes liess sich nicht vormerken."
    echo "  Bitte von Hand: sudo systemctl restart homepilot-update"
  fi
}
# Über die EXIT-Falle, damit der Neustart auch dann kommt, wenn der Lauf
# vorzeitig endet - gerade dann ist der neue Dienst wichtig.
trap dienst_neustart_planen EXIT

# Schon hier bestimmen, nicht erst beim Abbild: Der Stempel wandert auch
# in die Web-Fassung (version.json), damit die App prüfen kann, ob das
# Bundle im Browser zum laufenden Hub passt.
COMMIT="$(git -C "$WORKDIR" rev-parse --short HEAD)"
# Ausdrücklich hinschreiben, woraus gebaut wird. Zeigt HOMEPILOT_BRANCH
# auf etwas anderes als erwartet, baut der Knopf beharrlich den falschen
# Stand - und das sieht von aussen aus wie «die Änderung kam nicht an».
echo "→ Gebaut wird ${BRANCH} @ ${COMMIT} ($(git -C "$WORKDIR" log -1 --format='%s'))"
if [ -n "$ZUSAETZLICH" ]; then
  # Der Stempel steht auf GitHub nirgends - er gehört zur örtlichen
  # Zusammenführung. Ohne diese Zeile sucht man ihn dort vergeblich.
  echo "  (samt$ZUSAETZLICH - der Stand entsteht erst hier beim Bauen)"
fi

# Läuft dieser Stand schon? Dann trotzdem bauen (ein Neubau schadet nie),
# aber es dazusagen: Ein «Update» ohne neuen Commit sieht sonst nach
# einem Fehler aus - und bei unverändertem Git-Stand rollt Portainer je
# nach Version gar nicht erst neu aus.
RUNNING_COMMIT=$(docker exec "$CONTAINER" printenv HOMEPILOT_COMMIT 2>/dev/null || echo "")
if [ -n "$RUNNING_COMMIT" ] && [ "$RUNNING_COMMIT" = "$COMMIT" ]; then
  # ── OTA-Fassung für die Telefone ────────────────────────────────────────
#
# Der Knopf tauschte bisher nur die Web-Fassung; die Telefone bekamen
# neuen Code erst mit dem nächsten TestFlight-Build. Das fiel erst auf,
# als ein Knopf «bei mir da, bei ihr nicht» war - beide Telefone hingen
# auf demselben alten Stand, und die gleiche Versionsnummer täuschte
# Aktualität vor: Sie ist die des Builds, nicht der nachgeladenen
# Fassung.
#
# Deshalb veröffentlicht jeder Lauf jetzt auch über EAS Update - sofern
# ein EXPO_TOKEN in der Zugangsdatei liegt. Erreicht werden nur Builds
# mit derselben runtimeVersion: Wer einen älteren Build installiert hat,
# braucht einmal TestFlight, danach greift OTA wieder.
#
# Die runtimeVersion hing dabei lange an der App-Version - und weil die
# bei jeder Auslieferung hochgezählt gehört, kappte jede Auslieferung
# genau diesen Kanal. Der Hub war neu, die Telefone nicht, und die
# hochgezählte Nummer täuschte Aktualität vor. Sie steht deshalb jetzt
# fest in app/app.json und ändert sich nur, wenn sich nativ etwas
# ändert (siehe CLAUDE.md, «Ausliefern»).
# Ein Fehlschlag hier lässt den Rest des Updates unberührt.
EXPO_TOKEN="${EXPO_TOKEN:-}"; EXPO_TOKEN="${EXPO_TOKEN%$'\r'}"
if [ -z "$EXPO_TOKEN" ]; then
  echo "→ Keine OTA-Fassung: EXPO_TOKEN fehlt in $CREDENTIALS_FILE."
  echo "  Die Telefone bleiben auf ihrem Stand, bis ein iOS-Build kommt."
else
  echo "→ Veröffentliche die OTA-Fassung für die Telefone (EAS Update) …"
  if app_abbild && docker run --rm -e EXPO_TOKEN="$EXPO_TOKEN" \
      -e EAS_NO_VCS=1 \
      "$DEPS_IMAGE" \
      npx eas-cli@latest update --branch production \
        --message "Stand $COMMIT" --non-interactive 2>&1 |
      fremde_ausgabe
    [ "${PIPESTATUS[0]}" = "0" ]; then
    echo "✓ OTA-Fassung veröffentlicht (Stand $COMMIT). Die Telefone holen"
    echo "  sie beim nächsten Öffnen der App - angewendet wird sie beim"
    echo "  übernächsten Start."
  else
    echo "⚠ OTA-Veröffentlichung fehlgeschlagen - Web-Fassung und Hub sind"
    echo "  davon unberührt. Details: expo.dev/accounts/stibe88."
  fi
fi

if [ "${HOMEPILOT_IOS_BUILD:-0}" = "1" ]; then
    echo "→ Der Hub läuft bereits mit Stand $COMMIT - dieser Lauf gilt vor"
    echo "  allem dem iOS-Build."
  else
    echo "⚠ Der Hub läuft bereits mit Stand $COMMIT - auf GitHub liegt nichts"
    echo "  Neueres. Gebaut wird trotzdem; wechselt Portainer den Container"
    echo "  nicht, ist das hier der Grund und kein Fehler."
  fi
fi

# «Was ist neu»: die Betreffzeilen seit dem laufenden Stand wandern als
# changes.txt ins Abbild - die App zeigt sie nach dem Update einmal an.
# Kennt die (flache) Geschichte den alten Stand nicht, eben die letzten
# zehn; besser eine grosszügige Liste als gar keine.
CHANGES_FILE="$WORKDIR/hub/homepilot/changes.txt"
if [ -n "$RUNNING_COMMIT" ] \
   && git -C "$WORKDIR" cat-file -e "$RUNNING_COMMIT^{commit}" 2>/dev/null; then
  git -C "$WORKDIR" log --format='%s' "$RUNNING_COMMIT..HEAD" > "$CHANGES_FILE" 2>/dev/null || true
fi
if [ ! -s "$CHANGES_FILE" ]; then
  git -C "$WORKDIR" log --format='%s' -n 10 > "$CHANGES_FILE" 2>/dev/null || true
fi

# ── Das Abbild mit den App-Abhängigkeiten ──────────────────────────────
#
# Web-Fassung und iOS-Build brauchen beide ein `npm ci` im Ordner app/.
# Beides lief früher über `docker run -v "$WORKDIR/app:/app"` - und genau
# daran scheiterte es auf einem Docker aus dem Snap: Der Dienst sieht ein
# eigenes /tmp, der Ordner kam im Container leer an, und `npm ci` brach
# nach Sekunden ab. Sichtbar war davon nur «liess sich nicht anstossen».
#
# `docker build` hat dieses Problem nicht: Den Bau-Kontext packt der
# Client und schickt ihn an den Dienst - kein Pfad, den der Dienst selbst
# finden müsste. Deshalb wandert die Installation hierher, und beide
# Schritte laufen anschliessend in einem Abbild statt auf einer
# eingehängten Ablage.
#
# node:20-bookworm-slim statt alpine: Metro/Expo bringen gelegentlich
# Pakete mit, die eine echte glibc statt musl erwarten.
# ── Die Build-Nummer für Apple ─────────────────────────────────────────
#
# Apple nimmt jede Build-Nummer genau einmal an. EAS' `autoIncrement`
# zählt sie in der app.json hoch - und schreibt sie damit in eine Datei,
# die hier aus einem frischen Klon stammt und nach dem Lauf weggeworfen
# wird. Die Erhöhung überlebte den Lauf nicht: Jeder Build war wieder
# Nummer 2, und Apple wies ihn ab, weil es die 2 schon hatte.
#
# Die Anzahl Commits ist die Nummer, die es braucht: monoton steigend,
# ohne dass sich jemand etwas merken muss, und aus dem Repo ablesbar
# statt in ihm gespeichert.
#
# Bewusst mit sed statt mit node: Auf dem Host muss kein Node liegen -
# dafür gibt es das Abbild unten. Gesetzt wird aber, bevor das Abbild
# gebaut wird, denn es nimmt die app.json mit hinein.
BUILD_NUMMER="$(git -C "$WORKDIR" rev-list --count HEAD 2>/dev/null || echo 0)"
if [ "$BUILD_NUMMER" -gt 0 ] 2>/dev/null; then
  sed -i -E \
    -e "s/(\"buildNumber\"[[:space:]]*:[[:space:]]*\")[0-9]+(\")/\1${BUILD_NUMMER}\2/" \
    -e "s/(\"versionCode\"[[:space:]]*:[[:space:]]*)[0-9]+/\1${BUILD_NUMMER}/" \
    "$WORKDIR/app/app.json"
  echo "→ Build-Nummer für Apple: ${BUILD_NUMMER}"
else
  echo "⚠ Build-Nummer nicht zu ermitteln - Apple weist einen bereits"
  echo "  hochgeladenen Stand ab. Von Hand im Ordner app/:"
  echo "    node scripts/set-build-number.mjs <zahl>"
fi

DEPS_IMAGE="homepilot-appdeps"
WEB_IMAGE="homepilot-webdist"
DEPS_GEBAUT=0

app_abbild() {
  # Nur einmal je Lauf, auch wenn Web-Fassung und iOS-Build beide fragen.
  if [ "$DEPS_GEBAUT" = "1" ]; then
    return 0
  fi
  echo "→ Installiere die App-Abhängigkeiten (einmal für Web und iOS) …"
  if docker build -t "$DEPS_IMAGE" -f - "$WORKDIR/app" <<'DOCKERFILE'
FROM node:20-bookworm-slim
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund
# EAS bestimmt sonst über Git, welche Dateien es hochlädt. Hier gibt es
# kein Git (der Ordner ist aus dem Abbild, nicht aus einer Arbeitskopie),
# deshalb läuft der Build mit EAS_NO_VCS=1 - und dann ist diese Liste das
# Einzige, was node_modules vom Upload fernhält. Ohne sie wandern
# hunderte Megabyte zu Expo, die dort ohnehin neu installiert werden.
RUN printf 'node_modules/\ndist/\n.expo/\n.git/\n' > .easignore
DOCKERFILE
  then
    DEPS_GEBAUT=1
    return 0
  fi
  echo "⚠ 'npm ci' ist fehlgeschlagen - ohne die Abhängigkeiten lassen sich"
  echo "  weder die Web-Fassung noch der iOS-Build erzeugen. Die Ausgabe"
  echo "  darüber nennt die Ursache."
  echo "  Häufigster Fall: 'Missing … from lock file'. Dann steht ein Paket"
  echo "  in app/package.json, aber nicht in app/package-lock.json - 'npm"
  echo "  ci' baut bewusst nur nach der Sperrdatei. Zu beheben im Repo,"
  echo "  nicht hier: im Ordner app/ einmal"
  echo "    npm install --package-lock-only"
  echo "  laufen lassen und die geänderte package-lock.json einchecken."
  return 1
}

if [ -n "$WEB_ROOT" ] && [ "$WEB_ROOT" != "/" ] && [ ! -d "$WEB_ROOT" ]; then
  # Bisher wurde hier stumm übersprungen - und niemand erfuhr, warum die
  # Web-Fassung nie neuer wurde.
  echo "⚠ Web-Ordner $WEB_ROOT fehlt - die Web-Fassung wird nicht gebaut."
  echo "  Anlegen mit: sudo mkdir -p $WEB_ROOT"
fi
if [ -n "$WEB_ROOT" ] && [ "$WEB_ROOT" != "/" ] && [ -d "$WEB_ROOT" ]; then
  echo "→ Baue die Web-Fassung der App …"
  # Eine Schicht auf dem Abhängigkeits-Abbild; das fertige dist/ holt
  # danach `docker cp` heraus - auch das über die Schnittstelle, ohne
  # einen Pfad, den der Docker-Dienst selbst finden müsste.
  if app_abbild && docker build -t "$WEB_IMAGE" - <<DOCKERFILE
FROM ${DEPS_IMAGE}
RUN npm run build:web
DOCKERFILE
  then
    # Erst danebenlegen, dann tauschen. Der Live-Ordner wird nur geleert,
    # wenn eine vollständige neue Fassung bereitliegt - sonst stünde bei
    # einem Abbruch mitten im Kopieren gar keine App mehr da, und der Hub
    # liefert ohne index.html beim nächsten Start nur noch die
    # Schnittstelle aus.
    STAGING="${WEB_ROOT%/}.neu"
    rm -rf "$STAGING"
    mkdir -p "$STAGING"
    HILFS_ID=$(docker create "$WEB_IMAGE")
    docker cp "$HILFS_ID:/app/dist/." "$STAGING/" || true
    docker rm -f "$HILFS_ID" >/dev/null 2>&1 || true
    if [ -f "$STAGING/index.html" ]; then
      # Der Stempel, mit dem die App prüft, ob ihr Bundle zum Hub passt.
      printf '{"commit":"%s"}\n' "$COMMIT" > "$STAGING/version.json"
      # Den Ordner selbst behalten, nur seinen Inhalt tauschen: Er ist in
      # den Container eingehängt, ein neuer Ordner wäre dort unsichtbar.
      find "$WEB_ROOT" -mindepth 1 -delete
      cp -r "$STAGING/." "$WEB_ROOT/"
      rm -rf "$STAGING"
      echo "✓ Web-Fassung aktualisiert (Stand $COMMIT)."
    else
      rm -rf "$STAGING"
      echo "⚠ Der Web-Bau lieferte keine index.html - die bisherige Fassung"
      echo "  bleibt online. Der Hub selbst wird trotzdem weitergebaut."
    fi
  else
    echo "⚠ Web-Bau fehlgeschlagen - die bisherige Fassung bleibt online."
    echo "  Der Hub selbst wird trotzdem weitergebaut."
  fi
fi

# Den laufenden Stand beiseitelegen, bevor der neue entsteht. Kommt der
# neue nicht hoch, wird diese Marke wieder zur Hauptmarke - ohne sie
# müsste man den alten Commit von Hand suchen und neu bauen.
PREV_IMAGE_ID=""
if PREV_IMAGE_ID=$(docker image inspect "$IMAGE" -f '{{.Id}}' 2>/dev/null); then
  docker tag "$PREV_IMAGE_ID" "$IMAGE:prev" >/dev/null 2>&1 || PREV_IMAGE_ID=""
fi

echo "→ Baue das Abbild neu (ohne Cache) …"
# Commit und Bauzeit wandern ins Abbild (COMMIT stammt von weiter oben).
# Ohne sie zeigt die App nur «läuft», und nach einem Update sieht man
# nicht, ob der Container wirklich der neue ist.
docker build --no-cache \
  --build-arg "GIT_COMMIT=$COMMIT" \
  --build-arg "BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t "$IMAGE" "$WORKDIR/hub"

# Jeder Bauversuch läuft ohne Cache – jede Schicht entsteht neu, die vorige
# verliert nur ihre Markierung (dasselbe Tag zeigt jetzt aufs neue Abbild)
# und bleibt als "dangling" auf der Platte liegen. Der noch laufende
# Container hält sein Abbild weiter fest, das räumt Docker also nicht weg -
# ungenutzte Reste von zwei oder mehr Durchläufen zuvor aber schon. Ohne
# dieses Aufräumen füllt sich die Platte nach ein paar Updates von selbst,
# und dann schlägt nicht nur der nächste Bau fehl, sondern jedes Schreiben
# auf /config (Konfiguration speichern, Lautsprecher-Gruppen, Szenen …).
docker image prune -f >/dev/null
# Der zweite, grössere Fresser: BuildKits Bau-Zwischenspeicher. Bei einem
# --no-cache-Bau ist er nutzlos, wächst aber trotzdem um ~450 MB pro Lauf
# und wird von image prune nicht angefasst - auf docker01 war ER der
# Hauptteil der vollen Platte (4.8 GB). Auf 2 GB deckeln statt alles zu
# löschen, damit andere Projekte auf dem Host ihren jüngsten Cache
# behalten (ältere Docker-Fassungen kennen --keep-storage nicht - dann
# eben alles weg).
docker builder prune -f --keep-storage 2GB >/dev/null 2>&1 \
  || docker builder prune -f >/dev/null 2>&1 || true
echo "✓ Abbild '$IMAGE' ist aktuell, alte Schichten aufgeräumt."

# ── Optional: iOS-Build anstossen ───────────────────────────────────────
#
# Nur auf ausdrücklichen Wunsch (HOMEPILOT_IOS_BUILD=1, gesetzt vom
# Update-Knopf in der App, wenn man dort «mit iOS-Build» wählt). Ein
# App-Store-Build kostet Bauminuten im EAS-Kontingent und erzeugt eine
# neue TestFlight-Fassung - das soll kein Nebeneffekt jedes Updates sein.
#
# Gebaut wird auf den EAS-Servern; dieser Rechner stösst nur an. Dafür
# braucht es einen Zugriffs-Token (expo.dev → Account → Access tokens)
# in der Zugangsdatei:
#
#   EXPO_TOKEN=...
#
# --auto-submit reicht den fertigen Build gleich bei Apple ein;
# --no-wait beendet den Aufruf, sobald der Auftrag angenommen ist -
# sonst hielte er diesen Lauf 20 Minuten fest, für nichts.
if [ "${HOMEPILOT_IOS_BUILD:-0}" = "1" ]; then
  EXPO_TOKEN="${EXPO_TOKEN:-}"; EXPO_TOKEN="${EXPO_TOKEN%$'\r'}"
  if [ -z "$EXPO_TOKEN" ]; then
    echo "⚠ iOS-Build gewünscht, aber EXPO_TOKEN fehlt in $CREDENTIALS_FILE."
    echo "  Token erzeugen auf expo.dev → Account settings → Access tokens."
  else
    # Die App-Version bestimmt die runtimeVersion – und damit, welche
    # OTA-Fassungen auf diesen Build passen. Sie gehört ins Log: Ein
    # Build mit unveränderter Version nimmt auch alle alten OTA-Fassungen
    # an (Punkt 12 der Werkbank-Liste; Aufräumen: deploy/ota-aufraeumen.sh).
    APP_VERSION=$(python3 -c "import json; print(json.load(open('$WORKDIR/app/app.json'))['expo']['version'])" 2>/dev/null || echo "?")
    RUNTIME_VERSION=$(python3 -c "import json; print(json.load(open('$WORKDIR/app/app.json'))['expo'].get('runtimeVersion', '?'))" 2>/dev/null || echo "?")
    echo "→ Stosse den iOS-Build an (EAS baut, Apple bekommt ihn direkt) …"
    echo "  App-Version $APP_VERSION – bei einer Auslieferung mit Änderungen"
    echo "  gehört sie hochgezählt (app/app.json, siehe CLAUDE.md)."
    echo "  Laufzeit $RUNTIME_VERSION – nur diese entscheidet, welche"
    echo "  OTA-Fassungen auf diesen Build passen. Sie ändert sich nur bei"
    echo "  nativen Änderungen."
    # EXPO_NO_CAPABILITY_SYNC=1: EAS möchte die Fähigkeiten der Bundle-ID
    # im Apple-Portal selbst nachziehen. Für App-Gruppen schickt es dabei
    # eine Anfrage, die Apple zurückweist («Unexpected or invalid value at
    # data.relationships.bundleIdCapabilities») - und bricht den ganzen
    # Build ab, obwohl im Portal alles stimmt. Also gar nicht erst
    # versuchen: Die Fähigkeiten werden dort von Hand gesetzt, einmalig,
    # und danach ändern sie sich nicht mehr.
    IOS_LOG=$(mktemp)
    if app_abbild && docker run --rm -e EXPO_TOKEN="$EXPO_TOKEN" \
        -e EAS_NO_VCS=1 \
        -e EXPO_NO_CAPABILITY_SYNC=1 \
        "$DEPS_IMAGE" \
        npx eas-cli@latest build --platform ios --profile production \
          --auto-submit --non-interactive --no-wait 2>&1 |
        fremde_ausgabe | tee "$IOS_LOG"
      [ "${PIPESTATUS[0]}" = "0" ]; then
      echo "✓ iOS-Build läuft auf den EAS-Servern - TestFlight meldet sich."
    else
      echo "⚠ iOS-Build liess sich nicht anstossen - das Hub-Update selbst"
      echo "  ist davon unberührt."
      # Die entscheidende Zeile aus dem eas-Log gleich mitgeben: «liess
      # sich nicht anstossen» ohne das Warum hiess bisher, die Ursache
      # per SSH im Journal zu suchen. Das «| » stammt von fremde_ausgabe.
      sed 's/^| //' "$IOS_LOG" | grep -iE "error|failed|cannot|missing" \
        | tail -1 | cut -c1-90 | sed 's/^/  /'
      # Die häufigsten Gründe haben eine Lösung, die nicht im Log steht.
      # Wer das liest, soll wissen, wohin - nicht bloss, dass etwas
      # schiefging.
      if grep -qiE "application-groups|app group|bundleIdCapabilities" "$IOS_LOG"; then
        echo "  Es fehlt die App-Gruppe im Apple-Portal. Einmalig:"
        echo "  1. developer.apple.com → Identifiers → App Groups → +"
        echo "     Name frei, Kennung: group.me.stibe.homepilot"
        echo "  2. Bei ch.stibe.homepilot und ch.stibe.homepilot.widget"
        echo "     «App Groups» anhaken und die Gruppe auswählen."
      elif grep -qiE "credentials|provisioning|bundle identifier|not registered" "$IOS_LOG"; then
        # Ein neues Bau-Ziel (zuletzt: die Watch-App mit
        # ch.stibe.homepilot.watch) braucht erstmalig Kennung und Profil
        # bei Apple - im stillen Lauf legt EAS nichts Neues an.
        echo "  Vermutlich fehlen Apple-Unterlagen für ein neues Bau-Ziel."
        echo "  Einmalig einen Build mit Rückfragen anstossen:"
        echo "    sudo docker run --rm -it -e EXPO_TOKEN=<Token> \\"
        echo "      homepilot-appdeps npx eas-cli@latest build \\"
        echo "      --platform ios --profile production"
        echo "  Danach geht es wieder über den Update-Knopf."
      else
        echo "  Details: expo.dev/accounts/stibe88."
      fi
    fi
    rm -f "$IOS_LOG"
  fi
fi

# Erst jetzt aufräumen: Der iOS-Block oben braucht $WORKDIR/app noch.
rm -rf "$WORKDIR"

# Die Hilfsabbilder sind Zwischenschritte, keine Ergebnisse - die Marken
# weg, damit sie sich nicht Lauf für Lauf sammeln. Die Schichten bleiben
# im Bau-Zwischenspeicher, den weiter oben schon ein Deckel begrenzt.
docker image rm -f "$WEB_IMAGE" "$DEPS_IMAGE" >/dev/null 2>&1 || true

# Was dieser Lauf gekostet hat. Die Zahl ist die eigentliche Auskunft:
# Ein Update darf Platz brauchen, aber nicht bei jedem Mal denselben
# wieder - bleibt die Differenz Lauf für Lauf negativ, wächst etwas, das
# hier niemand aufräumt.
platz_notiz nachher
FREI_NACHHER=$(platz_frei_kb)
DIFF=$((FREI_NACHHER - FREI_VORHER))
echo "→ Platz:"
echo "  frei: $(numfmt --to=iec --from-unit=1024 "$FREI_NACHHER")"
if [ "$DIFF" -lt 0 ]; then
  echo "  dieser Lauf hat $(numfmt --to=iec --from-unit=1024 $((0 - DIFF))) gekostet"
elif [ "$DIFF" -gt 0 ]; then
  echo "  dieser Lauf hat $(numfmt --to=iec --from-unit=1024 "$DIFF") frei gemacht"
fi
echo "  Verlauf: $PLATZ_LOG"
docker system df 2>/dev/null | sed 's/^/  /'

# Der Fresser, den kein prune anfasst: die Ausgabe der Container selbst.
# Docker schreibt sie ohne Deckel in eine Datei je Container, und die
# wächst, solange der Container läuft - bei einem gesprächigen Dienst um
# Gigabytes im Jahr. Bewusst nur melden und nicht löschen: Das Protokoll
# ist das Erste, was man nach einer Störung braucht, und der richtige Ort
# für die Lösung ist ohnehin ein Deckel in der daemon.json (siehe
# deploy/README.md), nicht ein Wegwerfen bei jedem Bau.
DOCKER_ROOT="$(docker_root)"
if [ -d "$DOCKER_ROOT/containers" ]; then
  BIG=$(find "$DOCKER_ROOT/containers" -name '*-json.log' -size +100M 2>/dev/null || true)
  if [ -n "$BIG" ]; then
    echo "⚠ Container-Protokolle über 100 MB:"
    # shellcheck disable=SC2086
    du -h $BIG 2>/dev/null | sed 's/^/  /'
    echo "  Dauerhaft deckeln: /etc/docker/daemon.json (siehe deploy/README.md)."
  fi
fi

if [ -n "${PORTAINER_WEBHOOK_URL:-}" ]; then
  # Der alte Container bleibt bewusst stehen: Den Tausch macht Portainer
  # beim Ausrollen selbst. Scheitert es dort (etwa am Re-pull eines lokal
  # gebauten Abbilds), läuft der alte Stand einfach weiter - ein
  # misslungenes Update ist dann ein Nicht-Ereignis, kein Ausfall.
  NEW_IMAGE_ID=$(docker image inspect "$IMAGE" -f '{{.Id}}')
  echo "→ Löse den Portainer-Webhook aus …"
  # Portainer stellt sein Zertifikat auf Port 9443 selbst aus. Prüfen lässt
  # es sich deshalb nicht - und ohne die folgende Zeile bricht curl mit
  # einem Zertifikatsfehler ab, mitten im sonst fertigen Update.
  #
  # Bewusst als eigene Variable und nicht fest eingebaut: Wer Portainer
  # hinter einem richtigen Zertifikat betreibt, soll die Prüfung behalten.
  # Vertretbar ist das Abschalten nur, weil der Aufruf im eigenen Netz
  # bleibt und nichts Geheimes überträgt - die Adresse selbst ist das
  # Geheimnis, und die kennt der Angreifer dann ohnehin schon.
  INSECURE=""
  if [ "${PORTAINER_INSECURE:-0}" = "1" ]; then
    INSECURE="--insecure"
  fi

  # pullimage=false ist hier keine Feinheit, sondern Voraussetzung: Das
  # Abbild entsteht auf diesem Rechner und liegt in keiner Registry.
  # Portainer zieht vor dem Ausrollen standardmässig alle Abbilder des
  # Stacks neu - und scheitert dann mit «pull access denied for
  # homepilot-hub, repository does not exist». Der Stack bleibt auf dem
  # alten Stand, obwohl das neue Abbild fertig danebenliegt.
  HOOK_URL="$PORTAINER_WEBHOOK_URL"
  case "$HOOK_URL" in
    *pullimage=*) ;;
    *\?*) HOOK_URL="$HOOK_URL&pullimage=false" ;;
    *)    HOOK_URL="$HOOK_URL?pullimage=false" ;;
  esac

  # Bewusst ohne -f: Bei einem Fehler ist Portainers Antworttext die
  # eigentliche Auskunft ("pull access denied …"), und -f wirft ihn weg.
  # Genau das hat die Suche nach diesem Fehler unnötig lange gemacht.
  HOOK_BODY=$(mktemp)
  CURL_CODE=0
  # shellcheck disable=SC2086
  HTTP_CODE=$(curl -sS $INSECURE -o "$HOOK_BODY" -w '%{http_code}' \
    --max-time 60 -X POST "$HOOK_URL") || CURL_CODE=$?

  case "${HTTP_CODE:-000}" in
    2*) OK_HOOK=1 ;;
    *)  OK_HOOK=0 ;;
  esac
  if [ "$CURL_CODE" != "0" ]; then
    OK_HOOK=0
  fi

  if [ "$OK_HOOK" != "1" ]; then
    echo ""
    if [ "$CURL_CODE" != "0" ]; then
      echo "✗ Der Portainer-Webhook war nicht erreichbar (curl-Code $CURL_CODE)."
    else
      echo "✗ Portainer hat das Ausrollen abgelehnt (HTTP $HTTP_CODE)."
    fi
    echo "  Das neue Abbild ist gebaut, aber nicht ausgerollt - der Hub läuft"
    echo "  mit dem BISHERIGEN Stand weiter. Das Haus ist also nicht offline."
    case "$CURL_CODE" in
      60|35|51)
        echo "  Ursache: Zertifikatsfehler. Portainer stellt sein Zertifikat"
        echo "  auf 9443 selbst aus - in $CREDENTIALS_FILE gehört die Zeile:"
        echo "    PORTAINER_INSECURE=1"
        ;;
      7|28)
        echo "  Ursache: Portainer war nicht erreichbar. Läuft der Container?"
        echo "    docker ps --filter name=portainer"
        ;;
    esac
    if [ "$HTTP_CODE" = "404" ]; then
      echo "  Ursache: Den Webhook gibt es nicht mehr. In Portainer unter"
      echo "  Stacks → homepilot → Webhook die Adresse ablesen und in"
      echo "  $CREDENTIALS_FILE als PORTAINER_WEBHOOK_URL eintragen."
    fi
    if grep -q "pull access denied" "$HOOK_BODY" 2>/dev/null; then
      echo "  Ursache: Portainer wollte das Abbild aus einer Registry holen."
      echo "  Es entsteht aber auf diesem Rechner und liegt in keiner."
      echo "  Dieses Skript hängt dafür 'pullimage=false' an - greift das"
      echo "  nicht, im Stack unter «Update the stack» Re-pull image AUS."
    fi
    # Was Portainer selbst sagt, gekürzt - der Text nennt oft genau das
    # Abbild und die Zeile, an der es hängt.
    if [ -s "$HOOK_BODY" ]; then
      echo "  Portainer sagt:"
      head -c 600 "$HOOK_BODY" | tr '\n' ' ' | fold -w 76 -s | sed 's/^/    /'
      echo ""
    fi
    rm -f "$HOOK_BODY"
    echo "  Von Hand ausrollen: Portainer → Stacks → homepilot →"
    echo "  Update the stack → Re-pull image AUS → Deploy."
    exit 1
  fi
  rm -f "$HOOK_BODY"

  # Der Webhook meldet nur «angenommen» - ob das Ausrollen gelingt,
  # entscheidet sich danach. Woran man den Erfolg erkennt: Der laufende
  # Container zeigt auf das frisch gebaute Abbild. Der Hub selbst kann
  # dabei kurz weg sein (der Tausch), deshalb zusätzlich auf /api/health
  # warten.
  echo "→ Warte auf den Wechsel …"
  # Grosszügig warten: Portainer klont bei Repo-Stacks erst das Repo neu,
  # erstellt dann den Container, und der Hub braucht seinen Start. 90
  # Sekunden waren dafür zu knapp - das Skript meldete «nicht gewechselt»,
  # während Portainer noch mitten in der Arbeit steckte.
  TICK=0
  for _ in $(seq 1 150); do
    sleep 2
    TICK=$((TICK + 1))
    if [ $((TICK % 15)) -eq 0 ]; then
      echo "→ Warte auf den Wechsel … ($((TICK * 2)) s)"
    fi
    RUNNING_IMAGE_ID=$(docker inspect -f '{{.Image}}' "$CONTAINER" 2>/dev/null || echo "keiner")
    if [ "$RUNNING_IMAGE_ID" = "$NEW_IMAGE_ID" ] \
       && curl -fsS -m 3 "http://127.0.0.1:8123/api/health" >/dev/null 2>&1; then
      echo ""
      echo "✓ Fertig - der Hub läuft mit dem frischen Abbild."
      echo "  (Der vorherige Stand bleibt als '$IMAGE:prev' liegen.)"
      exit 0
    fi
  done
  echo ""
  # Der Wechsel hat nicht innerhalb der Wartezeit geklappt. Bevor daraus
  # eine Diagnose wird: nachsehen, was tatsächlich läuft. Früher stand
  # hier pauschal «Portainer hat den Container nicht gewechselt» - auch
  # dann, wenn Portainer sauber gewechselt hatte und bloss der Hub nicht
  # hochkam. Das schickte die Fehlersuche in die falsche Richtung.
  RUNNING_IMAGE_ID=$(docker inspect -f '{{.Image}}' "$CONTAINER" 2>/dev/null || echo "keiner")
  NOW_COMMIT=$(docker exec "$CONTAINER" printenv HOMEPILOT_COMMIT 2>/dev/null || echo "")
  if [ "$RUNNING_IMAGE_ID" = "$NEW_IMAGE_ID" ]; then
    echo "✗ Der neue Stand läuft, antwortet aber nicht."
    echo "  Portainer hat also sauber gewechselt - der Hub selbst kommt"
    echo "  nicht hoch. Fast immer steht der Grund in der ersten"
    echo "  Fehlermeldung seines Protokolls:"
    echo ""
    docker logs --tail 40 "$CONTAINER" 2>&1 | sed 's/^/    /'
    echo ""
    echo "  Häufig ist es die config.yaml: ein Tippfehler, ein Block, der"
    echo "  eine Umgebungsvariable erwartet, die im Portainer-Stack fehlt."
    echo "  Ist der Fehler behoben, genügt ein Neustart des Containers -"
    echo "  neu bauen muss man dafür nicht:"
    echo "    docker restart $CONTAINER"
    echo ""
    echo "  Zurück auf den vorherigen Stand ginge notfalls so:"
    echo "    docker tag $IMAGE:prev $IMAGE && docker restart $CONTAINER"
    exit 1
  fi
  if [ "$RUNNING_IMAGE_ID" = "keiner" ]; then
    echo "✗ Portainer hat den Container entfernt, aber keinen neuen"
    echo "  gestartet."
    # Genau der Fall, für den die Marke da ist: Es läuft nichts mehr, und
    # das neue Abbild ist offenbar schuld. Zurück auf den letzten Stand,
    # der nachweislich lief, und noch einmal ausrollen.
    if [ -n "$PREV_IMAGE_ID" ]; then
      echo "→ Falle auf den vorherigen Stand zurück …"
      docker tag "$PREV_IMAGE_ID" "$IMAGE"
      # shellcheck disable=SC2086
      if curl -fsS $INSECURE -X POST "$PORTAINER_WEBHOOK_URL"; then
        for _ in $(seq 1 30); do
          sleep 2
          BACK=$(docker inspect -f '{{.Image}}' "$CONTAINER" 2>/dev/null || echo "keiner")
          if [ "$BACK" = "$PREV_IMAGE_ID" ]; then
            echo ""
            echo "✓ Der vorherige Stand läuft wieder. Das neue Abbild kam"
            echo "  nicht hoch - im Container-Log steht, warum:"
            echo "    docker logs --tail 200 $CONTAINER"
            exit 1
          fi
        done
      fi
      echo "✗ Auch der Rückfall kam nicht durch."
    fi
    echo "  Von Hand: Portainer → Stacks → homepilot →"
    echo "  Update the stack → Re-pull image AUS → Deploy."
  elif [ -n "$NOW_COMMIT" ] && [ "$NOW_COMMIT" = "$COMMIT" ]; then
    # Kein Fehler: Es lief schon der neueste Stand, und bei unverändertem
    # Git-Stand rollt Portainer nicht neu aus. Genau so sieht der Lauf
    # «nur ein iOS-Build, bitte» aus - der endete hier früher fälschlich
    # als Fehlermeldung, und der angestossene iOS-Build ging darin unter.
    echo "✓ Fertig - der Hub läuft bereits mit dem neuesten Stand ($COMMIT)."
    if [ "${HOMEPILOT_IOS_BUILD:-0}" = "1" ]; then
      echo "  Der iOS-Build wurde angestossen - TestFlight meldet sich."
    fi
    exit 0
  else
    echo "✗ Portainer hat den Container nicht gewechselt - der alte Stand"
    echo "  läuft weiter (das Haus ist also nicht offline)."
    if [ -n "$NOW_COMMIT" ]; then
      echo "  Im Container steckt weiterhin $NOW_COMMIT, gebaut ist $COMMIT."
    fi
    echo "  Der Webhook meldet nur «angenommen»; was danach schiefgeht,"
    echo "  steht allein in Portainers Protokoll - und das führt fast"
    echo "  immer auf einen dieser drei Punkte:"
    echo "    1. «Re-pull image» ist im Stack an. Das Abbild entsteht hier"
    echo "       und liegt in keiner Registry, das Ziehen scheitert und"
    echo "       reisst das ganze Ausrollen mit. Ausschalten."
    echo "    2. Der Stack zeigt auf einen anderen Zweig als den gebauten"
    echo "       ($BRANCH). Dann klont Portainer etwas anderes."
    echo "    3. Der Webhook gehört zu einem anderen Stack."
    echo "  Von Hand: Portainer → Stacks → homepilot →"
    echo "  Update the stack → Re-pull image AUS → Deploy."
  fi
  exit 1
else
  echo "  Jetzt in Portainer: Stacks → homepilot → Update the stack → Deploy."
  echo "  Der alte Container läuft bis dahin weiter."
fi
