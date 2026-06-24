# Estrattore Dati JSON

Dashboard React + Vite per:

- analizzare JSON eterogenei
- visualizzare tabella, totali e grafici
- esportare Excel formattati
- salvare e gestire le analisi su Neon PostgreSQL

## Stack

- React + Vite + TypeScript
- Tailwind CSS
- TanStack Table
- Chart.js
- `xlsx-js-style`
- Express + Neon PostgreSQL

## Ambiente

Copia `.env.example` in `.env` e configura:

```bash
DATABASE_URL=postgresql://...
API_PORT=3001
```

## Avvio

Installa le dipendenze:

```bash
npm install
```

Avvia frontend e API insieme:

```bash
npm run dev
```

Avvia solo API:

```bash
npm run server
```

Build frontend:

```bash
npm run build
```

## Archivio JSON

Le analisi vengono salvate nella tabella `saved_analyses` su Neon con:

- nome analisi
- JSON originale
- operazioni parse
- riepilogo aggregato
- date di creazione e aggiornamento

L'interfaccia consente di:

- salvare una nuova analisi
- aggiornare una analisi esistente
- caricare una analisi salvata
- rinominare una analisi
- eliminare una analisi
