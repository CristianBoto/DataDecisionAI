import type {
  AnalysisProposal,
  AnalysisResults,
  AssistantMessage,
  Dataset,
  DatasetProfile,
  MessageKind,
  Project,
} from '@/types/domain'
import { isAffirmative } from '@/lib/conversationFlow'
import { createId } from '@/lib/ids'
import { profileCsvFile } from '@/lib/csv'
import { validateDatasetFile } from '@/lib/fileValidation'
import { getExportOption } from '@/lib/exportFormats'
import { appConfig } from '@/lib/config'
import { MAX_SOURCES } from '@/lib/datasetCatalog'
import { createDemoDataset, createDemoProfile, createDemoResults } from '@/mocks/demoDataset'
import {
  buildGreeting,
  buildMultiSourceNote,
  buildProposal,
  createInitialState,
  replyAfterApproval,
  replyToClarification,
  replyToAcceptance,
  replyToModification,
  replyToObjective,
  type DemoConversationState,
  type ScriptedReply,
} from '@/mocks/demoAssistant'
import type { DatasetProfiler } from './backendProfile'
import { ApiError, BackendRequiredError } from './errors'
import type { DataDecisionService } from './types'

/**
 * Proveedor DEMO: implementa el mismo contrato que el cliente HTTP, pero
 * guarda todo en memoria (se pierde al recargar). No usa localStorage ni
 * guarda archivos. Los resultados de análisis solo existen para el dataset
 * ficticio; para archivos propios se informa que se necesita el backend.
 *
 * Con `profiler` (VITE_BACKEND_PROFILING=true) el perfil de los archivos
 * propios lo calcula FastAPI + Pandas; si falla, se informa el error y no se
 * reemplaza por una vista previa local ni por datos ficticios.
 */

interface ProjectRecord {
  project: Project
  messages: AssistantMessage[]
  proposal: AnalysisProposal | null
  state: DemoConversationState
}

/** Latencia artificial para que se vean los estados de carga. */
const DEFAULT_DELAY_MS = 450

export interface DemoServiceOptions {
  delayMs?: number
  profiler?: DatasetProfiler
}

