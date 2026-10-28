/**
 * Paleta categórica validada (orden fijo, nunca rotado): azul, naranja, aqua.
 * Los colores siguen a la serie, no a su posición en un filtro. Los tres
 * siguientes solo se usan cuando hay más series (resultados reales con varias categorías).
 * La comparten el dashboard y el informe PDF (leyendas).
 */
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#8b5cf6', '#d4a20b', '#64748b']

export function seriesColor(index: number) {
  return SERIES_COLORS[index % SERIES_COLORS.length]
}
