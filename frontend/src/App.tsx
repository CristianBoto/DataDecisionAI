import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '@/context/AppProviders'
import { routes } from '@/routes'

const router = createBrowserRouter(routes)

export default function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  )
}
