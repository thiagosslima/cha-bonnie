const MESSAGES: Record<string, string> = {
  NAME_REQUIRED: 'Conta pra gente o seu nome completo 💜',
  NAME_INVALID: 'Esse nome parece incompleto. Pode conferir?',
  ATTENDANCE_REQUIRED: 'Escolha uma das opções de presença.',
  DIAPER_REQUIRED: 'Escolha o tamanho da fralda para confirmar.',
  EVENT_NOT_FOUND: 'Não encontramos esse chá de bebê.',
  RSVP_CLOSED: 'As confirmações para este chá já foram encerradas. Fale com o Thiago ou a Rafa 💜',
  RSVP_NOT_FOUND: 'Não encontramos essa confirmação. Você pode responder novamente.',
  INVALID_TOKEN: 'Esse link de alteração não é válido.',
  INVALID_REQUEST: 'Algo deu errado com o envio. Tente novamente.',
  RATE_LIMITED: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.',
  FORBIDDEN: 'Você não tem permissão para isso.',
  TARGET_SUM_100: 'As metas de fralda precisam somar 100%.',
  TARGET_INVALID: 'Cada meta precisa estar entre 0% e 100%.',
  QUANTITY_INVALID: 'Quantidade inválida.',
  NEGATIVE_TOTAL: 'Essa correção deixaria a quantidade negativa.',
  ITEM_NOT_FOUND: 'Item não encontrado.',
  ALREADY_REVERSED: 'Essa movimentação já foi desfeita.',
  MOVEMENT_NOT_REVERSIBLE: 'Essa movimentação não pode ser desfeita. Use a ação contrária.',
  NO_CHANGE: 'Nada mudou.',
  IMPORT_INVALID: 'O arquivo de importação tem dados inválidos.',
  HISTORY_IMMUTABLE: 'O histórico não pode ser alterado.',
}

export function errorCode(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

export function friendlyError(e: unknown): string {
  const code = errorCode(e)
  if (MESSAGES[code]) return MESSAGES[code]
  if (/fetch|network|Failed to fetch|Load failed/i.test(code)) return 'Sem conexão no momento. Verifique a internet e tente de novo.'
  return 'Não foi possível concluir agora. Tente novamente em instantes.'
}
