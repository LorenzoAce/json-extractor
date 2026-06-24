import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  ArcElement,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js'
import {
  ArrowDownUp,
  BarChart3,
  CircleAlert,
  Database,
  Download,
  FileJson2,
  Filter,
  FolderOpen,
  LoaderCircle,
  PencilLine,
  PieChart,
  Save,
  Search,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table'
import {
  createSavedAnalysis,
  deleteSavedAnalysis,
  fetchSavedAnalyses,
  fetchSavedAnalysis,
  updateSavedAnalysis,
  type ArchiveSummary,
  type SavedAnalysisListItem,
} from './lib/archive-api'
import { cn } from './lib/utils'

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  Legend,
  LinearScale,
  Tooltip,
)

const TYPE_LABELS = [
  'Carta di credito',
  'Voucher',
  'Scratch',
  'PVR Contanti',
  'Postepay',
  'Altro',
] as const

type OperationType = (typeof TYPE_LABELS)[number]

type ParsedOperation = {
  requestDate: string
  amount: number
  description: string
  id: string
  status: string
  type: OperationType
  timestamp: number
  dayLabel: string
}

type FieldKind = 'date' | 'amount' | 'description' | 'id' | 'status'
type InferredFieldMap = Partial<Record<FieldKind, string>>
type AnalysisSummary = ArchiveSummary

const TYPE_RULES: Array<{ match: string; type: OperationType }> = [
  { match: 'carta di credito', type: 'Carta di credito' },
  { match: 'carta', type: 'Carta di credito' },
  { match: 'nuvei', type: 'Carta di credito' },
  { match: 'voucher', type: 'Voucher' },
  { match: 'scratch', type: 'Scratch' },
  { match: 'pvr contanti', type: 'PVR Contanti' },
  { match: 'postepay', type: 'Postepay' },
]

const currencyFormatter = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
})

const dateTimeFormatter = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const dateFormatter = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const euroExcelFormat = '#,##0.00 [$EUR]'

function cnButton(...classes: Parameters<typeof cn>) {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50',
    ...classes,
  )
}

function normalizeText(value: string) {
  return value.trim().toLowerCase()
}

function pickFirstValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (key in record && record[key] !== undefined && record[key] !== null) {
      return record[key]
    }
  }

  return undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function flattenRecord(
  value: Record<string, unknown>,
  prefix = '',
  depth = 0,
  maxDepth = 2,
  entries: Record<string, unknown> = {},
) {
  for (const [key, nestedValue] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    entries[path] = nestedValue

    if (depth < maxDepth && isPlainObject(nestedValue)) {
      flattenRecord(nestedValue, path, depth + 1, maxDepth, entries)
    }
  }

  return entries
}

function classifyDescription(description: string): OperationType {
  const normalized = normalizeText(description)
  const matchedRule = TYPE_RULES.find((rule) => normalized.includes(rule.match))
  return matchedRule?.type ?? 'Altro'
}

function parseAmount(value: unknown, divideByHundred = false) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return 0
    }

    return divideByHundred ? value / 100 : value
  }

  if (typeof value !== 'string') {
    return 0
  }

  let normalized = value.trim().replace(/[^\d,.-]/g, '')

  if (normalized.includes(',') && normalized.includes('.')) {
    normalized =
      normalized.lastIndexOf(',') > normalized.lastIndexOf('.')
        ? normalized.replaceAll('.', '').replace(',', '.')
        : normalized.replaceAll(',', '')
  } else if (normalized.includes(',')) {
    normalized = normalized.replaceAll('.', '').replace(',', '.')
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) {
    return 0
  }

  return divideByHundred ? parsed / 100 : parsed
}

function parseTimestamp(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value !== 'string' || !value.trim()) {
    return 0
  }

  const trimmedValue = value.trim()
  const compactDateMatch =
    /^(\d{4})(\d{2})(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(
      trimmedValue,
    )

  if (compactDateMatch) {
    const [, year, month, day, hour, minute, second, millisecond = '0'] =
      compactDateMatch
    const parsedDate = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number(millisecond.padEnd(3, '0')),
    )

    return Number.isNaN(parsedDate.getTime()) ? 0 : parsedDate.getTime()
  }

  const normalizedValue = trimmedValue.replace(' ', 'T')
  const parsed = new Date(normalizedValue)
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime()
}

function safeString(value: unknown) {
  return value == null ? '' : String(value)
}

function shouldDivideAmountByHundred(record: Record<string, unknown>, amountKey?: string) {
  if (amountKey === 'amount') {
    return false
  }

  return ['saldo', 'disponibile', 'fido', 'fidoProvvisorio', 'idValuta'].some(
    (key) => key in record,
  )
}

