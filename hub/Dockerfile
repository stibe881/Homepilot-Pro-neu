# Hub-Abbild für den Dauerbetrieb (Raspberry Pi, NAS, Mini-PC).
#
# Bauen und starten am einfachsten über die docker-compose.yml im
# Wurzelverzeichnis – siehe deploy/README.md.

FROM python:3.12-slim

# Ohne das puffert Python stdout – der Einrichtungs-QR-Code erschiene
# nie in `docker logs`.
ENV PYTHONUNBUFFERED=1

# ffmpeg packt den RTSP-Strom der Kameras in HLS um, das iPhone und iPad
# von Haus aus abspielen. Ohne ffmpeg gibt es Standbilder, aber kein
# Live-Bild – neu codiert wird dabei nichts, das kostet also kaum Rechenzeit.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Abhängigkeiten zuerst, damit Docker sie beim Ändern von Code nicht
# jedes Mal neu installiert. Im Container sind alle optionalen
# Integrationsbibliotheken dabei (Ring, Roborock, Cast, Android TV, Tuya) –
# auf einem Hub-Server zählt Vollständigkeit mehr als Abbildgrösse.
WORKDIR /app
COPY pyproject.toml ./
COPY homepilot ./homepilot
RUN pip install --no-cache-dir ".[roborock,cast,androidtv,ring,overkiz,pitboss,speech,tuya]"

# Nicht als root laufen lassen.
RUN useradd --create-home --uid 1000 homepilot
USER homepilot

EXPOSE 8123

# Ob der Hub noch antwortet - nicht bloss, ob der Prozess noch existiert.
# Ein hängender Hub sah für Docker bisher kerngesund aus, und der
# Neustart-Mechanismus griff nie. Der Aufruf ist absichtlich ohne Token:
# /api/health sagt nur, dass die Anwendung antwortet, und verrät nichts.
#
# start-period ist grosszügig: Beim ersten Start verbindet sich der Hub
# mit CCU, Bridge und Broker, und das darf dauern, ohne dass er dabei als
# krank gilt.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8123/api/health', timeout=4).status == 200 else 1)"

# Der Pfad zur Konfiguration wird als Volume hereingereicht.
# Welcher Stand hier läuft. Ohne das lässt sich nach einem Update nicht
# unterscheiden, ob der Container wirklich neu ist oder ob Portainer das
# alte Abbild noch einmal ausgerollt hat.
ARG GIT_COMMIT=unbekannt
ARG BUILD_TIME=unbekannt
ENV HOMEPILOT_COMMIT=$GIT_COMMIT
ENV HOMEPILOT_BUILD_TIME=$BUILD_TIME

ENV HOMEPILOT_CONFIG=/config/config.yaml
CMD ["sh", "-c", "python -m homepilot -c \"$HOMEPILOT_CONFIG\""]
