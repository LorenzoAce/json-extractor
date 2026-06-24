import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { neon } from '@neondatabase/serverless'

const app = express()
const port = Number(process.env.API_PORT ?? 3001)
const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL non configurata.')
}

const sql = neon(databaseUrl)

type AnalysisPayload = {
  name?: string
  rawJson?: string
  operations?: unknown
  summary?: unknown
}

app.use(cors())
app.use(express.json({ limit: '10mb' }))

async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS saved_analyses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      operations JSONB NOT NULL,
      summary JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
}

function validatePayload(payload: AnalysisPayload) {
  const name = payload.name?.trim()
  const rawJson = payload.rawJson?.trim()
  const operations = payload.operations ?? []
  const summary = payload.summary ?? {}

  if (!name) {
    throw new Error('Nome analisi obbligatorio.')
  }

  if (!rawJson) {
    throw new Error('JSON sorgente obbligatorio.')
  }

  return { name, rawJson, operations, summary }
}

app.get('/api/health', async (_request, response) => {
  await sql`SELECT 1`
  response.json({ ok: true })
})

app.get('/api/analyses', async (_request, response) => {
  const rows = await sql`
    SELECT
      id,
      name,
      COALESCE(jsonb_array_length(operations), 0) AS operation_count,
      summary->>'totalAmount' AS total_amount,
      created_at,
      updated_at
    FROM saved_analyses
    ORDER BY updated_at DESC
  `

  response.json(
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      operationCount: Number(row.operation_count ?? 0),
      totalAmount: Number(row.total_amount ?? 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  )
})

app.get('/api/analyses/:id', async (request, response) => {
  const rows = await sql`
    SELECT id, name, raw_json, operations, summary, created_at, updated_at
    FROM saved_analyses
    WHERE id = ${request.params.id}
    LIMIT 1
  `

  const row = rows[0]

  if (!row) {
    response.status(404).json({ message: 'Analisi non trovata.' })
    return
  }

  response.json({
    id: row.id,
    name: row.name,
    rawJson: row.raw_json,
    operations: row.operations,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
})

app.post('/api/analyses', async (request, response) => {
  const { name, rawJson, operations, summary } = validatePayload(request.body)
  const id = crypto.randomUUID()

  await sql`
    INSERT INTO saved_analyses (id, name, raw_json, operations, summary)
    VALUES (
      ${id},
      ${name},
      ${rawJson},
      ${JSON.stringify(operations)}::jsonb,
      ${JSON.stringify(summary)}::jsonb
    )
  `

  response.status(201).json({ id })
})

app.put('/api/analyses/:id', async (request, response) => {
  const incomingPayload = request.body as AnalysisPayload
  const existingRows = await sql`
    SELECT id, name, raw_json, operations, summary
    FROM saved_analyses
    WHERE id = ${request.params.id}
    LIMIT 1
  `
  const existing = existingRows[0]

  if (!existing) {
    response.status(404).json({ message: 'Analisi non trovata.' })
    return
  }

  const mergedPayload = validatePayload({
    name: incomingPayload.name ?? existing.name,
    rawJson: incomingPayload.rawJson ?? existing.raw_json,
    operations: incomingPayload.operations ?? existing.operations,
    summary: incomingPayload.summary ?? existing.summary,
  })

  await sql`
    UPDATE saved_analyses
    SET
      name = ${mergedPayload.name},
      raw_json = ${mergedPayload.rawJson},
      operations = ${JSON.stringify(mergedPayload.operations)}::jsonb,
      summary = ${JSON.stringify(mergedPayload.summary)}::jsonb,
      updated_at = NOW()
    WHERE id = ${request.params.id}
  `

  response.json({ ok: true })
})

app.delete('/api/analyses/:id', async (request, response) => {
  await sql`
    DELETE FROM saved_analyses
    WHERE id = ${request.params.id}
  `

  response.status(204).send()
})

async function startServer() {
  await ensureSchema()

  app.listen(port, () => {
    console.log(`API pronta su http://localhost:${port}`)
  })
}

startServer().catch((error) => {
  console.error('Errore avvio server:', error)
  process.exit(1)
})
