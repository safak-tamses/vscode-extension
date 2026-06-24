export type Severity = 'BLOCKER' | 'CRITICAL' | 'MAJOR' | 'MINOR' | 'INFO';

export type IssueType = 'BUG' | 'VULNERABILITY' | 'CODE_SMELL';

export type VulnerabilityProbability = 'HIGH' | 'MEDIUM' | 'LOW';

export interface TextRange {
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
}

export interface SonarIssue {
  key: string;
  rule: string;
  severity: Severity;
  type: IssueType;
  /** SonarQube component key, ör. "proj:src/Foo.java" */
  component: string;
  project: string;
  line?: number;
  message: string;
  status: string;
  textRange?: TextRange;
}

export interface SonarRule {
  key: string;
  name: string;
  htmlDesc?: string;
  mdDesc?: string;
  severity?: Severity;
  type?: IssueType;
}

export interface SonarHotspot {
  key: string;
  component: string;
  project: string;
  securityCategory: string;
  vulnerabilityProbability: VulnerabilityProbability;
  line?: number;
  message: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  /** 1 tabanlı sayfa numarası */
  p: number;
  /** sayfa boyutu */
  ps: number;
}

/** SonarQube component key'inden dosya yolunu çıkarır ("proj:src/Foo.java" -> "src/Foo.java"). */
export function componentToPath(component: string): string {
  const idx = component.indexOf(':');
  return idx >= 0 ? component.slice(idx + 1) : component;
}
