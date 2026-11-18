/**
 * Sorteio das sugestões de presentes no convite.
 *
 * O banco sorteia (get_gift_suggestions) respeitando faixas, prioridades e
 * fixações. Aqui só evitamos mostrar exatamente a mesma combinação da visita
 * anterior: se vier igual, pedimos outro sorteio algumas vezes. Quando não há
 * alternativas suficientes, a combinação repetida é aceita.
 */

/** Identifica uma combinação independentemente da ordem. */
export function comboKey(items: { name: string }[]): string {
  return items
    .map((i) => i.name)
    .sort()
    .join('\u0001')
}

export async function drawAvoidingPrevious<T extends { name: string }>(
  draw: () => Promise<T[]>,
  previousKey: string | null,
  maxAttempts = 3,
): Promise<T[]> {
  let result = await draw()
  for (let i = 1; i < maxAttempts && previousKey && result.length > 0 && comboKey(result) === previousKey; i++) {
    result = await draw()
  }
  return result
}
