/**
 * Markdown LIMITADO para mostrar el objetivo en el informe (Fase 4E): encabezados, párrafos y
 * listas. El resultado es texto plano por bloques: nunca se interpreta HTML (una etiqueta se
 * muestra tal cual) y las marcas de énfasis se quitan sin perder palabras. Solo cambia cómo se
 * ve el objetivo en la vista previa y el PDF; el texto original no se modifica.
 */

export type ObjectiveBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: { marker: string; text: string; level: 0 | 1 }[] }

/** Quita las marcas de énfasis y código, y convierte los enlaces en «texto (dirección)». */
export function inlineText(text: string): string {
  return text
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '$1')
    .replace(/(^|[\s(«"'])__(?=\S)(.+?)(?<=\S)__(?=$|[\s.,;:!?)»"'])/g, '$1$2')
    .replace(/(^|[\s(«"'])\*(?=\S)([^*\n]+?)(?<=\S)\*(?=$|[\s.,;:!?)»"'])/g, '$1$2')
    .replace(/(^|[\s(«"'])_(?=\S)([^_\n]+?)(?<=\S)_(?=$|[\s.,;:!?)»"'])/g, '$1$2')
    .replace(/\\([*_`#\\[\]-])/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

const HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/
const BOLD_LINE = /^\s*(\*\*|__)(?=\S)((?:(?!\*\*|__).)+?)(?<=\S)\1\s*:?\s*$/
const BULLET = /^(\s*)[-*+•]\s+(.*)$/
const ORDERED = /^(\s*)(\d{1,3})[.)]\s+(.*)$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/

export function parseObjective(text: string): ObjectiveBlock[] {
  const blocks: ObjectiveBlock[] = []
  let paragraph: string[] = []
  let list: Extract<ObjectiveBlock, { kind: 'list' }> | null = null

  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: inlineText(paragraph.join(' ')) })
    paragraph = []
    if (list) blocks.push(list)
    list = null
  }

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\t/g, '    ')
    if (!line.trim() || RULE.test(line)) {
      flush()
      continue
    }
    const heading = HEADING.exec(line) ?? BOLD_LINE.exec(line)
    if (heading) {
      flush()
      blocks.push({ kind: 'heading', text: inlineText(heading[heading.length - 1]) })
      continue
    }
    const bullet = BULLET.exec(line)
    const ordered = ORDERED.exec(line)
    if (bullet || ordered) {
      if (paragraph.length) {
        blocks.push({ kind: 'paragraph', text: inlineText(paragraph.join(' ')) })
        paragraph = []
      }
      list ??= { kind: 'list', items: [] }
      const indent = (bullet ?? ordered)![1].length
      list.items.push({
        marker: ordered ? `${ordered[2]}.` : '•',
        text: inlineText(bullet ? bullet[2] : ordered![3]),
        level: indent >= 2 ? 1 : 0,
      })
      continue
    }
    // Una línea suelta dentro de una lista continúa el ítem anterior.
    if (list && /^\s{2,}/.test(line)) {
      const last = list.items[list.items.length - 1]
      last.text = `${last.text} ${inlineText(line)}`
      continue
    }
    if (list) flush()
    paragraph.push(line.trim())
  }
  flush()
  return blocks.filter((b) => (b.kind === 'list' ? b.items.length > 0 : b.text.length > 0))
}
