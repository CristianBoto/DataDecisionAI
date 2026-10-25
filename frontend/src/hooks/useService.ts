import { useContext } from 'react'
import { AIGatewayContext, ServiceContext } from '@/context/serviceContext'

export function useService() {
  return useContext(ServiceContext)
}

export function useAIGateway() {
  return useContext(AIGatewayContext)
}
