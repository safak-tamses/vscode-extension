import * as vscode from 'vscode';
import { describeReasons } from '../coverage/gaps';
import type { CoverageGap } from '../coverage/gaps';
import { groupGaps } from './coverageGrouping';
import type { CoverageNode } from './coverageGrouping';

interface InfoEntry {
  kind: 'info';
  label: string;
  icon: string;
  command?: string;
}

type Entry = CoverageNode | InfoEntry;

const ALL_COVERED: InfoEntry = {
  kind: 'info',
  label: 'Eksik birim testi yok — eşikler karşılanıyor.',
  icon: 'pass'
};

/**
 * Eksik testleri modül › paket › sınıf › metot ağacında gösterir.
 * Tarama yapılmadan önce ağaç bilinçli olarak BOŞTUR; böylece package.json'daki
 * `viewsWelcome` içeriği (kural seti oluştur / tara düğmeleri) görünür.
 */
export class CoverageTreeProvider implements vscode.TreeDataProvider<Entry> {
  private readonly emitter = new vscode.EventEmitter<Entry | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private roots: Entry[] = [];

  setGaps(gaps: readonly CoverageGap[]): void {
    this.roots = gaps.length === 0 ? [ALL_COVERED] : groupGaps(gaps);
    this.emitter.fire();
  }

  reset(): void {
    this.roots = [];
    this.emitter.fire();
  }

  getChildren(element?: Entry): Entry[] {
    if (!element) {
      return this.roots;
    }
    return 'children' in element ? element.children : [];
  }

  getTreeItem(element: Entry): vscode.TreeItem {
    switch (element.kind) {
      case 'info': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(element.icon);
        if (element.command) {
          item.command = { command: element.command, title: element.label };
        }
        return item;
      }
      case 'module': {
        const item = new vscode.TreeItem(element.moduleName, vscode.TreeItemCollapsibleState.Expanded);
        item.description = `${element.gapCount} sınıf`;
        item.iconPath = new vscode.ThemeIcon('package');
        item.contextValue = 'coverageModule';
        return item;
      }
      case 'package': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon('symbol-namespace');
        item.contextValue = 'coveragePackage';
        return item;
      }
      case 'class': {
        const gap = element.gap;
        const state =
          element.children.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;
        const item = new vscode.TreeItem(gap.simpleName, state);
        item.description = `%${Math.round(gap.lineCoverage)}${gap.testExists ? '' : ' · test yok'}`;
        item.iconPath = coverageIcon(gap);
        item.contextValue = 'coverageGap';
        item.tooltip = new vscode.MarkdownString(
          [
            `**${gap.qualifiedName}**`,
            '',
            `satır %${Math.round(gap.lineCoverage)} (eşik %${gap.thresholds.line})`,
            `dal %${Math.round(gap.branchCoverage)} (eşik %${gap.thresholds.branch})`,
            `metot %${Math.round(gap.methodCoverage)} (eşik %${gap.thresholds.method})`,
            '',
            describeReasons(gap.reasons),
            '',
            `test: \`${gap.testPath}\`${gap.testExists ? '' : '  _(yok)_'}`
          ].join('\n')
        );
        item.command = {
          command: 'code-health.openGapSource',
          title: 'Kaynağı Aç',
          arguments: [{ gap }]
        };
        return item;
      }
      case 'method': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('symbol-method', new vscode.ThemeColor('errorForeground'));
        item.description = element.line !== undefined ? `satır ${element.line}` : 'test edilmemiş';
        item.contextValue = 'coverageMethod';
        item.command = {
          command: 'code-health.openGapSource',
          title: 'Kaynağı Aç',
          arguments: [{ gap: element.gap, line: element.line }]
        };
        return item;
      }
      default: {
        const exhaustive: never = element;
        return new vscode.TreeItem(String(exhaustive));
      }
    }
  }
}

function coverageIcon(gap: CoverageGap): vscode.ThemeIcon {
  if (!gap.testExists || gap.lineCoverage === 0) {
    return new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
  }
  if (gap.lineCoverage < gap.thresholds.line * 0.6) {
    return new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
  }
  return new vscode.ThemeIcon('info', new vscode.ThemeColor('charts.blue'));
}
