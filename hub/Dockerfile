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
