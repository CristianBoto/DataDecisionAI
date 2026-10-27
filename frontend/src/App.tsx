import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { AccessGate } from '@/components/auth/AccessGate'
import { AppProviders } from '@/context/AppProviders'
import { requiresAccess } from '@/lib/config'
import { routes } from '@/routes'

const router = createBrowserRouter(routes)

export default function App() {
  // La puerta de acceso envuelve a los proveedores: al cerrar la sesión se descarta
  // todo lo cargado en el navegador (archivos, revisión y conversación).
  return (
    <AccessGate enabled={requiresAccess}>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </AccessGate>
  )
}
