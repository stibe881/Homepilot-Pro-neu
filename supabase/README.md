# Supabase einrichten

Der Hub nutzt Supabase (gehostetes Postgres) als Datenbank für den letzten
bekannten Zustand aller Entitäten, den Zustandsverlauf und das Protokoll der
Automationsläufe.

## 1. Projekt anlegen

1. Auf [supabase.com](https://supabase.com) ein Projekt erstellen
   (Region: `Central EU (Frankfurt)` ist von der Schweiz aus am schnellsten).
2. Unter **Project Settings → API** notieren:
   - **Project URL** → `https://<projekt-ref>.supabase.co`
   - **service_role key** (nicht der anon key!)

## 2. Schema einspielen

Im Dashboard **SQL Editor** öffnen und den Inhalt von
[`migrations/0001_initial.sql`](migrations/0001_initial.sql) ausführen.

Alternativ mit der Supabase CLI:

```bash
supabase link --project-ref <projekt-ref>
supabase db push
```

## 3. Hub konfigurieren

In `hub/config.yaml`:

```yaml
supabase:
  url: "https://<projekt-ref>.supabase.co"
  service_key: "${SUPABASE_SERVICE_KEY}"   # aus der Umgebung lesen
  history: true
  flush_interval: 5          # Sekunden zwischen Schreibvorgängen
  history_exclude: []        # z.B. ["demo.*"] – kein Verlauf für diese Entitäten
```

Werte in der Form `${VARIABLE}` werden aus Umgebungsvariablen gelesen –
so landet der Key nicht in der Datei:

```bash
export SUPABASE_SERVICE_KEY="eyJ..."
python -m homepilot -c config.yaml
```

## Sicherheitsmodell

Der **service_role-Key umgeht Row Level Security** und darf deshalb
ausschliesslich auf dem Hub liegen – nie in der App, nie im Repo.

Die App spricht nie direkt mit Supabase, sondern nur mit dem Hub
(`/api/entities/{id}/history`). Damit gibt es genau einen Ort mit
Datenbankzugriff, und die App braucht nur ihr Hub-Token.

RLS ist auf allen Tabellen aktiv, ohne Policies für `anon`/`authenticated` –
ein versehentlich geleakter anon-Key gibt also keinerlei Zugriff.

## Verhalten bei Ausfall

Der Hub funktioniert vollständig ohne Supabase weiter: Schreibvorgänge werden
in einer Warteschlange gepuffert (gedeckelt, damit der Speicher nicht
volläuft) und beim nächsten erfolgreichen Flush nachgeholt. Ist Supabase
dauerhaft nicht erreichbar, laufen Geräte, App und Automationen normal –
es fehlt nur der Verlauf.

## Wiederherstellen nach Neustart

Beim Start lädt der Hub die gespeicherten Zustände. Sie füllen nur
Attribute, die die Integration selbst nicht liefert: was ein echtes Gerät
meldet, gewinnt immer. Damit sind virtuelle Werte (z.B. eine gemerkte
Zielhelligkeit) nach einem Neustart wieder da, ohne dass veraltete Werte
echte Gerätezustände überschreiben.
