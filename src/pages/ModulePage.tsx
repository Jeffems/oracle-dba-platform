import { SqlTemplatePanel } from '../components/common/SqlTemplatePanel';
import { moduleDefinitions } from '../modules/oracleTemplates';

type ModuleKey = keyof typeof moduleDefinitions;

export function ModulePage({ moduleKey }: { moduleKey: ModuleKey }) {
  const module = moduleDefinitions[moduleKey];
  return <SqlTemplatePanel {...module} />;
}
