import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { QueryResult, ScriptExecutionLog } from '../types/oracle';

export type CurrentStatementState = {
  index: number;
  total: number;
  line: number;
  endLine: number;
  statement: string;
};

type TemplateModuleState = {
  values: Record<string, string>;
  templateId: string;
  result?: QueryResult;
  busy: boolean;
  elapsedMs: number;
  current?: CurrentStatementState;
  logs: ScriptExecutionLog[];
  startedAt?: number;
  cancelRequested: boolean;
};

type WorksheetState = {
  sql: string;
  result?: QueryResult;
  busy: boolean;
  elapsedMs: number;
  current?: CurrentStatementState;
  logs: ScriptExecutionLog[];
  startedAt?: number;
  cancelRequested: boolean;
};

type ModuleStateStore = {
  templates: Record<string, TemplateModuleState>;
  worksheet: WorksheetState;
  getTemplateState: (moduleKey: string, defaults: Record<string, string>, defaultTemplateId: string) => TemplateModuleState;
  patchTemplateState: (moduleKey: string, patch: Partial<TemplateModuleState>) => void;
  patchTemplateValues: (moduleKey: string, values: Record<string, string>) => void;
  patchWorksheet: (patch: Partial<WorksheetState>) => void;
  resetRuntime: (moduleKey: string) => void;
};

const defaultWorksheet: WorksheetState = {
  sql: 'SELECT * FROM dual;',
  result: undefined,
  busy: false,
  elapsedMs: 0,
  current: undefined,
  logs: [],
  startedAt: undefined,
  cancelRequested: false,
};

function createTemplateState(defaults: Record<string, string>, defaultTemplateId: string): TemplateModuleState {
  return {
    values: defaults,
    templateId: defaultTemplateId,
    result: undefined,
    busy: false,
    elapsedMs: 0,
    current: undefined,
    logs: [],
    startedAt: undefined,
    cancelRequested: false,
  };
}

export const useModuleStateStore = create<ModuleStateStore>()(
  persist(
    (set, get) => ({
      templates: {},
      worksheet: defaultWorksheet,

      getTemplateState: (moduleKey, defaults, defaultTemplateId) => {
        const existing = get().templates[moduleKey];
        if (existing) {
          const mergedValues = { ...defaults, ...existing.values };
          if (JSON.stringify(mergedValues) !== JSON.stringify(existing.values)) {
            set((state) => ({
              templates: {
                ...state.templates,
                [moduleKey]: { ...existing, values: mergedValues, templateId: existing.templateId || defaultTemplateId },
              },
            }));
            return { ...existing, values: mergedValues, templateId: existing.templateId || defaultTemplateId };
          }
          return existing;
        }

        const created = createTemplateState(defaults, defaultTemplateId);
        set((state) => ({ templates: { ...state.templates, [moduleKey]: created } }));
        return created;
      },

      patchTemplateState: (moduleKey, patch) =>
        set((state) => ({
          templates: {
            ...state.templates,
            [moduleKey]: {
              ...(state.templates[moduleKey] ?? createTemplateState({}, '')),
              ...patch,
            },
          },
        })),

      patchTemplateValues: (moduleKey, values) =>
        set((state) => ({
          templates: {
            ...state.templates,
            [moduleKey]: {
              ...(state.templates[moduleKey] ?? createTemplateState({}, '')),
              values: {
                ...(state.templates[moduleKey]?.values ?? {}),
                ...values,
              },
            },
          },
        })),

      patchWorksheet: (patch) =>
        set((state) => ({
          worksheet: {
            ...state.worksheet,
            ...patch,
          },
        })),

      resetRuntime: (moduleKey) =>
        set((state) => {
          const current = state.templates[moduleKey];
          if (!current) return state;
          return {
            templates: {
              ...state.templates,
              [moduleKey]: {
                ...current,
                busy: false,
                elapsedMs: 0,
                current: undefined,
                logs: [],
                result: undefined,
                startedAt: undefined,
                cancelRequested: false,
              },
            },
          };
        }),
    }),
    {
      name: 'oracle-dba-module-state',
      partialize: (state) => ({
        templates: state.templates,
        worksheet: state.worksheet,
      }),
    }
  )
);
