import { componentToPath } from '../sonar/types';
import type { SonarIssue, SonarRule } from '../sonar/types';
import { sanitizeHtml } from './sanitize';
import type { FindingView } from './messages';

/** Bir bulgu + kuralı, webview'a güvenli biçimde aktarılacak görünüme dönüştürür (saf). */
export function buildFindingView(
  issue: SonarIssue,
  rule: SonarRule | undefined,
  copilotAvailable: boolean
): FindingView {
  const rawDesc = rule?.htmlDesc ?? rule?.mdDesc ?? '<p>(Bu kural için açıklama alınamadı.)</p>';
  return {
    issueKey: issue.key,
    ruleKey: issue.rule,
    ruleName: rule?.name ?? issue.rule,
    severity: issue.severity,
    issueType: issue.type,
    message: issue.message,
    descriptionHtml: sanitizeHtml(rawDesc),
    filePath: componentToPath(issue.component),
    line: issue.textRange?.startLine ?? issue.line,
    copilotAvailable
  };
}
