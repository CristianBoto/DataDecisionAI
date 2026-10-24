import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '@/context/AppProviders'
import { routes } from '@/routes'
import { createDemoService } from '@/services/demoProvider'

function renderApp(initialPath = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] })
  render(
    <AppProviders service={createDemoService({ delayMs: 0 })}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return router
}

describe('navegación', () => {
  it('muestra la pantalla inicial y navega a la carga de datos', async () => {
    const user = userEvent.setup()
    const router = renderApp('/')
    expect(screen.getByRole('heading', { level: 1, name: /decisiones claras/i })).toBeInTheDocument()
    expect(screen.getByText(/Modo DEMO/)).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /Comenzar un análisis/i }))
    expect(router.state.location.pathname).toBe('/analisis/cargar')
    expect(screen.getByRole('heading', { name: /Cargá tu dataset/i })).toBeInTheDocument()
  })

  it('rechaza un PDF con un mensaje claro', async () => {
    const user = userEvent.setup({ applyAccept: false })
    renderApp('/analisis/cargar')
    await user.upload(screen.getByTestId('file-input'), new File(['%PDF'], 'informe.pdf', { type: 'application/pdf' }))
    expect(await screen.findByText(/Los archivos PDF no son compatibles/)).toBeInTheDocument()
  })

  it('muestra la vista previa real de un CSV y avanza al asistente', async () => {
    const user = userEvent.setup()
    const router = renderApp('/analisis/cargar')
    await user.upload(
      screen.getByTestId('file-input'),
      new File(['region;ventas\nNorte;10\nSur;20\n'], 'ventas.csv', { type: 'text/csv' }),
    )

    expect(await screen.findByText('Vista previa')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /region/ })).toBeInTheDocument()
    expect(screen.getByText('Estimación local preliminar')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Continuar con el asistente/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/analisis/asistente'))
    expect(await screen.findByText(/Revisé la vista previa de «ventas.csv»/)).toBeInTheDocument()
  })

  it('indica que no hay análisis en curso si se entra directo a confirmar', () => {
    renderApp('/analisis/confirmar')
    expect(screen.getByText('No hay un análisis en curso')).toBeInTheDocument()
  })

  it('muestra un error claro si el proyecto no existe', async () => {
    renderApp('/proyectos/inexistente')
    expect(await screen.findByText(/No se encontró el proyecto/)).toBeInTheDocument()
  })

  it('muestra la página 404 en rutas desconocidas', () => {
    renderApp('/no-existe')
    expect(screen.getByText('Página no encontrada')).toBeInTheDocument()
  })
})
