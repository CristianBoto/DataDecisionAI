/**
 * Datos SINTÉTICOS de prueba para el modo real (con backend).
 *
 * No son respuestas simuladas: se generan acá como un CSV común y siguen el mismo
 * camino que un archivo propio (perfilado con Pandas, revisión, IA real y motor).
 * Sirven para probar la plataforma sin datos propios. El nombre del archivo y la
 * pantalla de carga los identifican como datos de prueba. Son determinísticos.
 */

export interface SampleDataset {
  key: 'ventas' | 'indicadores' | 'clasificacion' | 'educacion' | 'errores'
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

/** Fase 5: estructuras distintas para validar el motor (mismos datos que las pruebas del backend). */
SAMPLE_DATASETS.push(
  {
    key: 'educacion',
    label: 'Educación (matrícula, gastos y una tasa)',
    description: 'Instituciones ficticias por nivel, con una matrícula faltante, otra igual a cero y una tasa que no se suma.',
    fileName: 'datos-sinteticos-de-prueba-educacion.csv',
    csv: () =>
      rows('codigo,institucion,nivel,matricula,gastos_ars,tasa_aprobacion', [
        'E101,Escuela Ficticia Norte,Primario,180,3600000,91%',
        'E102,Escuela Ficticia Sur,Primario,240,4320000,88%',
        'E103,Escuela Ficticia Este,Primario,,2100000,90%',
        'E104,Escuela Ficticia Oeste,Primario,155,3255000,86%',
        'E205,Colegio Ficticio Centro,Secundario,310,8060000,78%',
        'E206,Colegio Ficticio Río,Secundario,275,6875000,81%',
        'E207,Colegio Ficticio Lago,Secundario,0,950000,75%',
        'E208,Colegio Ficticio Monte,Secundario,198,5346000,83%',
        'E309,Instituto Ficticio Uno,Superior,420,15120000,69%',
        'E310,Instituto Ficticio Dos,Superior,365,12775000,72%',
        'E311,Instituto Ficticio Tres,Superior,512,17408000,66%',
        'E312,Instituto Ficticio Cuatro,Superior,290,10730000,74%',
      ]),
  },
  {
    key: 'errores',
    label: 'Datos con errores (para el diagnóstico de calidad)',
    description: 'Faltantes, duplicados, categorías inconsistentes, fechas inválidas, texto en una columna numérica y un atípico.',
    fileName: 'datos-sinteticos-de-prueba-errores.csv',
    csv: () =>
      rows('fecha,zona,monto', [
        '2025-01-10,Norte,120', '2025-01-10,Norte,120', '2025-01-12,norte,130', '2025-02-03,Sur,125', '2025-02-03, SUR ,125',
        '2025-02-30,Sur,140', 'sin fecha,Este,135', '2025-03-08,Este,abc', '2025-03-09,Este,N/A', '2025-03-15,Norte,',
        '2025-04-02,Sur,128', '2025-04-11,Este,132', '2025-05-05,Norte,99999', '2025-05-19,Sur,127', '2025-06-01,Este,131',
        '2025-06-21,Norte,126',
      ]),
  },
)

export function sampleFile(sample: SampleDataset): File {
  return new File([sample.csv()], sample.fileName, { type: 'text/csv' })
}
