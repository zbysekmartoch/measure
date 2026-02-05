# MEASURE

**M**odular **E**xtensible **A**nalytical **S**tack — **UOHS Research Environment**

MEASURE is a modular analytics platform for defining, running, and reviewing data analyses in a controlled research environment.

## Highlights
- 🔐 JWT authentication
- 🧪 Analysis execution with workflow scripts
- 🗂 Script file manager with Monaco editor
- 🧮 Built‑in SQL editor with autocomplete and datasource selection
- 📦 Results browser with public download links

## Project structure
- [backend](backend) — API, execution, results
- [frontend](frontend) — UI

## Quick start

### Backend
```bash
cd backend
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Notes
- SQL datasources live in backend/datasources.
- SQLite files and *.sqlserver.json/*.mysql.json are supported.

## License
ISC
