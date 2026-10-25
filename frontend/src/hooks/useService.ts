import { useContext } from 'react'
import { AIGatewayContext, AnalysisEngineContext, ServiceContext } from '@/context/serviceContext'

export function useService() {
  return useContext(ServiceContext)
}

export function useAIGateway() {
  return useContext(AIGatewayContext)
}

export function useAnalysisEngine() {
  return useContext(AnalysisEngineContext)
}
