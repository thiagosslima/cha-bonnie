import type { Cell, SheetData } from './layetteImport'

type ExcelValue = unknown

function toCell(v: ExcelValue): Cell {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('result' in o) return toCell(o.result as ExcelValue) // fórmula
    if ('hyperlink' in o) return String(o.hyperlink ?? o.text ?? '')
    if ('richText' in o && Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join('')
    if ('text' in o) return String(o.text)
    if ('error' in o) return null
  }
  return String(v)
}

/** Lê um .xlsx (ArrayBuffer) e devolve as abas como matrizes de células primitivas. */
export async function readWorkbook(data: ArrayBuffer): Promise<SheetData[]> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(data)
  const sheets: SheetData[] = []
  wb.eachSheet((ws) => {
    const rows: Cell[][] = []
    const max = Math.min(ws.rowCount, 3000)
    for (let r = 1; r <= max; r++) {
      const row = ws.getRow(r)
      const cells: Cell[] = []
      for (let c = 1; c <= Math.min(ws.columnCount, 30); c++) {
        const cell = row.getCell(c)
        // Células mescladas repetem o valor em todas as posições; só a principal conta.
        cells.push(cell.isMerged && cell.master && cell.master.address !== cell.address ? null : toCell(cell.value))
      }
      rows.push(cells)
    }
    sheets.push({ name: ws.name, rows })
  })
  return sheets
}
