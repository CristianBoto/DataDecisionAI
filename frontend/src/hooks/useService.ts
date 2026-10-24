import { useContext } from 'react'
import { ServiceContext } from '@/context/serviceContext'

export function useService() {
  return useContext(ServiceContext)
}
