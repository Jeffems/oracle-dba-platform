import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { OracleConnectionConfig } from '../types/oracle';
import type { CentralApiConfig, CentralClient } from '../services/centralApiClient';

export type ConnectionMode = 'local' | 'remote';

export type RemoteConnectionState = {
  config: CentralApiConfig;
  selectedAgentId: string;
  selectedAgent?: CentralClient | null;
};

type ConnectionState = {
  mode: ConnectionMode;
  config: OracleConnectionConfig;
  remote: RemoteConnectionState;
  connected: boolean;
  status: string;
  setMode: (mode: ConnectionMode) => void;
  setConfig: (config: OracleConnectionConfig) => void;
  setRemoteConfig: (config: CentralApiConfig) => void;
  setSelectedAgent: (agentId: string, agent?: CentralClient | null) => void;
  setConnected: (connected: boolean, status?: string) => void;
};

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set, get) => ({
      mode: 'local',
      config: { user: '', password: '', connectString: '' },
      remote: {
        config: {
          apiUrl: import.meta.env.VITE_API_URL || 'http://127.0.0.1:4090',
          apiToken: import.meta.env.VITE_API_TOKEN || 'dev-token-change-me'
        },
        selectedAgentId: '',
        selectedAgent: null
      },
      connected: false,
      status: 'Desconectado',
      setMode: (mode) => set({ mode, connected: false, status: mode === 'local' ? 'Modo local selecionado' : 'Modo remoto selecionado' }),
      setConfig: (config) => set({ config }),
      setRemoteConfig: (config) => set((state) => ({ remote: { ...state.remote, config } })),
      setSelectedAgent: (agentId, agent = null) => set((state) => ({ remote: { ...state.remote, selectedAgentId: agentId, selectedAgent: agent } })),
      setConnected: (connected, status) => {
        const mode = get().mode;
        set({ connected, status: status ?? (connected ? (mode === 'local' ? 'Conectado localmente' : 'Conectado remotamente') : 'Desconectado') });
      },
    }),
    {
      name: 'oracle-dba-connection-state',
      partialize: (state) => ({ mode: state.mode, config: state.config, remote: state.remote }),
    }
  )
);
