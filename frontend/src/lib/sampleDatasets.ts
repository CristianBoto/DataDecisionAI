/**
 * Datos SINTÉTICOS de prueba para el modo real (con backend).
 *
 * No son respuestas simuladas: se generan acá como un CSV común y siguen el mismo
 * camino que un archivo propio (perfilado con Pandas, revisión, IA real y motor).
 * Sirven para probar la plataforma sin datos propios. El nombre del archivo y la
 * pantalla de carga los identifican como datos de prueba. Son determinísticos.
 */

export interface SampleDataset {
  key: 'ventas' | 'indicadores' | 'clasificacion'
  label: string
  description: string
  fileName: string
  csv: () => string
}

function rows(header: string, lines: string[]): string {
  return [header, ...lines].join('\n') + '\n'
}

export const SAMPLE_DATASETS: SampleDataset[] = [
  {
    key: 'ventas',
    label: 'Ventas (fechas, categorías y montos)',
    description: 'Ventas diarias de 6 meses por rubro y canal, con montos en pesos.',
    fileName: 'datos-sinteticos-de-prueba-ventas.csv',
    csv: () => {
      const lines: string[] = []
      const rubros = [['Alimentos', 1200], ['Limpieza', 450], ['Bebidas', 800]] as const
      for (let m = 1; m <= 6; m += 1) {
        for (const day of [3, 11, 19, 27]) {
          rubros.forEach(([rubro, base], i) => {
            const canal = (day + i) % 2 === 0 ? 'Online' : 'Local'
            const amount = base + m * 25 + day * 3 + i * 10
            lines.push(`2025-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')};${rubro};${canal};${amount}`)
          })
        }
      }
      return rows('fecha;rubro;canal;monto_ars', lines)
    },
  },
  {
    key: 'indicadores',
    label: 'Indicadores económicos (formato largo, unidades distintas)',
    description: 'Un indicador por fila (exportaciones, desempleo, población) por región y año, con su unidad.',
    fileName: 'datos-sinteticos-de-prueba-indicadores.csv',
    csv: () => {
      const lines: string[] = []
      const regiones = [['Norte', 1], ['Centro', 2], ['Sur', 3]] as const
      for (let year = 2019; year <= 2024; year += 1) {
        for (const [region, f] of regiones) {
          const t = year - 2019
          lines.push(`${year}-01-01,${region},exportaciones,millones USD,${(150 * f + 12 * t).toFixed(1)}`)
          lines.push(`${year}-01-01,${region},desempleo,%,${(5 + f + (t % 3) * 0.4).toFixed(1)}`)
          lines.push(`${year}-01-01,${region},poblacion,personas,${400000 * f + 3500 * t}`)
        }
      }
      return rows('periodo,region,indicador,unidad,valor', lines)
    },
  },
  {
    key: 'clasificacion',
    label: 'Clasificación (etiquetas y probabilidades para ROC)',
    description: 'Resultado real (sí/no) y la probabilidad que asignó un modelo existente.',
    fileName: 'datos-sinteticos-de-prueba-clasificacion.csv',
    csv: () => {
      const lines: string[] = []
      for (let i = 1; i <= 60; i += 1) {
        const positive = i % 3 === 0 || i % 7 === 0
        // Probabilidades informativas pero imperfectas (hay solapamiento entre clases).
        const p = positive ? 0.45 + ((i * 37) % 50) / 100 : 0.05 + ((i * 53) % 55) / 100
        lines.push(`C${String(i).padStart(3, '0')},${positive ? 'si' : 'no'},${p.toFixed(2)}`)
      }
      return rows('caso,resultado,probabilidad', lines)
    },
  },
]

export function sampleFile(sample: SampleDataset): File {
  return new File([sample.csv()], sample.fileName, { type: 'text/csv' })
}