function computeFieldScore(field: FieldKind, path: string, value: unknown) {
  const normalizedPath = normalizeText(path)
  let score = 0

  const exactMatches: Record<FieldKind, string[]> = {
    date: ['requestdate', 'data', 'date', 'createdat', 'timestamp', 'operationdate'],
    amount: ['amount', 'importo', 'valore', 'totale', 'total'],
    description: ['description', 'descrizione', 'causale', 'nota', 'tipopagamento'],
    id: ['id', 'idtransazione', 'transactionid', 'seriale', 'numeroconto', 'reference'],
    status: ['status', 'stato', 'statoprelievo', 'state', 'result'],
  }

  const positivePatterns: Record<FieldKind, RegExp> = {
    date: /(request.?date|created.?at|operation.?date|timestamp|data|date|time)/i,
    amount: /(amount|importo|totale|total|sum|valore|price|gross|net)/i,
    description: /(description|descrizione|causal|causale|details?|reason|nota|note|payment.?type|tipo.?pagamento)/i,
    id: /(transaction.?id|id.?trans|serial|numero.?conto|reference|account|conto|ref\b|code\b|(^|\.)(id)$)/i,
    status: /(status|stato|state|result|outcome|esito)/i,
  }

  const negativePatterns: Partial<Record<FieldKind, RegExp>> = {
    amount: /(saldo|balance|disponibile|available|fido|limit|idvaluta|idcausale|idtipo|moltcassa)/i,
    id: /(idvaluta|idstato|idtipo|idcausale|idcontopvr|moltcassa)/i,
    description: /(timestamp|date|data|saldo|amount|importo)/i,
    status: /(idtransazione|seriale|numeroconto)/i,
  }

  const compactPath = normalizedPath.replaceAll('.', '')

  if (exactMatches[field].includes(compactPath)) {
    score += 12
  }

  if (positivePatterns[field].test(normalizedPath)) {
    score += 6
  }

  if (negativePatterns[field]?.test(normalizedPath)) {
    score -= 8
  }

  if (field === 'date' && parseTimestamp(value) > 0) {
    score += 6
  }

  if (field === 'amount' && parseAmount(value) !== 0) {
    score += 5
  }

  if (field === 'description' && typeof value === 'string' && /[a-z]/i.test(value)) {
    score += value.trim().length > 8 ? 5 : 2
  }

  if (
    field === 'id' &&
    (typeof value === 'string' || typeof value === 'number') &&
    safeString(value).trim().length >= 4
  ) {
    score += 4
  }

  if (
    field === 'status' &&
    (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
  ) {
    score += 3
  }

  return score
}

function inferFieldMap(records: Record<string, unknown>[]) {
  const scoreMaps: Record<FieldKind, Map<string, number>> = {
    date: new Map(),
    amount: new Map(),
    description: new Map(),
    id: new Map(),
    status: new Map(),
  }

  for (const record of records.slice(0, 30)) {
    const flatRecord = flattenRecord(record)

    for (const [path, value] of Object.entries(flatRecord)) {
      for (const field of Object.keys(scoreMaps) as FieldKind[]) {
        const score = computeFieldScore(field, path, value)

        if (score > 0) {
          scoreMaps[field].set(path, (scoreMaps[field].get(path) ?? 0) + score)
        }
      }
    }
  }

  const inferredMap: InferredFieldMap = {}

  for (const field of Object.keys(scoreMaps) as FieldKind[]) {
    const bestMatch = [...scoreMaps[field].entries()].sort((first, second) => second[1] - first[1])[0]

    if (bestMatch && bestMatch[1] >= 12) {
      inferredMap[field] = bestMatch[0]
    }
  }

  return inferredMap
}

function resolveFromRecord(
  flatRecord: Record<string, unknown>,
  mappedPath: string | undefined,
  fallbackKeys: string[],
) {
  if (mappedPath && flatRecord[mappedPath] !== undefined && flatRecord[mappedPath] !== null) {
    return flatRecord[mappedPath]
  }

  return pickFirstValue(flatRecord, fallbackKeys)
}

function resolveOperationDescription(
  flatRecord: Record<string, unknown>,
  inferredMap: InferredFieldMap,
) {
  return safeString(
    resolveFromRecord(flatRecord, inferredMap.description, [
      'description',
      'descrizione',
      'causale',
      'nota',
      'tipoPagamento',
      'payment.description',
      'details.description',
    ]),
  )
}

function resolveOperationAmount(
  flatRecord: Record<string, unknown>,
  inferredMap: InferredFieldMap,
) {
  const fallbackKeys = ['amount', 'importo', 'valore', 'totale', 'payment.amount']
  const amountKey =
    inferredMap.amount && flatRecord[inferredMap.amount] !== undefined
      ? inferredMap.amount
      : fallbackKeys.find((key) => key in flatRecord)
  const amountValue = amountKey ? flatRecord[amountKey] : undefined

  return parseAmount(amountValue, shouldDivideAmountByHundred(flatRecord, amountKey))
}

function resolveOperationDate(flatRecord: Record<string, unknown>, inferredMap: InferredFieldMap) {
  return safeString(
    resolveFromRecord(flatRecord, inferredMap.date, [
      'requestDate',
      'data',
      'date',
      'createdAt',
      'timestamp',
      'operationDate',
      'payment.date',
    ]),
  )
}

function resolveOperationId(flatRecord: Record<string, unknown>, inferredMap: InferredFieldMap) {
  return safeString(
    resolveFromRecord(flatRecord, inferredMap.id, [
      'id',
      'idTransazione',
      'transactionId',
      'numeroConto',
      'seriale',
      'reference',
      'payment.id',
    ]),
  )
}

function resolveOperationStatus(
  flatRecord: Record<string, unknown>,
  inferredMap: InferredFieldMap,
) {
  const rawStatus = resolveFromRecord(flatRecord, inferredMap.status, [
    'status',
    'stato',
    'statoPrelievo',
    'idStatoPrelievo',
    'result',
  ])

  if (rawStatus === undefined || rawStatus === null || rawStatus === '') {
    return 'N/D'
  }

  return safeString(rawStatus)
}

function formatDateTime(timestamp: number) {
  return timestamp > 0 ? dateTimeFormatter.format(timestamp) : '-'
}

function formatCurrency(amount: number) {
  return currencyFormatter.format(amount)
}

function parseJsonRecursively(value: unknown, maxDepth = 3): unknown {
  let currentValue = value

  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (typeof currentValue !== 'string') {
      return currentValue
    }

    const trimmedValue = currentValue.trim()

    if (!trimmedValue) {
      return trimmedValue
    }

    currentValue = JSON.parse(trimmedValue)
  }

  return currentValue
}