export function createDemoService(options: DemoServiceOptions = {}): DataDecisionService {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS
  const { profiler } = options
  const datasets = new Map<string, Dataset>()
  const profiles = new Map<string, DatasetProfile>()
  const projects = new Map<string, ProjectRecord>()

  const wait = <T>(value: T, ms = delayMs): Promise<T> =>
    new Promise((resolve) => setTimeout(() => resolve(value), ms))

  function getRecord(projectId: string): ProjectRecord {
    const record = projects.get(projectId)
    if (!record) {
      throw new ApiError(
        'No se encontró el proyecto. En modo DEMO los datos se guardan solo en memoria y se pierden al recargar la página.',
        { status: 404, code: 'not_found' },
      )
    }
    return record
  }

  function message(role: AssistantMessage['role'], content: string, kind: MessageKind = 'text', extra: Partial<AssistantMessage> = {}): AssistantMessage {
    return { id: createId('msg'), role, kind, content, createdAt: new Date().toISOString(), isDemo: role !== 'user', ...extra }
  }

  function touch(record: ProjectRecord, status?: Project['status']) {
    record.project = { ...record.project, status: status ?? record.project.status, updatedAt: new Date().toISOString() }
  }

  return {
    mode: 'demo',
    profiling: profiler ? 'backend' : 'browser',

    checkHealth: () =>
      wait({ status: 'ok', service: 'DataDecision AI (proveedor DEMO)', version: '0.1.0', environment: 'demo' }, 150),

    async uploadDataset(file) {
      const validation = validateDatasetFile(file, appConfig.maxUploadMb)
      if (!validation.ok) throw new ApiError(validation.error, { status: 422, code: 'invalid_file' })

      const dataset: Dataset = {
        id: createId('ds'),
        name: file.name.replace(/\.[^.]+$/, ''),
        fileName: file.name,
        format: validation.format,
        sizeBytes: file.size,
        uploadedAt: new Date().toISOString(),
        source: 'upload',
        status: 'ready',
      }

      // Perfil: Pandas si está activado; si no, preliminar en el navegador (CSV) o vacío (Excel).
      const profile: DatasetProfile = profiler
        ? await profiler.profile(file, dataset.id)
        : validation.format === 'csv'
          ? await profileCsvFile(file, dataset.id)
          : {
              datasetId: dataset.id,
              origin: 'local-preview',
              isComplete: false,
              rowCount: null,
              rowCountIsEstimate: false,
              columnCount: 0,
              columns: [],
              previewRows: [],
              issues: [{ severity: 'info', message: 'La vista previa y el perfil de archivos Excel se habilitarán al conectar el backend.' }],
              note: 'El archivo Excel se validará y procesará en el backend con Pandas.',
            }

      datasets.set(dataset.id, dataset)
      profiles.set(dataset.id, profile)
      return profiler ? dataset : wait(dataset)
    },

    loadDemoDataset() {
      const dataset = createDemoDataset()
      datasets.set(dataset.id, dataset)
      profiles.set(dataset.id, createDemoProfile())
      return wait(dataset)
    },

    discardDataset(datasetId) {
      const usedByProject = [...projects.values()].some(({ project }) =>
        (project.datasetIds ?? [project.datasetId]).includes(datasetId),
      )
      if (usedByProject) return
      datasets.delete(datasetId)
      profiles.delete(datasetId)
    },

    getDatasetProfile(datasetId) {
      const profile = profiles.get(datasetId)
      if (!profile) return Promise.reject(new ApiError('No se encontró el perfil del dataset.', { status: 404, code: 'not_found' }))
      return wait(profile, delayMs / 2)
    },

    createProject({ name, datasetId, datasetIds }) {
      const dataset = datasets.get(datasetId)
      const profile = profiles.get(datasetId)
      if (!dataset || !profile) return Promise.reject(new ApiError('El dataset indicado no existe.', { status: 404, code: 'not_found' }))
      if (name.trim().length < 3) return Promise.reject(new ApiError('El nombre del proyecto debe tener al menos 3 caracteres.', { status: 422 }))

      // Fuentes: la principal primero, sin repetidos. Se referencian, no se combinan.
      const ids = [...new Set([datasetId, ...(datasetIds ?? [])])]
      if (ids.length > MAX_SOURCES) {
        return Promise.reject(new ApiError(`Un análisis admite hasta ${MAX_SOURCES} fuentes.`, { status: 422, code: 'too_many_sources' }))
      }
      const sources = ids.map((id) => datasets.get(id))
      if (sources.some((d) => d === undefined)) {
        return Promise.reject(new ApiError('Una de las fuentes indicadas no existe.', { status: 404, code: 'not_found' }))
      }

      const now = new Date().toISOString()
      const project: Project = {
        id: createId('prj'),
        name: name.trim(),
        datasetId,
        dataset,
        datasetIds: ids,
        datasets: sources as Dataset[],
        status: 'draft',
        createdAt: now,
        updatedAt: now,
        approvedPlan: null,
      }
      const greeting = buildGreeting(dataset, profile)
      const multiSourceNote = buildMultiSourceNote(dataset, project.datasets!.slice(1))
      projects.set(project.id, {
        project,
        messages: [
          message('assistant', greeting.content, 'text', { suggestions: greeting.suggestions }),
          ...(multiSourceNote ? [message('assistant', multiSourceNote, 'notice')] : []),
        ],
        proposal: null,
        state: createInitialState(),
      })
      return wait(project)
    },

    async getProject(projectId) {
      return wait(getRecord(projectId).project, delayMs / 2)
    },

    async getConversation(projectId) {
      return wait([...getRecord(projectId).messages], delayMs / 3)
    },

    async sendMessage(projectId, { content }) {
      const record = getRecord(projectId)
      const text = content.trim()
      if (text.length === 0) throw new ApiError('El mensaje no puede estar vacío.', { status: 422 })
      if (text.length > 2000) throw new ApiError('El mensaje no puede superar los 2000 caracteres.', { status: 422 })

      const dataset = record.project.dataset
      const profile = profiles.get(dataset.id) ?? createDemoProfile()
      const userMessage = message('user', text)
      const state = record.state
      let reply: ScriptedReply

      switch (state.stage) {
        case 'awaiting_objective': {
          const result = replyToObjective(text, dataset, profile)
          state.intent = result.intent
          state.objectiveText = text
          reply = result.reply
          state.stage = reply.producesProposal ? 'proposal_ready' : 'awaiting_clarification'
          break
        }
        case 'awaiting_clarification':
          reply = replyToClarification(text, state.intent, dataset.source === 'demo')
          state.stage = 'proposal_ready'
          break
        case 'proposal_ready':
          // Una aceptación («sí», «correcto») no es un pedido de cambio: no genera otra versión.
          if (isAffirmative(text)) {
            reply = replyToAcceptance()
            break
          }
          state.requestedChanges.push(text)
          reply = replyToModification(text, state.proposalVersion + 1)
          break
        default:
          reply = replyAfterApproval(dataset)
      }

      if (reply.producesProposal) {
        state.proposalVersion += 1
        record.proposal = buildProposal({
          projectId,
          dataset,
          otherSources: record.project.datasets?.slice(1),
          profile,
          intent: state.intent,
          objectiveText: state.objectiveText,
          version: state.proposalVersion,
          requestedChanges: state.requestedChanges,
          proposalId: createId('prop'),
        })
        touch(record, 'awaiting_approval')
      }

      const assistantMessage = message('assistant', reply.content, reply.kind, {
        suggestions: reply.suggestions,
        // La aceptación vuelve a mostrar la propuesta vigente, con sus botones, al pie del chat.
        proposalId: reply.kind === 'proposal' ? record.proposal?.id : undefined,
      })
      record.messages.push(userMessage, assistantMessage)
      return wait({ messages: [userMessage, assistantMessage], proposal: record.proposal }, delayMs * 2)
    },

    async getCurrentProposal(projectId) {
      return wait(getRecord(projectId).proposal, delayMs / 3)
    },

    async approveProposal(projectId, proposalId) {
      const record = getRecord(projectId)
      const proposal = record.proposal
      if (!proposal || proposal.id !== proposalId) {
        throw new ApiError('La propuesta indicada no es la versión vigente.', { status: 409, code: 'conflict' })
      }
      if (proposal.feasibility === 'insufficient') {
        throw new ApiError('No se puede aprobar una propuesta con datos insuficientes.', { status: 422 })
      }
      const plan = {
        id: createId('plan'),
        projectId,
        proposalId,
        proposalVersion: proposal.version,
        approvedAt: new Date().toISOString(),
        objective: proposal.objective,
        indicators: proposal.indicators,
        charts: proposal.charts,
        limitations: proposal.limitations,
      }
      record.project = { ...record.project, approvedPlan: plan }
      record.state.stage = 'plan_approved'
      touch(record, 'approved')
      return wait(plan)
    },

    async runAnalysis(projectId) {
      const record = getRecord(projectId)
      if (!record.project.approvedPlan) {
        throw new ApiError('Primero hay que aprobar la propuesta de análisis.', { status: 409, code: 'not_approved' })
      }
      const isDemoDataset = record.project.dataset.source === 'demo'
      // Archivos propios: el plan queda en cola hasta que exista el backend.
      touch(record, isDemoDataset ? 'completed' : 'approved')
      const now = new Date().toISOString()
      return wait({
        id: createId('run'),
        projectId,
        status: isDemoDataset ? 'completed' : 'queued',
        startedAt: now,
        finishedAt: isDemoDataset ? now : null,
        error: null,
      }, delayMs * 2)
    },

    async getResults(projectId): Promise<AnalysisResults> {
      const record = getRecord(projectId)
      const plan = record.project.approvedPlan
      if (!plan) {
        return wait({ projectId, status: 'not_started', generatedAt: null, isDemo: true, sourceNote: 'El análisis todavía no fue aprobado.', indicators: [], charts: [], findings: [], limitations: [] })
      }
      if (record.project.dataset.source !== 'demo') {
        return wait({
          projectId,
          status: 'pending_backend',
          generatedAt: null,
          isDemo: true,
          sourceNote: 'Los cálculos sobre tu archivo se ejecutarán cuando el backend (FastAPI + Pandas) esté conectado. No se muestran resultados inventados.',
          indicators: [],
          charts: [],
          findings: [],
          limitations: plan.limitations,
        })
      }
      return wait(createDemoResults(projectId, plan.charts.map((c) => c.id), plan.indicators.map((i) => i.id)), delayMs * 1.5)
    },

    async exportAnalysis(projectId, request) {
      getRecord(projectId)
      const option = getExportOption(request.format)
      throw new BackendRequiredError(
        `La exportación a ${option.label} todavía no está disponible: requiere la integración con el backend (FastAPI). No se generó ningún archivo.`,
      )
    },
  }
}
