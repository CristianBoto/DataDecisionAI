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

/**
 * Contrato único que implementan el proveedor DEMO y el cliente HTTP.
 * Los componentes solo conocen esta interfaz, nunca `fetch` ni los mocks.
 * Ver docs/API_CONTRACT.md para los endpoints equivalentes.
 */
export interface DataDecisionService {
  readonly mode: 'demo' | 'http'

  checkHealth(): Promise<HealthStatus>

  // Datasets
  uploadDataset(file: File): Promise<Dataset>
  /** Solo disponible en modo DEMO: carga el dataset ficticio de ejemplo. */
  loadDemoDataset(): Promise<Dataset>
  getDatasetProfile(datasetId: string): Promise<DatasetProfile>

  // Proyectos
  createProject(input: CreateProjectInput): Promise<Project>
  getProject(projectId: string): Promise<Project>

  // Asistente de requisitos (IA 1)
  getConversation(projectId: string): Promise<AssistantMessage[]>
  sendMessage(projectId: string, input: SendMessageInput): Promise<ChatReply>
  getCurrentProposal(projectId: string): Promise<AnalysisProposal | null>
  approveProposal(projectId: string, proposalId: string): Promise<ApprovedAnalysisPlan>

  // Análisis (IA 2 + Pandas)
  runAnalysis(projectId: string): Promise<AnalysisRun>
  getResults(projectId: string): Promise<AnalysisResults>

  // Exportación (PDF, Excel, Word, Canva)
  exportAnalysis(projectId: string, request: ExportRequest): Promise<ExportFile>
}
