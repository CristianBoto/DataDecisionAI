import type {
  AnalysisProposal,
  AnalysisResults,
  AnalysisRun,
  ApprovedAnalysisPlan,
  AssistantMessage,
  ChatReply,
  CreateProjectInput,
  Dataset,
  DatasetProfile,
  ExportFile,
  ExportRequest,
  HealthStatus,
  Project,
  SendMessageInput,
} from '@/types/domain'
import { getExportExtension } from '@/lib/exportFormats'
import { ApiError } from './errors'
import { HttpClient } from './httpClient'
import type { DataDecisionService } from './types'

/**
 * Implementación real contra FastAPI. Cada método corresponde a un endpoint
 * descripto en docs/API_CONTRACT.md. Hoy solo `/api/health` existe en el backend.
 */
export function createHttpService(baseUrl: string): DataDecisionService {
  const http = new HttpClient(baseUrl)
  const id = encodeURIComponent

  return {
    mode: 'http',

    checkHealth: () => http.json<HealthStatus>('/api/health', { timeoutMs: 5_000 }),

    uploadDataset(file) {
      const form = new FormData()
      form.append('file', file)
      return http.json<Dataset>('/api/datasets', { method: 'POST', body: form, timeoutMs: 120_000 })
    },

    loadDemoDataset() {
      return Promise.reject(
        new ApiError('El dataset de ejemplo solo está disponible en modo DEMO.', { code: 'demo_only' }),
      )
    },

    getDatasetProfile: (datasetId) =>
      http.json<DatasetProfile>(`/api/datasets/${id(datasetId)}/profile`),

    createProject: (input: CreateProjectInput) =>
      http.json<Project>('/api/projects', { method: 'POST', body: input }),

    getProject: (projectId) => http.json<Project>(`/api/projects/${id(projectId)}`),

    getConversation: (projectId) =>
      http.json<AssistantMessage[]>(`/api/projects/${id(projectId)}/messages`),

    sendMessage: (projectId, input: SendMessageInput) =>
      http.json<ChatReply>(`/api/projects/${id(projectId)}/messages`, {
        method: 'POST',
        body: input,
        timeoutMs: 90_000,
      }),

    getCurrentProposal: (projectId) =>
      http.json<AnalysisProposal | null>(`/api/projects/${id(projectId)}/proposal`),

    approveProposal: (projectId, proposalId) =>
      http.json<ApprovedAnalysisPlan>(`/api/projects/${id(projectId)}/proposal/approve`, {
        method: 'POST',
        body: { proposalId },
      }),

    runAnalysis: (projectId) =>
      http.json<AnalysisRun>(`/api/projects/${id(projectId)}/analysis/run`, { method: 'POST' }),

    getResults: (projectId) => http.json<AnalysisResults>(`/api/projects/${id(projectId)}/results`),

    async exportAnalysis(projectId, request: ExportRequest): Promise<ExportFile> {
      const { blob, fileName } = await http.blob(`/api/projects/${id(projectId)}/exports`, {
        method: 'POST',
        body: request,
        timeoutMs: 120_000,
      })
      return { blob, fileName: fileName ?? `informe.${getExportExtension(request)}` }
    },
  }
}
