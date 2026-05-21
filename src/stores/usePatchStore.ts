import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { QueryResult } from '../types/oracle';

type PatchValues = {
  oracleHome: string;
  oracleSid: string;
  patchDir: string;
  workRoot: string;
  listenerName: string;
  autoStartDb: boolean;
  openAllPdbs: boolean;
};

interface PatchState {
  values: PatchValues;
  busy: boolean;
  elapsedMs: number;
  patchLog: string[];
  logPath: string;
  result?: QueryResult;
  startedAt?: number;
  setValue: (key: keyof PatchValues, value: string | boolean) => void;
  setValues: (values: Partial<PatchValues>) => void;
  setBusy: (v:boolean)=>void;
  setElapsedMs: (v:number)=>void;
  addLog: (v:string)=>void;
  clearLogs: ()=>void;
  setLogPath: (v:string)=>void;
  setResult: (v?:QueryResult)=>void;
  setStartedAt: (v?:number)=>void;
}

const defaultValues: PatchValues = {
  oracleHome: 'D:\\ORACLE19\\APP\\ORACLE\\PRODUCT\\19.0.0\\DBHOME_1',
  oracleSid: 'ORCL19',
  patchDir: 'D:\\PATCH\\oracle19',
  workRoot: 'D:\\PATCH\\oracle19',
  listenerName: 'LISTENER',
  autoStartDb: true,
  openAllPdbs: false,
};

export const usePatchStore = create<PatchState>()(
  persist(
    (set)=>( {
      values: defaultValues,
      busy:false,
      elapsedMs:0,
      patchLog:[],
      logPath:'',
      result: undefined,
      startedAt: undefined,
      setValue:(key, value)=>set((state)=>({ values: { ...state.values, [key]: value } })),
      setValues:(values)=>set((state)=>({ values: { ...state.values, ...values } })),
      setBusy:(busy)=>set({busy}),
      setElapsedMs:(elapsedMs)=>set({elapsedMs}),
      addLog:(line)=>set((s)=>({patchLog:[...s.patchLog,line]})),
      clearLogs:()=>set({patchLog:[]}),
      setLogPath:(logPath)=>set({logPath}),
      setResult:(result)=>set({result}),
      setStartedAt:(startedAt)=>set({startedAt}),
    }),
    {
      name: 'oracle-dba-patch-state',
      partialize: (state) => ({
        values: state.values,
        busy: state.busy,
        elapsedMs: state.elapsedMs,
        patchLog: state.patchLog,
        logPath: state.logPath,
        result: state.result,
        startedAt: state.startedAt,
      }),
    }
  )
);
