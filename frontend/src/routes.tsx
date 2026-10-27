import type { RouteObject } from 'react-router-dom'
import { PublicLayout } from '@/layouts/PublicLayout'
import { WizardLayout } from '@/layouts/WizardLayout'
import { WorkspaceLayout } from '@/layouts/WorkspaceLayout'
import { AssistantPage } from '@/pages/AssistantPage'
import { ConfirmPage } from '@/pages/ConfirmPage'
import { HomePage } from '@/pages/HomePage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { ResultsPage } from '@/pages/ResultsPage'
import { ReviewPage } from '@/pages/ReviewPage'
import { UploadPage } from '@/pages/UploadPage'
import { DatasetPage } from '@/pages/workspace/DatasetPage'
import { ExportPage } from '@/pages/workspace/ExportPage'
import { OverviewPage } from '@/pages/workspace/OverviewPage'

/** Definición de rutas, compartida por la app y por las pruebas. */
export const routes: RouteObject[] = [
  {
    element: <PublicLayout />,
    children: [{ index: true, element: <HomePage /> }],
  },
  {
    path: 'analisis',
    element: <WizardLayout />,
    children: [
      { path: 'cargar', element: <UploadPage /> },
      // Paso obligatorio: sin revisión confirmada no se llega al asistente.
      { path: 'revisar', element: <ReviewPage /> },
      { path: 'asistente', element: <AssistantPage /> },
      { path: 'confirmar', element: <ConfirmPage /> },
      // Resultados del motor Pandas: estado completo o parcial, dashboard y cómo seguir.
      { path: 'resultados', element: <ResultsPage /> },
    ],
  },
  {
    path: 'proyectos/:projectId',
    element: <WorkspaceLayout />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'datos', element: <DatasetPage /> },
      { path: 'exportar', element: <ExportPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]
