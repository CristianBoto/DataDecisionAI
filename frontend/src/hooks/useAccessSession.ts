import { useSyncExternalStore } from 'react'
import { accessSession } from '@/services/accessSession'

/** Sesión de invitación vigente (o null); se actualiza al ingresar, salir o recibir un 401. */
export function useAccessSession() {
  return useSyncExternalStore(accessSession.subscribe, accessSession.get, () => null)
}
