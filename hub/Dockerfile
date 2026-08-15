# Hub-Abbild für den Dauerbetrieb (Raspberry Pi, NAS, Mini-PC).
#
# Bauen und starten am einfachsten über die docker-compose.yml im
# Wurzelverzeichnis – siehe deploy/README.md.

FROM python:3.12-slim

# Ohne das puffert Python stdout – der Einrichtungs-QR-Code erschiene
# nie in `docker logs`.
ENV PYTHONUNBUFFERED=1

# Abhängigkeiten zuerst, damit Docker sie beim Ändern von Code nicht
# jedes Mal neu installiert. Im Container sind alle optionalen
# Integrationsbibliotheken dabei (Ring, Roborock, Cast, Android TV) –
# auf einem Hub-Server zählt Vollständigkeit mehr als Abbildgrösse.
WORKDIR /app
COPY pyproject.toml ./
COPY homepilot ./homepilot
RUN pip install --no-cache-dir ".[roborock,cast,androidtv,ring]"

# Nicht als root laufen lassen.
RUN useradd --create-home --uid 1000 homepilot
USER homepilot

EXPOSE 8123

# Der Pfad zur Konfiguration wird als Volume hereingereicht.
ENV HOMEPILOT_CONFIG=/config/config.yaml
CMD ["sh", "-c", "python -m homepilot -c \"$HOMEPILOT_CONFIG\""]
