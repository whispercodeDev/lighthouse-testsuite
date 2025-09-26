# Lighthouse Test Suite

Eine Web-Anwendung zum Testen von Websites mit Google Lighthouse und zum Vergleichen von Performance-Metriken zwischen Git-Branches.

## Features

- **URL-Testing**: Eingabe mehrerer URLs für Lighthouse-Tests
- **Branch-Vergleich**: Vergleich der Performance zwischen zwei Git-Branches
- **Automatische Branch-Umschaltung**: Automatisches Checkout der Branches im angegebenen Projektverzeichnis
- **Detaillierte Berichte**: Anzeige von Performance-Scores und Metriken
- **Verbesserungsanalyse**: Identifikation von Verbesserungen und Verschlechterungen zwischen Branches

## Voraussetzungen

- Node.js (v14 oder höher)
- Google Lighthouse CLI (bereits installiert unter `/home/cj/.npm-global/bin/lighthouse`)
- Git (für Branch-Vergleiche)

## Installation

```bash
npm install
```

## Verwendung

1. Server starten:
```bash
npm start
```

2. Browser öffnen und zu `http://localhost:3000` navigieren

3. URLs eingeben (eine pro Zeile)

4. Optional: Branch-Vergleich aktivieren und konfigurieren:
   - Projektverzeichnis angeben
   - Baseline Branch (z.B. `main`)
   - Vergleichs-Branch (z.B. `feature-branch`)

5. "Lighthouse Tests starten" klicken

## Branch-Vergleich

Wenn der Branch-Vergleich aktiviert ist:

1. Das System wechselt zum ersten Branch (Baseline)
2. Führt Lighthouse-Tests für alle URLs aus
3. Wechselt zum zweiten Branch (Vergleich)
4. Führt erneut Lighthouse-Tests aus
5. Zeigt einen detaillierten Vergleich mit Verbesserungen/Verschlechterungen

## API Endpunkte

### POST /run-lighthouse

Führt Lighthouse-Tests aus.

**Request Body:**
```json
{
  "urls": ["https://example.com", "https://example.com/about"],
  "projectPath": "/pfad/zum/projekt",
  "branch1": "main",
  "branch2": "feature-branch"
}
```

**Response:**
```json
{
  "branch1": [...],
  "branch2": [...],
  "comparison": {
    "baseline": "main",
    "comparison": "feature-branch",
    "improvements": [...],
    "regressions": [...],
    "summary": {...}
  }
}
```

## Entwicklung

Für die Entwicklung mit automatischem Neuladen:

```bash
npm run dev
```