function extractOperationsArray(input: string) {
  const parsedRoot = parseJsonRecursively(input)

  if (Array.isArray(parsedRoot)) {
    return parsedRoot
  }

  if (!parsedRoot || typeof parsedRoot !== 'object') {
    throw new Error('Invalid root payload')
  }

  const record = parsedRoot as Record<string, unknown>
  const candidates = [
    record.data,
    record.Data,
    record.items,
    record.results,
    record.operations,
    record.movements,
  ]

  for (const candidate of candidates) {
    const parsedCandidate = parseJsonRecursively(candidate)

    if (Array.isArray(parsedCandidate)) {
      return parsedCandidate
    }
  }

  throw new Error('No operations array found')
}

type ExcelModule = typeof import('xlsx-js-style')

function buildExcelSheetStyles(
  xlsx: ExcelModule,
  sheet: Record<string, { z?: string; s?: unknown }>,
  rowCount: number,
  columnCount: number,
  amountColumns: number[] = [],
) {
  const headerStyle = {
    fill: { fgColor: { rgb: '1D4ED8' } },
    font: { color: { rgb: 'FFFFFF' }, bold: true },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: {
      top: { style: 'thin', color: { rgb: 'BFDBFE' } },
      bottom: { style: 'thin', color: { rgb: 'BFDBFE' } },
      left: { style: 'thin', color: { rgb: 'BFDBFE' } },
      right: { style: 'thin', color: { rgb: 'BFDBFE' } },
    },
  }

  const baseBorder = {
    top: { style: 'thin', color: { rgb: 'E2E8F0' } },
    bottom: { style: 'thin', color: { rgb: 'E2E8F0' } },
    left: { style: 'thin', color: { rgb: 'E2E8F0' } },
    right: { style: 'thin', color: { rgb: 'E2E8F0' } },
  }

  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    const address = xlsx.utils.encode_cell({ r: 0, c: columnIndex })
    const cell = sheet[address]

    if (cell) {
      cell.s = headerStyle
    }
  }

  for (let rowIndex = 1; rowIndex < rowCount; rowIndex += 1) {
    const fillColor = rowIndex % 2 === 0 ? 'F8FAFC' : 'FFFFFF'

    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const address = xlsx.utils.encode_cell({ r: rowIndex, c: columnIndex })
      const cell = sheet[address]

      if (!cell) {
        continue
      }

      cell.s = {
        fill: { fgColor: { rgb: fillColor } },
        alignment: {
          horizontal: amountColumns.includes(columnIndex) ? 'right' : 'left',
          vertical: 'center',
        },
        border: baseBorder,
      }

      if (amountColumns.includes(columnIndex)) {
        cell.z = euroExcelFormat
      }
    }
  }
}

function createEmptySummary(): AnalysisSummary {
  return {
    totalOperations: 0,
    totalAmount: 0,
    totalsByType: TYPE_LABELS.reduce<Record<string, number>>((accumulator, type) => {
      accumulator[type] = 0
      return accumulator
    }, {}),
  }
}

function buildSummaryFromOperations(operations: ParsedOperation[]): AnalysisSummary {
  const summary = createEmptySummary()
  summary.totalOperations = operations.length

  for (const operation of operations) {
    summary.totalAmount += operation.amount
    summary.totalsByType[operation.type] =
      (summary.totalsByType[operation.type] ?? 0) + operation.amount
  }

  return summary
}

