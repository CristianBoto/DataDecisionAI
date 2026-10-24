import { createContext } from 'react'
import { service, type DataDecisionService } from '@/services'

/** Permite inyectar otra implementación del servicio (por ejemplo, en pruebas). */
export const ServiceContext = createContext<DataDecisionService>(service)
