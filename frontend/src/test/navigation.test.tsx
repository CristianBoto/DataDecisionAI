import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '@/context/AppProviders'
import { routes } from '@/routes'
import { adaptBackendProfile, type DatasetProfiler } from '@/services/backendProfile'
import { createDemoService } from '@/services/demoProvider'
import { ApiError } from '@/services/errors'

function renderApp(initialPath = '/', profiler?: DatasetProfiler) {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] })
  render(
    <AppProviders service={createDemoService({ delayMs: 0, profiler })}>
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
    expect(screen.getByText(/Demo pública/)).toBeInTheDocument()
    expect(screen.getAllByText(/no cargues datos confidenciales/i).length).toBeGreaterThan(0)

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

  it('muestra el perfil real de Pandas cuando el perfilado con backend está activo', async () => {
    const user = userEvent.setup()
    const profiler: DatasetProfiler = {
      profile: async (_file, id) =>
        adaptBackendProfile(
          {
            filename: 'turnos.csv',
            format: 'csv',
            encoding: 'utf-8-sig',
            sheet_name: null,
            row_count: 102254,
            column_count: 2,
            duplicate_rows: 37,
            columns: [
              { name: 'sede', missing: 5, non_empty: 102249, distinct: 4, examples: ['Centro', 'Norte'] },
              { name: 'minutos', missing: 0, non_empty: 102254, distinct: 90, examples: ['10', '25'] },
            ],
            preview: [{ sede: 'Centro', minutos: '10' }],
            warnings: ["La columna 'sede' tiene 5 valores vacíos.", 'Se encontraron 37 filas idénticas. No se eliminan automáticamente.'],
          },
          id,
        ),
    }
    renderApp('/analisis/cargar', profiler)
    expect(screen.getByText('Perfilado real con el backend local')).toBeInTheDocument()
    await user.upload(screen.getByTestId('file-input'), new File(['sede,minutos\nCentro,10\n'], 'turnos.csv', { type: 'text/csv' }))

    expect(await screen.findByText('Perfil del backend')).toBeInTheDocument()
    expect(screen.getByText('102.254')).toBeInTheDocument()
    expect(screen.getByText('Filas duplicadas')).toBeInTheDocument()
    expect(screen.getByText('37')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /sede/ })).toHaveTextContent('5 vacíos')
    expect(screen.getByRole('cell', { name: 'Centro' })).toBeInTheDocument()
    expect(screen.getByText(/La columna 'sede' tiene 5 valores vacíos/)).toBeInTheDocument()
  })

  it('informa el error del backend sin mostrar una vista previa alternativa', async () => {
    const user = userEvent.setup()
    const profiler: DatasetProfiler = {
      profile: () => Promise.reject(new ApiError('El archivo CSV no tiene una estructura tabular válida.', { status: 422 })),
    }
    renderApp('/analisis/cargar', profiler)
    await user.upload(screen.getByTestId('file-input'), new File(['a,b\n1,2\n'], 'roto.csv', { type: 'text/csv' }))

    expect(await screen.findByText('El backend no pudo perfilar el archivo')).toBeInTheDocument()
    expect(screen.getByText(/estructura tabular válida/)).toBeInTheDocument()
    expect(screen.queryByText('Vista previa')).not.toBeInTheDocument()
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
