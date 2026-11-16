/** Deriva tons acessíveis a partir da cor do convite, sem trocar a matiz. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}
const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')

function luminance([r, g, b]: number[]) {
  const f = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
export function contrast(a: string, b: string) {
  const la = luminance(hexToRgb(a))
  const lb = luminance(hexToRgb(b))
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function rgbToHsl([r, g, b]: number[]): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}
function hslToRgb(h: number, s: number, l: number): number[] {
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    const a = s * Math.min(l, 1 - l)
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))
  }
  return [f(0), f(8), f(4)]
}

/** Escurece só a luminosidade (mantém matiz e saturação) até o contraste pedido com branco. */
export function shadeFor(hex: string, minContrast: number) {
  const [h, s, l] = rgbToHsl(hexToRgb(hex))
  for (let L = l; L >= 0; L -= 0.01) {
    const out = toHex(hslToRgb(h, Math.min(1, s * 0.92), L))
    if (contrast(out, '#ffffff') >= minContrast) return out
  }
  return '#333333'
}

export interface ThemeVars {
  '--c-primary': string
  '--c-primary-text': string
  '--c-primary-strong': string
  '--c-soft': string
}

export function themeVars(primary: string, soft: string): ThemeVars {
  return {
    '--c-primary': primary,
    '--c-primary-text': shadeFor(primary, 3.2),
    '--c-primary-strong': shadeFor(primary, 4.6),
    '--c-soft': soft,
  }
}

export const DEFAULT_THEME = themeVars('#C0A4ED', '#F8F5FA')
