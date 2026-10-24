import { validateDatasetFile } from './fileValidation'

const file = (name: string, size = 1024) => ({ name, size })

describe('validateDatasetFile', () => {
  it('acepta CSV y XLSX', () => {
    expect(validateDatasetFile(file('ventas.csv'), 10)).toEqual({ ok: true, format: 'csv' })
    expect(validateDatasetFile(file('Notas.XLSX'), 10)).toEqual({ ok: true, format: 'xlsx' })
  })

  it('rechaza PDF con un mensaje claro', () => {
    const result = validateDatasetFile(file('informe.pdf'), 10)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/PDF no son compatibles/)
  })

  it('rechaza otros formatos, archivos vacíos y archivos grandes', () => {
    expect(validateDatasetFile(file('foto.png'), 10).ok).toBe(false)
    expect(validateDatasetFile(file('viejo.xls'), 10).ok).toBe(false)
    expect(validateDatasetFile(file('sin_extension'), 10).ok).toBe(false)
    expect(validateDatasetFile(file('vacio.csv', 0), 10).ok).toBe(false)
    expect(validateDatasetFile(file('grande.csv', 11 * 1024 * 1024), 10).ok).toBe(false)
  })
})
