import * as vscode from 'vscode';
import type { FindingNode, ProjectNode } from './grouping';
import type { Severity } from '../sonar/types';

interface ActionEntry {
  kind: 'action';
  label: string;
  command: string;
  icon: string;
}

interface InfoEntry {
  kind: 'info';
  label: string;
  icon?: string;
}

type Entry = FindingNode | ActionEntry | InfoEntry;

const CONFIGURE_ENTRY: ActionEntry = {
  kind: 'action',
  label: 'Bağlantıyı yapılandırın',
  command: 'code-health.configure',
  icon: 'gear'
};

/** Bulguları proje > dosya > önem > bulgu ağacında gösterir; yapılandırma yoksa yönlendirme verir. */
export class FindingsTreeProvider implements vscode.TreeDataProvider<Entry> {
  private readonly emitter = new vscode.EventEmitter<Entry | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private roots: Entry[] = [CONFIGURE_ENTRY];

  setConfigured(configured: boolean): void {
    if (!configured) {
      this.roots = [CONFIGURE_ENTRY];
      this.emitter.fire();
    }
  }

  setFindings(projects: ProjectNode[]): void {
    this.roots =
      projects.length > 0
        ? projects
        : [{ kind: 'info', label: 'Bulgu bulunamadı. Yeniden taramak için yenileyin.', icon: 'check' }];
    this.emitter.fire();
  }

  getChildren(element?: Entry): Entry[] {
    if (!element) {
      return this.roots;
    }
    if ('children' in element) {
      return element.children;
    }
    return [];
  }

  getTreeItem(element: Entry): vscode.TreeItem {
    switch (element.kind) {
      case 'action': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.command = { command: element.command, title: element.label };
        item.iconPath = new vscode.ThemeIcon(element.icon);
        return item;
      }
      case 'info': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        if (element.icon) {
          item.iconPath = new vscode.ThemeIcon(element.icon);
        }
        return item;
      }
      case 'project': {
        const item = new vscode.TreeItem(element.project, vscode.TreeItemCollapsibleState.Expanded);
        item.description = `${element.count} bulgu`;
        item.iconPath = new vscode.ThemeIcon('repo');
        item.contextValue = 'project';
        return item;
      }
      case 'file': {
        const item = new vscode.TreeItem(element.path, vscode.TreeItemCollapsibleState.Expanded);
        item.resourceUri = vscode.Uri.file(element.path);
        item.iconPath = vscode.ThemeIcon.File;
        item.description = `${element.count}`;
        item.contextValue = 'file';
        return item;
      }
      case 'severity': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = severityIcon(element.severity);
        item.contextValue = 'severity';
        return item;
      }
      case 'issue': {
        const item = new vscode.TreeItem(element.issue.message, vscode.TreeItemCollapsibleState.None);
        item.description = element.issue.rule;
        item.iconPath = severityIcon(element.issue.severity);
        item.contextValue = 'issue';
        item.tooltip = `${element.issue.rule} · ${element.issue.severity}\n${element.issue.message}`;
        item.command = { command: 'code-health.openFinding', title: 'Aç', arguments: [element.issue] };
        return item;
      }
      default: {
        const exhaustive: never = element;
        return new vscode.TreeItem(String(exhaustive));
      }
    }
  }
}

function severityIcon(sev: Severity): vscode.ThemeIcon {
  switch (sev) {
    case 'BLOCKER':
    case 'CRITICAL':
      return new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
    case 'MAJOR':
      return new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
    case 'MINOR':
    case 'INFO':
      return new vscode.ThemeIcon('info', new vscode.ThemeColor('charts.blue'));
    default: {
      const exhaustive: never = sev;
      return new vscode.ThemeIcon(String(exhaustive));
    }
  }
}
