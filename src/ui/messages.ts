import type { IssueType, Severity } from '../sonar/types';

/** Config ekranı form durumu (token hariç — token ayrı, gizli). */
export interface ConfigFormState {
  sonarUrl: string;
  projectKey: string;
  branch: string;
  authScheme: 'bearer' | 'basic';
}

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
  copilotAvailable: boolean;
}

// ---- Config paneli mesajları ----
export type ConfigToWebview =
  | { type: 'init'; form: ConfigFormState; hasToken: boolean }
  | { type: 'testResult'; ok: boolean; detail?: string }
  | { type: 'saved' }
  | { type: 'busy'; busy: boolean };

export type ConfigFromWebview =
  | { type: 'ready' }
  | { type: 'test'; form: ConfigFormState; token: string }
  | { type: 'save'; form: ConfigFormState; token: string };

// ---- Detay paneli mesajları ----
export type DetailToWebview =
  | { type: 'showFinding'; view: FindingView }
  | { type: 'busy'; busy: boolean }
  | { type: 'fixOutcome'; status: 'applied' | 'rejected' | 'error'; detail?: string };

export type DetailFromWebview =
  | { type: 'ready' }
  | { type: 'fix' }
  | { type: 'fixAll' }
  | { type: 'openLocation' };
