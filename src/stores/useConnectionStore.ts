import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { OracleConnectionConfig } from '../types/oracle';

type ConnectionState = {
  config: OracleConnectionConfig;
  connected: boolean;
  status: string;
  setConfig: (config: OracleConnectionConfig) => void;
  setConnected: (connected: boolean, status?: string) => void;
};

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set) => ({
      config: { user: '', password: '', connectString: '' },
      connected: false,
      status: 'Desconectado',
      setConfig: (config) => set({ config }),
      setConnected: (connected, status) => set({ connected, status: status ?? (connected ? 'Conectado' : 'Desconectado') }),
    }),
    {
      name: 'oracle-dba-connection-state',
      partialize: (state) => ({ config: state.config }),
    }
  )
);
