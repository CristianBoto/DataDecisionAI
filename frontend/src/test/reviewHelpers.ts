import { screen, waitFor } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'

/** Paso 1 → 2: desde la carga, pasar a la revisión obligatoria. */
export async function goToReview(user: UserEvent) {
  await user.click(await screen.findByRole('button', { name: /Continuar con la revisión/ }))
  await screen.findByRole('heading', { name: /Revisá tus datos y la privacidad/ })
}

/** Paso 2 → 3: escribir el objetivo y confirmar la revisión (aceptando las sugerencias). */
export async function completeReview(user: UserEvent, objective = 'Quiero un resumen general de mis datos') {
  const field = screen.getByLabelText('¿Qué necesitás analizar?')
  await user.clear(field)
  await user.type(field, objective)
  await user.click(screen.getByRole('button', { name: /Confirmar revisión y continuar/ }))
}

/** Paso 3: comenzar la conversación con el objetivo confirmado (sin copiarlo en el chat). */
export async function startConversation(user: UserEvent) {
  const start = await screen.findByRole('button', { name: 'Comenzar conversación' })
  await waitFor(() => expect(start).toBeEnabled())
  await user.click(start)
}
