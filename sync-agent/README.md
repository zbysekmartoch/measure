# Sync Agent

Obousměrný synchronizační agent pro platformu Measure. Synchronizuje soubory mezi lokální složkou na PC a serverem. Ideální pro práci na šablonách (Word, Excel, …) bez nutnosti opakovaného ručního uploadu.

## Jak to funguje

1. **Na serveru** (v Measure): Otevřete lab → záložka Scripts → na složce, kterou chcete synchronizovat, klikněte na tlačítko 🔄 (**Create sync config**).
2. Tím se ve složce vytvoří soubor `sync.json`.
3. **Stáhněte** `sync.json` na svůj PC (pravý klik → Download).
4. Vytvořte si lokální složku pro synchronizaci a vložte do ní:
   - `sync.json`
   - `syncagent.exe` (Windows) nebo `syncagent` (Linux)
5. **Spusťte** `syncagent.exe`.

Agent si přečte konfiguraci ze `sync.json`, připojí se k serveru a začne synchronizovat soubory každých několik sekund.

## Pravidla synchronizace

- Synchronizují se **pouze soubory existující na serveru**
- Nový soubor na serveru → automaticky se stáhne
- Lokální změna (novější soubor) → nahraje se na server
- Serverová změna (novější soubor) → stáhne se na PC
- Mazání a vytváření souborů se provádí výhradně na serveru ve webovém rozhraní

## sync.json

```json
{
  "server": "https://measure.example.com",
  "labId": "5",
  "folder": "templates/reports",
  "token": "eyJhbG...",
  "syncInterval": 3,
  "created": "2026-03-18T..."
}
```

| Pole | Popis |
|------|-------|
| `server` | URL serveru (automaticky se vyplní) |
| `labId` | ID labu |
| `folder` | Cesta ke složce v rámci scripts |
| `token` | Autentizační token (platnost 1 rok) |
| `syncInterval` | Interval synchronizace v sekundách (výchozí 3) |
| `skipTlsVerify` | `true` pro přeskočení ověření TLS certifikátu |

## Build

Potřebujete Go 1.21+.

```bash
cd sync-agent
./build.sh
```

Výsledné binárky:
- `dist/syncagent.exe` — Windows (amd64)
- `dist/syncagent` — Linux (amd64)

Nebo ruční build:

```bash
# Windows
GOOS=windows GOARCH=amd64 go build -ldflags "-s -w" -o syncagent.exe .

# Linux
GOOS=linux GOARCH=amd64 go build -ldflags "-s -w" -o syncagent .
```