function analyzeJsonInput(input: string) {
  if (!input.trim()) {
    throw new Error('Incolla un JSON prima di avviare l’analisi.')
  }

  const rawOperations = extractOperationsArray(input).filter((item) =>
    isPlainObject(item),
  ) as Record<string, unknown>[]

  const inferredMap = inferFieldMap(rawOperations)

  const parsedOperations = rawOperations
    .map((item) => {
      const flatRecord = flattenRecord(item)
      const description = resolveOperationDescription(flatRecord, inferredMap)
      const requestDate = resolveOperationDate(flatRecord, inferredMap)
      const timestamp = parseTimestamp(requestDate)

      return {
        requestDate,
        amount: resolveOperationAmount(flatRecord, inferredMap),
        description,
        id: resolveOperationId(flatRecord, inferredMap),
        status: resolveOperationStatus(flatRecord, inferredMap),
        type: classifyDescription(description),
        timestamp,
        dayLabel: timestamp > 0 ? dateFormatter.format(timestamp) : 'Senza data',
      } satisfies ParsedOperation
    })
    .sort((first, second) => second.timestamp - first.timestamp)

  if (parsedOperations.length === 0) {
    throw new Error('Nessuna operazione trovata.')
  }

  return parsedOperations
}

function App() {
  const [jsonInput, setJsonInput] = useState('')
  const [operations, setOperations] = useState<ParsedOperation[]>([])
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [archiveError, setArchiveError] = useState('')
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [analysisName, setAnalysisName] = useState('')
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysisListItem[]>([])
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(null)
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [archiveSaving, setArchiveSaving] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState<'Tutti' | OperationType>('Tutti')
  const resultsRef = useRef<HTMLDivElement | null>(null)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'requestDate', desc: true },
  ])
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })

  const filteredOperations = useMemo(() => {
    const normalizedSearch = normalizeText(searchTerm)

    return operations.filter((operation) => {
      const matchesType = typeFilter === 'Tutti' || operation.type === typeFilter
      const searchableContent = normalizeText(
        [
          operation.description,
          operation.type,
          operation.id,
          operation.status,
          operation.requestDate,
        ].join(' '),
      )

      const matchesSearch =
        normalizedSearch.length === 0 ||
        searchableContent.includes(normalizedSearch) ||
        formatCurrency(operation.amount).toLowerCase().includes(normalizedSearch)

      return matchesType && matchesSearch
    })
  }, [operations, searchTerm, typeFilter])

  const summary = useMemo(() => buildSummaryFromOperations(operations), [operations])

  const pieChartData = useMemo(() => {
    const labels = TYPE_LABELS.filter((type) => summary.totalsByType[type] > 0)
    const values = labels.map((label) => summary.totalsByType[label])

    return {
      labels: labels.length > 0 ? labels : ['Nessun dato'],
      datasets: [
        {
          label: 'Importo per tipologia',
          data: values.length > 0 ? values : [1],
          backgroundColor:
            values.length > 0
              ? ['#2563EB', '#14B8A6', '#F59E0B', '#8B5CF6', '#EC4899', '#64748B']
              : ['#CBD5E1'],
          borderColor: '#FFFFFF',
          borderWidth: 2,
        },
      ],
    }
  }, [summary.totalsByType])

  const barChartData = useMemo(() => {
    const groupedByDay = operations.reduce<Record<string, number>>((accumulator, operation) => {
      accumulator[operation.dayLabel] = (accumulator[operation.dayLabel] ?? 0) + operation.amount
      return accumulator
    }, {})

    const labels = Object.keys(groupedByDay).sort((first, second) => {
      const [dayA, monthA, yearA] = first.split('/')
      const [dayB, monthB, yearB] = second.split('/')
      const timestampA = new Date(`${yearA}-${monthA}-${dayA}`).getTime()
      const timestampB = new Date(`${yearB}-${monthB}-${dayB}`).getTime()
      return timestampA - timestampB
    })

    return {
      labels: labels.length > 0 ? labels : ['Nessun dato'],
      datasets: [
        {
          label: 'Importi per giorno',
          data: labels.length > 0 ? labels.map((label) => groupedByDay[label]) : [0],
          backgroundColor: '#2563EB',
          borderRadius: 8,
        },
      ],
    }
  }, [operations])

  const columns = useMemo<ColumnDef<ParsedOperation>[]>(
    () => [
      {
        accessorKey: 'requestDate',
        header: ({ column }) => (
          <button
            type="button"
            className="flex items-center gap-2 font-semibold text-slate-700"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Data e Ora
            <ArrowDownUp className="h-4 w-4" />
          </button>
        ),
        cell: ({ row }) => (
          <span className="font-medium text-slate-800">
            {formatDateTime(row.original.timestamp)}
          </span>
        ),
        sortingFn: (rowA, rowB) => rowA.original.timestamp - rowB.original.timestamp,
      },
      {
        accessorKey: 'type',
        header: ({ column }) => (
          <button
            type="button"
            className="flex items-center gap-2 font-semibold text-slate-700"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Tipo
            <ArrowDownUp className="h-4 w-4" />
          </button>
        ),
        cell: ({ row }) => (
          <span className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
            {row.original.type}
          </span>
        ),
      },
      {
        accessorKey: 'amount',
        header: ({ column }) => (
          <button
            type="button"
            className="flex items-center gap-2 font-semibold text-slate-700"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Importo (EUR)
            <ArrowDownUp className="h-4 w-4" />
          </button>
        ),
        cell: ({ row }) => (
          <span className="font-semibold text-emerald-700">
            {formatCurrency(row.original.amount)}
          </span>
        ),
      },
      {
        accessorKey: 'id',
        header: ({ column }) => (
          <button
            type="button"
            className="flex items-center gap-2 font-semibold text-slate-700"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            ID Transazione
            <ArrowDownUp className="h-4 w-4" />
          </button>
        ),
        cell: ({ row }) => (
          <span className="font-mono text-xs text-slate-600">{row.original.id || '-'}</span>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => (
          <button
            type="button"
            className="flex items-center gap-2 font-semibold text-slate-700"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Stato
            <ArrowDownUp className="h-4 w-4" />
          </button>
        ),
        cell: ({ row }) => (
          <span className="font-medium text-slate-700">{row.original.status || '-'}</span>
        ),
      },
    ],
    [],
  )

  const table = useReactTable({
    data: filteredOperations,
    columns,
    state: {
      sorting,
      pagination,
    },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  function applyAnalysisResult(parsedOperations: ParsedOperation[], rawInput: string, message: string) {
    setJsonInput(rawInput)
    setOperations(parsedOperations)
    setErrorMessage('')
    setSuccessMessage(message)
    setArchiveError('')
    setPagination((current) => ({ ...current, pageIndex: 0 }))

    requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  async function refreshSavedArchive() {
    setArchiveLoading(true)
    setArchiveError('')

    try {
      const items = await fetchSavedAnalyses()
      setSavedAnalyses(items)
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : 'Errore caricamento archivio.')
    } finally {
      setArchiveLoading(false)
    }
  }

  useEffect(() => {
    void refreshSavedArchive()
  }, [])

  function handleAnalyze() {
    try {
      const parsedOperations = analyzeJsonInput(jsonInput)
      applyAnalysisResult(
        parsedOperations,
        jsonInput,
        `Analisi completata: ${parsedOperations.length} operazioni trovate.`,
      )
    } catch (error) {
      setOperations([])
      setSuccessMessage('')
      setErrorMessage(
        error instanceof Error ? error.message : 'JSON non valido. Verifica i dati inseriti.',
      )
    }
  }

  async function handleCreateAnalysis() {
    setArchiveSaving(true)
    setArchiveError('')

    try {
      const parsedOperations =
        operations.length > 0 && jsonInput.trim() ? operations : analyzeJsonInput(jsonInput)
      const nextName = analysisName.trim() || `Analisi ${new Date().toLocaleString('it-IT')}`

      const response = await createSavedAnalysis({
        name: nextName,
        rawJson: jsonInput,
        operations: parsedOperations,
        summary: buildSummaryFromOperations(parsedOperations),
      })

      setSelectedAnalysisId(response.id)
      setAnalysisName(nextName)
      setSuccessMessage(`Analisi salvata in archivio come "${nextName}".`)
      await refreshSavedArchive()
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : 'Errore salvataggio archivio.')
    } finally {
      setArchiveSaving(false)
    }
  }

  async function handleUpdateAnalysis() {
    if (!selectedAnalysisId) {
      setArchiveError('Seleziona prima un elemento dell’archivio da aggiornare.')
      return
    }

    setArchiveSaving(true)
    setArchiveError('')

    try {
      const parsedOperations =
        operations.length > 0 && jsonInput.trim() ? operations : analyzeJsonInput(jsonInput)
      const nextName = analysisName.trim() || `Analisi ${new Date().toLocaleString('it-IT')}`

      await updateSavedAnalysis(selectedAnalysisId, {
        name: nextName,
        rawJson: jsonInput,
        operations: parsedOperations,
        summary: buildSummaryFromOperations(parsedOperations),
      })

      setSuccessMessage(`Analisi aggiornata in archivio: "${nextName}".`)
      await refreshSavedArchive()
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : 'Errore aggiornamento archivio.')
    } finally {
      setArchiveSaving(false)
    }
  }

  async function handleLoadAnalysis(id: string) {
    setArchiveLoading(true)
    setArchiveError('')

    try {
      const item = await fetchSavedAnalysis(id)
      const parsedOperations = analyzeJsonInput(item.rawJson)
      setSelectedAnalysisId(item.id)
      setAnalysisName(item.name)
      applyAnalysisResult(
        parsedOperations,
        item.rawJson,
        `Analisi caricata da archivio: "${item.name}".`,
      )
      setArchiveOpen(false)
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : 'Errore caricamento analisi.')
    } finally {
      setArchiveLoading(false)
    }
  }

  async function handleRenameAnalysis(id: string, currentName: string) {
    const newName = window.prompt('Nuovo nome analisi', currentName)?.trim()

    if (!newName || newName === currentName) {
      return
    }

    setArchiveSaving(true)
    setArchiveError('')

    try {
      await updateSavedAnalysis(id, { name: newName })

      if (selectedAnalysisId === id) {
        setAnalysisName(newName)
      }

      setSuccessMessage(`Analisi rinominata in "${newName}".`)
      await refreshSavedArchive()
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : 'Errore rinomina analisi.')
    } finally {
      setArchiveSaving(false)
    }
  }

  async function handleDeleteAnalysis(id: string, name: string) {
    if (!window.confirm(`Eliminare l'analisi "${name}"?`)) {
      return
    }

    setArchiveSaving(true)
    setArchiveError('')

    try {
      await deleteSavedAnalysis(id)

      if (selectedAnalysisId === id) {
        setSelectedAnalysisId(null)
      }

      setSuccessMessage(`Analisi eliminata: "${name}".`)
      await refreshSavedArchive()
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : 'Errore eliminazione analisi.')
    } finally {
      setArchiveSaving(false)
    }
  }

  async function handleExportExcel() {
    if (operations.length === 0) {
      return
    }

    const XLSX = await import('xlsx-js-style')
    const workbook = XLSX.utils.book_new()

    const operationsSheetData = [
      ['Data e Ora', 'Tipo', 'Importo (EUR)', 'ID', 'Stato'],
      ...operations.map((operation) => [
        formatDateTime(operation.timestamp),
        operation.type,
        operation.amount,
        operation.id,
        operation.status,
      ]),
    ]

    const operationsSheet = XLSX.utils.aoa_to_sheet(operationsSheetData)
    operationsSheet['!autofilter'] = { ref: `A1:E${operationsSheetData.length}` }
    operationsSheet['!cols'] = [
      { wch: 22 },
      { wch: 20 },
      { wch: 14 },
      { wch: 24 },
      { wch: 18 },
    ]
    buildExcelSheetStyles(
      XLSX,
      operationsSheet as Record<string, { z?: string; s?: unknown }>,
      operationsSheetData.length,
      5,
      [2],
    )

    const summarySheetData = [
      ['Voce', 'Valore'],
      ['Numero operazioni', summary.totalOperations],
      ['Totale movimentato', summary.totalAmount],
      ['Totale Carta', summary.totalsByType['Carta di credito']],
      ['Totale Voucher', summary.totalsByType.Voucher],
      ['Totale Scratch', summary.totalsByType.Scratch],
      ['Totale PVR', summary.totalsByType['PVR Contanti']],
      ['Totale Postepay', summary.totalsByType.Postepay],
    ]

    const summarySheet = XLSX.utils.aoa_to_sheet(summarySheetData)
    summarySheet['!cols'] = [{ wch: 24 }, { wch: 18 }]
    buildExcelSheetStyles(
      XLSX,
      summarySheet as Record<string, { z?: string; s?: unknown }>,
      summarySheetData.length,
      2,
      [1],
    )

    XLSX.utils.book_append_sheet(workbook, operationsSheet, 'Operazioni')
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Riepilogo')

    const today = new Date()
    const dateLabel = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('_')

    XLSX.writeFile(workbook, `Report_Ricariche_${dateLabel}.xlsx`)
  }

  return (
    <main className="min-h-screen bg-transparent px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="rounded-3xl border border-white/70 bg-white/85 p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.35)] backdrop-blur sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl space-y-4">
              <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">
                <FileJson2 className="h-4 w-4" />
                Estrattore Dati JSON
              </span>
              <div className="space-y-3">
                <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
                  Analizza JSON, ottieni tabella, statistiche e file Excel.
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
                  Incolla la risposta API, avvia l&apos;analisi e visualizza subito
                  operazioni, totali automatici, grafici e download professionale del
                  report.
                </p>
              </div>
            </div>

            <div className="flex w-full flex-col gap-3 lg:w-auto">
              <button
                type="button"
                onClick={() => setArchiveOpen(true)}
                className={cnButton('bg-slate-900 px-5 text-white hover:bg-slate-800')}
              >
                <Database className="h-4 w-4" />
                APRI ARCHIVIO JSON
              </button>
              <div className="grid gap-3 sm:grid-cols-3">
                <FeaturePill icon={Wallet} title="Totali" subtitle="Riepilogo automatico" />
                <FeaturePill icon={PieChart} title="Grafici" subtitle="Distribuzione e trend" />
                <FeaturePill icon={Download} title="Excel" subtitle="Export formattato" />
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <SurfaceCard>
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
                <FileJson2 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Inserimento dati</h2>
                <p className="text-sm text-slate-500">
                  Incolla la stringa JSON restituita dalle API.
                </p>
              </div>
            </div>

            <textarea
              value={jsonInput}
              onChange={(event) => setJsonInput(event.target.value)}
              placeholder="Incolla qui la stringa JSON restituita dalle API..."
              className="min-h-[280px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />

            <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
              <input
                value={analysisName}
                onChange={(event) => setAnalysisName(event.target.value)}
                placeholder="Nome analisi da salvare"
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
              />
              <button
                type="button"
                onClick={() => void handleCreateAnalysis()}
                disabled={archiveSaving || !jsonInput.trim()}
                className={cnButton('bg-white text-slate-700')}
              >
                {archiveSaving ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                SALVA SU NEON
              </button>
              <button
                type="button"
                onClick={() => setArchiveOpen(true)}
                className={cnButton('bg-white text-slate-700')}
              >
                <FolderOpen className="h-4 w-4" />
                GESTISCI ARCHIVIO
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={handleAnalyze}
                className={cnButton(
                  'border-blue-600 bg-blue-600 px-5 text-white hover:border-blue-700 hover:bg-blue-700',
                )}
              >
                <BarChart3 className="h-4 w-4" />
                ANALIZZA DATI
              </button>
              <button
                type="button"
                onClick={() => void handleExportExcel()}
                disabled={operations.length === 0}
                className={cnButton('bg-white text-slate-700')}
              >
                <Download className="h-4 w-4" />
                SCARICA EXCEL
              </button>
            </div>

            {errorMessage ? (
              <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            ) : successMessage ? (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                {successMessage}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                Parsing automatico del campo <strong>data</strong>, classificazione per
                tipologia e ordinamento iniziale per data decrescente.
              </div>
            )}

            {archiveError ? (
              <div className="mt-4 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{archiveError}</span>
              </div>
            ) : null}
          </SurfaceCard>

          <SurfaceCard>
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                <Filter className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Guida rapida</h2>
                <p className="text-sm text-slate-500">
                  Formato atteso del payload e campi estratti.
                </p>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Formato input
                </p>
                <pre className="overflow-x-auto text-xs leading-6 text-slate-700">
{`{
  "descrizione": "",
  "data": "[{...}]",
  "codiceEsito": 0
}`}
                </pre>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <InfoTile title="Campi estratti" value="requestDate, amount, description, id, status" />
                <InfoTile title="Classificazione" value="Carta, Voucher, Scratch, PVR, Postepay, Altro" />
                <InfoTile title="Tabella" value="Ricerca, ordinamento, paginazione, filtro per tipo" />
                <InfoTile title="Export" value="Operazioni + Riepilogo in Excel formattato" />
              </div>
            </div>
          </SurfaceCard>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Totale Operazioni"
            value={String(summary.totalOperations)}
            subtitle="Numero totale movimenti"
          />
          <MetricCard
            title="Totale Movimentato"
            value={formatCurrency(summary.totalAmount)}
            subtitle="Somma di tutti gli importi"
          />
          <MetricCard
            title="Filtro Attivo"
            value={typeFilter}
            subtitle="Tipologia selezionata"
          />
          <MetricCard
            title="Risultati Visibili"
            value={String(filteredOperations.length)}
            subtitle="Dopo ricerca e filtro"
          />
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          {TYPE_LABELS.map((type) => (
            <MetricCard
              key={type}
              title={type}
              value={formatCurrency(summary.totalsByType[type])}
              subtitle="Totale per tipologia"
              compact
            />
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <SurfaceCard>
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Ripartizione per tipologia
                </h2>
                <p className="text-sm text-slate-500">
                  Grafico a torta basato sugli importi aggregati.
                </p>
              </div>
              <PieChart className="h-5 w-5 text-slate-400" />
            </div>

            <div className="mx-auto max-w-md">
              <Doughnut
                data={pieChartData}
                options={{
                  plugins: {
                    legend: { position: 'bottom' },
                    tooltip: {
                      callbacks: {
                        label: (context) =>
                          `${context.label}: ${formatCurrency(Number(context.parsed))}`,
                      },
                    },
                  },
                }}
              />
            </div>
          </SurfaceCard>

          <SurfaceCard>
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Importi per giorno</h2>
                <p className="text-sm text-slate-500">
                  Grafico a barre ordinato per data.
                </p>
              </div>
              <BarChart3 className="h-5 w-5 text-slate-400" />
            </div>

            <Bar
              data={barChartData}
              options={{
                responsive: true,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      label: (context) => formatCurrency(Number(context.parsed.y)),
                    },
                  },
                },
                scales: {
                  y: {
                    ticks: {
                      callback: (value) => formatCurrency(Number(value)),
                    },
                  },
                },
              }}
            />
          </SurfaceCard>
        </section>

        <SurfaceCard className="scroll-mt-6" >
          <div ref={resultsRef} />
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Tabella operazioni</h2>
              <p className="text-sm text-slate-500">
                Ordinamento colonne, ricerca istantanea, filtro tipologia e paginazione.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="relative sm:col-span-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Cerca per ID, tipo, stato..."
                  className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                />
              </label>

              <select
                value={typeFilter}
                onChange={(event) =>
                  setTypeFilter(event.target.value as 'Tutti' | OperationType)
                }
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
              >
                <option value="Tutti">Tutte le tipologie</option>
                {TYPE_LABELS.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 bg-white">
                <thead className="bg-slate-50">
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <th key={header.id} className="px-4 py-3 text-left text-sm">
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {table.getRowModel().rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={columns.length}
                        className="px-4 py-10 text-center text-sm text-slate-500"
                      >
                        Nessuna operazione trovata.
                      </td>
                    </tr>
                  ) : (
                    table.getRowModel().rows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id} className="px-4 py-3 text-sm text-slate-700">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-500">
              Pagina {table.getState().pagination.pageIndex + 1} di {table.getPageCount() || 1}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={table.getState().pagination.pageSize}
                onChange={(event) => table.setPageSize(Number(event.target.value))}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                {[10, 25, 50].map((size) => (
                  <option key={size} value={size}>
                    {size} righe
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                className={cnButton('px-3 py-2 text-slate-700')}
              >
                Precedente
              </button>
              <button
                type="button"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                className={cnButton('px-3 py-2 text-slate-700')}
              >
                Successiva
              </button>
            </div>
          </div>
        </SurfaceCard>
      </div>

      {archiveOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Chiudi archivio"
            className="flex-1 cursor-default"
            onClick={() => setArchiveOpen(false)}
          />
          <aside className="flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Archivio JSON</h2>
                <p className="text-sm text-slate-500">
                  Salva, carica, rinomina e cancella le analisi archiviate su Neon.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setArchiveOpen(false)}
                className={cnButton('px-3 py-2 text-slate-700')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="border-b border-slate-200 px-5 py-4">
              <div className="grid gap-3">
                <input
                  value={analysisName}
                  onChange={(event) => setAnalysisName(event.target.value)}
                  placeholder="Nome analisi"
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => void handleCreateAnalysis()}
                    disabled={archiveSaving || !jsonInput.trim()}
                    className={cnButton('bg-slate-900 text-white hover:bg-slate-800')}
                  >
                    {archiveSaving ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Salva nuova
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleUpdateAnalysis()}
                    disabled={archiveSaving || !selectedAnalysisId || !jsonInput.trim()}
                    className={cnButton('bg-white text-slate-700')}
                  >
                    <PencilLine className="h-4 w-4" />
                    Aggiorna selezionata
                  </button>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                <span>{savedAnalyses.length} analisi salvate</span>
                <button
                  type="button"
                  onClick={() => void refreshSavedArchive()}
                  className="font-semibold text-blue-700"
                >
                  Aggiorna elenco
                </button>
              </div>

              {archiveError ? (
                <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  {archiveError}
                </div>
              ) : null}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {archiveLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Caricamento archivio...
                </div>
              ) : savedAnalyses.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  Nessuna analisi salvata nel database.
                </div>
              ) : (
                <div className="space-y-3">
                  {savedAnalyses.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        'rounded-2xl border px-4 py-4 transition',
                        selectedAnalysisId === item.id
                          ? 'border-blue-300 bg-blue-50/70'
                          : 'border-slate-200 bg-white',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {item.name}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {item.operationCount} operazioni · {formatCurrency(item.totalAmount)}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            Aggiornata il {new Date(item.updatedAt).toLocaleString('it-IT')}
                          </p>
                        </div>
                        {selectedAnalysisId === item.id ? (
                          <span className="rounded-full bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white">
                            Selezionata
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleLoadAnalysis(item.id)}
                          className={cnButton('px-3 py-2 text-slate-700')}
                        >
                          <FolderOpen className="h-4 w-4" />
                          Carica
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRenameAnalysis(item.id, item.name)}
                          className={cnButton('px-3 py-2 text-slate-700')}
                        >
                          <PencilLine className="h-4 w-4" />
                          Rinomina
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteAnalysis(item.id, item.name)}
                          className={cnButton('border-rose-200 bg-rose-50 px-3 py-2 text-rose-700 hover:border-rose-300 hover:bg-rose-100')}
                        >
                          <Trash2 className="h-4 w-4" />
                          Elimina
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </main>
  )
}

type FeaturePillProps = {
  icon: typeof Wallet
  title: string
  subtitle: string
}

function FeaturePill({ icon: Icon, title, subtitle }: FeaturePillProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="mb-2 inline-flex rounded-xl bg-white p-2 text-slate-700 shadow-sm">
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="text-xs text-slate-500">{subtitle}</p>
    </div>
  )
}

type SurfaceCardProps = {
  children: ReactNode
  className?: string
}

function SurfaceCard({ children, className }: SurfaceCardProps) {
  return (
    <section
      className={cn(
        'rounded-3xl border border-white/70 bg-white/90 p-6 shadow-[0_16px_50px_-30px_rgba(15,23,42,0.35)] backdrop-blur',
        className,
      )}
    >
      {children}
    </section>
  )
}

type MetricCardProps = {
  title: string
  value: string
  subtitle: string
  compact?: boolean
}

function MetricCard({ title, value, subtitle, compact = false }: MetricCardProps) {
  return (
    <div
      className={cn(
        'rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.5)]',
        compact && 'p-4',
      )}
    >
      <p className="text-sm font-medium text-slate-500">{title}</p>
      <p className={cn('mt-3 text-2xl font-bold text-slate-950', compact && 'text-xl')}>
        {value}
      </p>
      <p className="mt-2 text-xs text-slate-500">{subtitle}</p>
    </div>
  )
}

type InfoTileProps = {
  title: string
  value: string
}

function InfoTile({ title, value }: InfoTileProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{value}</p>
    </div>
  )
}

export default App
