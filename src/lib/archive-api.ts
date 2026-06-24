export type ArchiveSummary = {
  totalOperations: number
  totalAmount: number
  totalsByType: Record<string, number>
}

export type SavedAnalysisListItem = {
  id: string
  name: string
  operationCount: number
  totalAmount: number
  createdAt: string
  updatedAt: string
}

export type SavedAnalysisDetail = {
  id: string
  name: string
  rawJson: string
  operations: unknown[]
  summary: ArchiveSummary
  createdAt: string
  updatedAt: string
}

type SaveAnalysisPayload = {
  name: string
  rawJson: string
  operations: unknown[]
  summary: ArchiveSummary
}

async function apiRequest<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(payload?.message ?? 'Errore API.')
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

export function fetchSavedAnalyses() {
  return apiRequest<SavedAnalysisListItem[]>('/api/analyses')
}

export function fetchSavedAnalysis(id: string) {
  return apiRequest<SavedAnalysisDetail>(`/api/analyses/${id}`)
}

export function createSavedAnalysis(payload: SaveAnalysisPayload) {
  return apiRequest<{ id: string }>('/api/analyses', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateSavedAnalysis(id: string, payload: Partial<SaveAnalysisPayload>) {
  return apiRequest<{ ok: true }>(`/api/analyses/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function deleteSavedAnalysis(id: string) {
  return apiRequest<void>(`/api/analyses/${id}`, {
    method: 'DELETE',
  })
}
