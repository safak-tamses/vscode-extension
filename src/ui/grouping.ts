import { componentToPath } from '../sonar/types';
import type { Severity, SonarIssue } from '../sonar/types';

export interface IssueNode {
  kind: 'issue';
  label: string;
  issue: SonarIssue;
}

export interface SeverityNode {
  kind: 'severity';
  label: string;
  severity: Severity;
  count: number;
  children: IssueNode[];
}

export interface FileNode {
  kind: 'file';
  label: string;
  path: string;
  component: string;
  count: number;
  children: SeverityNode[];
}

export interface ProjectNode {
  kind: 'project';
  label: string;
  project: string;
  count: number;
  children: FileNode[];
}

export type FindingNode = ProjectNode | FileNode | SeverityNode | IssueNode;

/** Önem önceliği — yüksekten düşüğe. */
export const SEVERITY_ORDER: Severity[] = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'];

/** Bulguları proje > dosya > önem derecesi > bulgu hiyerarşisine dönüştürür (saf fonksiyon). */
export function groupFindings(issues: SonarIssue[]): ProjectNode[] {
  const byProject = new Map<string, Map<string, SonarIssue[]>>();
  for (const issue of issues) {
    let files = byProject.get(issue.project);
    if (!files) {
      files = new Map<string, SonarIssue[]>();
      byProject.set(issue.project, files);
    }
    const list = files.get(issue.component) ?? [];
    list.push(issue);
    files.set(issue.component, list);
  }

  const projectNodes: ProjectNode[] = [];
  for (const [project, files] of byProject) {
    const fileNodes: FileNode[] = [];
    for (const [component, fileIssues] of files) {
      fileNodes.push(buildFileNode(component, project, fileIssues));
    }
    fileNodes.sort((a, b) => a.path.localeCompare(b.path));
    const count = fileNodes.reduce((n, f) => n + f.count, 0);
    projectNodes.push({ kind: 'project', label: `${project} (${count})`, project, count, children: fileNodes });
  }
  projectNodes.sort((a, b) => a.project.localeCompare(b.project));
  return projectNodes;
}

function buildFileNode(component: string, project: string, fileIssues: SonarIssue[]): FileNode {
  const bySeverity = new Map<Severity, SonarIssue[]>();
  for (const fi of fileIssues) {
    const list = bySeverity.get(fi.severity) ?? [];
    list.push(fi);
    bySeverity.set(fi.severity, list);
  }
  const severityNodes: SeverityNode[] = SEVERITY_ORDER.filter((s) => bySeverity.has(s)).map((s) => {
    const list = bySeverity.get(s) ?? [];
    return {
      kind: 'severity',
      label: `${s} (${list.length})`,
      severity: s,
      count: list.length,
      children: list.map<IssueNode>((i) => ({ kind: 'issue', label: i.message, issue: i }))
    };
  });
  const path = componentToPath(component, project);
  return { kind: 'file', label: path, path, component, count: fileIssues.length, children: severityNodes };
}
