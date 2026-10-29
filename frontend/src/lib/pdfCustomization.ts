/**
 * Personalización del PDF (Fase 4E): título, autor, institución, logo, fecha y marca.
 *
 * Es una capa de PRESENTACIÓN: vive solo en el estado de la pantalla del informe y se usa
 * para la vista previa y el PDF. No toca el objetivo, los resultados ni la sesión, no se
 * envía al backend ni a la IA y no se guarda en ningún almacenamiento. El logo se valida y
 * se decodifica en el navegador; se vuelve a dibujar en un lienzo, así el PDF recibe una
 * imagen limpia (sin metadatos) del tamaño necesario.
 */

export const LIMITS = { title: 120, author: 80, organization: 100 } as const
export const LOGO_MAX_BYTES = 1024 * 1024
export const LOGO_MIN_PX = 16
export const LOGO_MAX_PX = 6000
/** Lado mayor del logo que se guarda para el PDF: suficiente para imprimir, sin inflar el archivo. */
const LOGO_STORED_PX = 800

export type LogoFormat = 'PNG' | 'JPEG'

export interface PdfLogo {
  dataUrl: string
  format: LogoFormat
  /** Tamaño original (px): define la proporción con la que se dibuja. */
  width: number
  height: number
  fileName: string
}

export interface PdfCustomization {
  title: string
  author: string
  organization: string
  logo: PdfLogo | null
  showDate: boolean
  showBrand: boolean
}

/** Lo que efectivamente se imprime: campos limpios, vacíos como null, título nunca vacío. */
export interface PdfPresentation {
  title: string
  author: string | null
  organization: string | null
  logo: PdfLogo | null
  showDate: boolean
  showBrand: boolean
}

export function defaultCustomization(): PdfCustomization {
  return { title: '', author: '', organization: '', logo: null, showDate: true, showBrand: true }
}

// Caracteres de control e invisibles de dirección (no se imprimen y pueden alterar el texto).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g

/** Texto plano de una línea: sin caracteres de control, espacios colapsados y longitud máxima. */
export function cleanField(value: string, max: number): string {
  return Array.from(value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim())
    .slice(0, max)
    .join('')
    .trim()
}

export function presentation(c: PdfCustomization, defaultTitle: string): PdfPresentation {
  return {
    title: cleanField(c.title, LIMITS.title) || cleanField(defaultTitle, LIMITS.title),
    author: cleanField(c.author, LIMITS.author) || null,
    organization: cleanField(c.organization, LIMITS.organization) || null,
    logo: c.logo,
    showDate: c.showDate,
    showBrand: c.showBrand,
  }
}

/** Presentación sin personalizar (PDF descargado sin tocar nada). */
export function defaultPresentation(defaultTitle: string): PdfPresentation {
  return presentation(defaultCustomization(), defaultTitle)
}

/** Formato REAL según los primeros bytes (no según la extensión ni el tipo que declara el navegador). */
export function sniffImage(bytes: Uint8Array): LogoFormat | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return 'PNG'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'JPEG'
  return null
}

function readHead(file: Blob, length: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
    reader.readAsArrayBuffer(file.slice(0, length))
  })
}

export interface DecodedImage {
  dataUrl: string
  width: number
  height: number
}

/**
 * Decodifica la imagen y la vuelve a dibujar (reducida si hace falta) en un lienzo.
 * La URL temporal del archivo se libera siempre, salga bien o mal.
 */
export async function decodeImage(file: Blob, format: LogoFormat): Promise<DecodedImage> {
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('decode'))
      image.src = url
    })
    const width = image.naturalWidth
    const height = image.naturalHeight
    if (!width || !height) throw new Error('decode')
    const scale = Math.min(1, LOGO_STORED_PX / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('decode')
    if (format === 'JPEG') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL(format === 'PNG' ? 'image/png' : 'image/jpeg', 0.92)
    canvas.width = 0
    canvas.height = 0
    return { dataUrl, width, height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export type LogoResult = { ok: true; logo: PdfLogo } | { ok: false; error: string }

/** Valida el logo: tamaño, tipo real (PNG o JPG, nunca SVG), decodificación y dimensiones. */
export async function readLogo(file: File, decode: typeof decodeImage = decodeImage): Promise<LogoResult> {
  if (file.size === 0) return { ok: false, error: 'El archivo está vacío.' }
  if (file.size > LOGO_MAX_BYTES) return { ok: false, error: 'El logo supera 1 MB. Usá una imagen más liviana.' }
  let format: LogoFormat | null
  try {
    format = sniffImage(await readHead(file, 16))
  } catch {
    return { ok: false, error: 'No se pudo leer el archivo.' }
  }
  if (!format) return { ok: false, error: 'Solo se aceptan imágenes PNG o JPG. Los SVG y otros formatos no se admiten.' }
  let decoded: DecodedImage
  try {
    decoded = await decode(file, format)
  } catch {
    return { ok: false, error: 'La imagen está dañada o no se puede abrir.' }
  }
  const { width, height } = decoded
  if (width < LOGO_MIN_PX || height < LOGO_MIN_PX) return { ok: false, error: `La imagen es demasiado chica (mínimo ${LOGO_MIN_PX} × ${LOGO_MIN_PX} píxeles).` }
  if (width > LOGO_MAX_PX || height > LOGO_MAX_PX) return { ok: false, error: `La imagen es demasiado grande (máximo ${LOGO_MAX_PX} píxeles por lado).` }
  return { ok: true, logo: { dataUrl: decoded.dataUrl, format, width, height, fileName: cleanField(file.name, 80) } }
}

/** Medidas para dibujar el logo dentro de una caja, sin deformarlo ni agrandarlo de más. */
export function fitLogo(logo: Pick<PdfLogo, 'width' | 'height'>, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(maxWidth / logo.width, maxHeight / logo.height)
  return { width: logo.width * scale, height: logo.height * scale }
}
