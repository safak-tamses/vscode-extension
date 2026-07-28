import type { IssueType, Severity } from '../sonar/types';

/** Aktif model sağlayıcının kullanıcıya gösterilen durumu. */
export interface ProviderStatus {
  id: 'copilot' | 'local';
  /** Ör. "GitHub Copilot" veya "Local LLM · qwen2.5-coder". */
  label: string;
  /** Şu anda çözüm/test üretebilir mi? */
  available: boolean;
  /** Erişilemiyorsa kullanıcıya gösterilecek yönlendirme. */
  hint?: string;
}

// ---------------------------------------------------------------- config ekranı

/** SonarQube bağlantı formu (token hariç — token ayrı, gizli). */
export interface SonarFormState {
  sonarUrl: string;
  projectKey: string;
  branch: string;
  authScheme: 'bearer' | 'basic';
}

/** Model sağlayıcı formu (API anahtarı hariç — o ayrı, gizli). */
export interface LlmFormState {
  provider: 'copilot' | 'local';
  copilotVendor: string;
  copilotFamily: string;
  localProtocol: 'openai' | 'ollama';
  localBaseUrl: string;
  localModel: string;
  localTemperature: number;
  localMaxOutputTokens: number;
  localTimeoutSec: number;
}

export interface RuleIssueView {
  line: number;
  message: string;
}

export interface RuleFileView {
  /** Workspace'e göreli yol. */
  path: string;
  ruleSetId?: string;
  name?: string;
  disabled: boolean;
  errors: RuleIssueView[];
  warnings: RuleIssueView[];
  /** Özet satırı: eşikler ve derleme komutu. */
  summary?: string;
}

export interface RulesView {
  /** Kural dizininin workspace'e göreli yolu. */
  dir: string;
  files: RuleFileView[];
  activeCount: number;
}

export type ConfigTarget = 'sonar' | 'llm' | 'rules';

export type ConfigToWebview =
  | {
      type: 'init';
      sonar: SonarFormState;
      llm: LlmFormState;
      hasSonarToken: boolean;
      hasLlmKey: boolean;
      rules: RulesView;
    }
  | { type: 'rules'; rules: RulesView }
  | { type: 'testResult'; target: 'sonar' | 'llm'; ok: boolean; detail?: string }
  | { type: 'saved'; target: 'sonar' | 'llm' }
  | { type: 'busy'; target: ConfigTarget; busy: boolean };

export type ConfigFromWebview =
  | { type: 'ready' }
  | { type: 'testSonar'; form: SonarFormState; token: string }
  | { type: 'saveSonar'; form: SonarFormState; token: string }
  | { type: 'testLlm'; form: LlmFormState; apiKey: string }
  | { type: 'saveLlm'; form: LlmFormState; apiKey: string }
  | { type: 'clearLlmKey' }
  | { type: 'reloadRules' }
  | { type: 'createSampleRules' }
  | { type: 'openRuleFile'; path: string };

// ------------------------------------------------------------ bulgu detay paneli

/** Detay panelinde gösterilen, webview'a güvenli biçimde aktarılan bulgu görünümü. */
export interface FindingView {
  issueKey: string;
  ruleKey: string;
  ruleName: string;
  severity: Severity;
  issueType: IssueType;
  message: string;
  /** rules/show'dan gelen güvenli HTML açıklama (kaynakta sanitize edilir). */
  descriptionHtml: string;
  filePath: string;
  line?: number;
  provider: ProviderStatus;
}

export type DetailToWebview =
  | { type: 'showFinding'; view: FindingView }
  | { type: 'busy'; busy: boolean }
  | { type: 'fixOutcome'; status: 'applied' | 'rejected' | 'error'; detail?: string };

export type DetailFromWebview =
  | { type: 'ready' }
  | { type: 'fix' }
  | { type: 'fixAll' }
  | { type: 'openLocation' };

// ------------------------------------------------------------ test kapsamı paneli

export interface GapView {
  /** Panel içinde kararlı kimlik. */
  id: string;
  ruleSetId: string;
  moduleName: string;
  qualifiedName: string;
  simpleName: string;
  packageName: string;
  sourcePath: string;
  testPath: string;
  testExists: boolean;
  lineCoverage: number;
  branchCoverage: number;
  methodCoverage: number;
  thresholds: { line: number; branch: number; method: number };
  /** Gösterilecek metot imzaları (kısaltılmış olabilir). */
  uncoveredMethods: string[];
  uncoveredMethodCount: number;
  totalMethods: number;
  /** Türkçeleştirilmiş sebep etiketleri. */
  reasons: string[];
  reportMissing: boolean;
}

export interface CoverageSummaryView {
  lineCoverage: number;
  branchCoverage: number;
  methodCoverage: number;
  moduleCount: number;
  classCount: number;
  gapCount: number;
}

export interface RuleSetView {
  id: string;
  name: string;
  sourceFile: string;
  thresholds: { line: number; branch: number; method: number };
  buildCommand: string;
}

export interface CoverageView {
  summary: CoverageSummaryView;
  /** En yüksek öncelikli kural setinin eşikleri (özet göstergeleri için). */
  thresholds: { line: number; branch: number; method: number };
  gaps: GapView[];
  ruleSets: RuleSetView[];
  /** Derleme durumu özeti. */
  buildSummary: string;
  problems: RuleIssueView[];
  blocker?: string;
  provider: ProviderStatus;
  /** Taramanın yapıldığı yerel saat (HH:MM). */
  scannedAt: string;
}

export type CoverageToWebview =
  | { type: 'showCoverage'; view: CoverageView }
  | { type: 'busy'; busy: boolean; message?: string }
  | { type: 'gapOutcome'; id: string; status: 'applied' | 'rejected' | 'error'; detail?: string };

export type CoverageFromWebview =
  | { type: 'ready' }
  | { type: 'scan'; build: boolean }
  | { type: 'generate'; id: string }
  | { type: 'openSource'; id: string }
  | { type: 'openTest'; id: string }
  | { type: 'configure' }
  | { type: 'createSampleRules' };
