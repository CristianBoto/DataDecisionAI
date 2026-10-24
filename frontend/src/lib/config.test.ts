import { parseBoolean, parsePositiveNumber } from './config'
import { getExportExtension } from './exportFormats'

describe('configuración', () => {
  it('interpreta booleanos de variables de entorno', () => {
    expect(parseBoolean('true', false)).toBe(true)
    expect(parseBoolean('FALSE', true)).toBe(false)
    expect(parseBoolean(undefined, true)).toBe(true)
    expect(parseBoolean('', false)).toBe(false)
  })

  it('usa el valor por defecto ante números inválidos', () => {
    expect(parsePositiveNumber('50', 25)).toBe(50)
    expect(parsePositiveNumber('-1', 25)).toBe(25)
    expect(parsePositiveNumber('abc', 25)).toBe(25)
  })
})

describe('formatos de exportación', () => {
  it('resuelve la extensión, incluida la variante de Canva', () => {
    expect(getExportExtension({ format: 'pdf' })).toBe('pdf')
    expect(getExportExtension({ format: 'xlsx' })).toBe('xlsx')
    expect(getExportExtension({ format: 'canva' })).toBe('pptx')
    expect(getExportExtension({ format: 'canva', canvaFileType: 'pdf' })).toBe('pdf')
  })
})
