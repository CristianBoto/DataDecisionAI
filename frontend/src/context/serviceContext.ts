import { createContext } from 'react'
import { service, type DataDecisionService } from '@/services'
import { createDefaultAIGateway, type AIGatewayClient } from '@/services/aiGateway'

/** Permite inyectar otra implementación del servicio (por ejemplo, en pruebas). */
export const ServiceContext = createContext<DataDecisionService>(service)

/** Frontera de IA del backend; null en la demo pública (sin conexión). */
export const defaultAIGateway = createDefaultAIGateway()
export const AIGatewayContext = createContext<AIGatewayClient | null>(defaultAIGateway)
