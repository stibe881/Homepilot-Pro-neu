# Hub-Abbild für den Dauerbetrieb (Raspberry Pi, NAS, Mini-PC).
#
# Bauen und starten am einfachsten über die docker-compose.yml im
# Wurzelverzeichnis – siehe deploy/README.md.

FROM python:3.12-slim

# Abhängigkeiten zuerst, damit Docker sie beim Ändern von Code nicht
# jedes Mal neu installiert.
WORKDIR /app
COPY pyproject.toml ./
COPY homepilot ./homepilot
RUN pip install --no-cache-dir .

# Nicht als root laufen lassen.
RUN useradd --create-home --uid 1000 homepilot
USER homepilot

EXPOSE 8123

# Der Pfad zur Konfiguration wird als Volume hereingereicht.
ENV HOMEPILOT_CONFIG=/config/config.yaml
CMD ["sh", "-c", "python -m homepilot -c \"$HOMEPILOT_CONFIG\""]
