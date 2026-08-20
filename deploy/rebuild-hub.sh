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
git clone --depth 1 -b "$BRANCH" \
  "https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/${REPO}.git" "$WORKDIR"

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
# Den Update-Dienst nur hinlegen, nie hier neu starten: Ein Neustart würde
# genau den Bau abwürgen, den er gerade beaufsichtigt.
if [ -f /opt/homepilot/update-listener.py ] \
   && ! cmp -s "$WORKDIR/deploy/update-listener.py" /opt/homepilot/update-listener.py; then
  cp "$WORKDIR/deploy/update-listener.py" /opt/homepilot/update-listener.py
  echo "→ update-listener.py aktualisiert - danach einmal von Hand:"
  echo "  sudo systemctl restart homepilot-update   (nicht während eines Baus)"
fi

# Schon hier bestimmen, nicht erst beim Abbild: Der Stempel wandert auch
# in die Web-Fassung (version.json), damit die App prüfen kann, ob das
# Bundle im Browser zum laufenden Hub passt.
COMMIT="$(git -C "$WORKDIR" rev-parse --short HEAD)"

if [ -n "$WEB_ROOT" ] && [ "$WEB_ROOT" != "/" ] && [ ! -d "$WEB_ROOT" ]; then
  # Bisher wurde hier stumm übersprungen - und niemand erfuhr, warum die
  # Web-Fassung nie neuer wurde.
  echo "⚠ Web-Ordner $WEB_ROOT fehlt - die Web-Fassung wird nicht gebaut."
  echo "  Anlegen mit: sudo mkdir -p $WEB_ROOT"
fi
if [ -n "$WEB_ROOT" ] && [ "$WEB_ROOT" != "/" ] && [ -d "$WEB_ROOT" ]; then
  echo "→ Baue die Web-Fassung der App …"
  # node:20-bookworm-slim statt alpine: Metro/Expo bringen gelegentlich
  # Pakete mit, die eine echte glibc statt musl erwarten - das Abbild ist
  # etwas grösser, bleibt dafür aber Überraschungen erspart. Bleibt danach
  # im Docker-Cache liegen, kein erneuter Download bei jedem Lauf.
  if docker run --rm \
      -v "$WORKDIR/app:/app" -w /app \
      node:20-bookworm-slim \
      sh -c "npm ci --no-audit --no-fund && npm run build:web"; then
    # Den alten Stand erst jetzt wegräumen, nicht vorher - schlägt der Bau
    # fehl, bleibt die zuletzt funktionierende Fassung online.
    find "$WEB_ROOT" -mindepth 1 -delete
    cp -r "$WORKDIR/app/dist/." "$WEB_ROOT/"
    # Der Stempel, mit dem die App prüft, ob ihr Bundle zum Hub passt.
    printf '{"commit":"%s"}\n' "$COMMIT" > "$WEB_ROOT/version.json"
    echo "✓ Web-Fassung aktualisiert (Stand $COMMIT)."
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
    echo "→ Stosse den iOS-Build an (EAS baut, Apple bekommt ihn direkt) …"
    if docker run --rm -e EXPO_TOKEN="$EXPO_TOKEN" \
        -v "$WORKDIR/app:/app" -w /app \
        node:20-bookworm-slim \
        sh -c "npm ci --no-audit --no-fund >/dev/null 2>&1 && \
               npx eas-cli@latest build --platform ios --profile production \
                 --auto-submit --non-interactive --no-wait"; then
      echo "✓ iOS-Build läuft auf den EAS-Servern - TestFlight meldet sich."
    else
      echo "⚠ iOS-Build liess sich nicht anstossen - das Hub-Update selbst"
      echo "  ist davon unberührt. Details: expo.dev/accounts/stibe88."
    fi
  fi
fi

# Erst jetzt aufräumen: Der iOS-Block oben braucht $WORKDIR/app noch.
rm -rf "$WORKDIR"

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
  for _ in $(seq 1 45); do
    sleep 2
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
  else
    echo "✗ Portainer hat den Container nicht gewechselt - der alte Stand"
    echo "  läuft weiter (das Haus ist also nicht offline). Meist scheitert"
    echo "  das Ausrollen am Re-pull des lokal gebauten Abbilds."
    echo "  Von Hand: Portainer → Stacks → homepilot →"
    echo "  Update the stack → Re-pull image AUS → Deploy."
  fi
  exit 1
else
  echo "  Jetzt in Portainer: Stacks → homepilot → Update the stack → Deploy."
  echo "  Der alte Container läuft bis dahin weiter."
fi
