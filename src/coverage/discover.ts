import * as vscode from 'vscode';
import * as path from 'node:path';
import { isIncluded, normalizePath } from './glob';
import { JacocoParseError, parseJacocoXml } from './jacoco';
import { moduleRootFromReportPath } from './paths';
import type { ModuleReport } from './gaps';
import type { TestRuleSet } from './rules';

/** Kaynak/test taramasında atlanacak dizinler (raporlar hariç — onlar `target` içindedir). */
const SOURCE_EXCLUDE = '**/{node_modules,build,out,dist,.git,.idea,target}/**';

export interface DiscoveryProblem {
  path: string;
  message: string;
}

export interface DiscoveryResult {
  modules: ModuleReport[];
  /** Kural setlerinin kapsadığı, workspace'te bulunan kaynak dosyalar. */
  sourceFiles: string[];
  /** Workspace'te bulunan test dosyaları. */
  testFiles: string[];
  /** Okunamayan/ayrıştırılamayan rapor dosyaları. */
  problems: DiscoveryProblem[];
}

function relativeTo(root: vscode.Uri, uri: vscode.Uri): string {
  return normalizePath(path.relative(root.fsPath, uri.fsPath));
}

async function findAll(root: vscode.Uri, pattern: string, exclude: string | null): Promise<vscode.Uri[]> {
  return vscode.workspace.findFiles(new vscode.RelativePattern(root, pattern), exclude);
}

/**
 * Kural setlerine göre JaCoCo raporlarını, kaynak dosyaları ve test dosyalarını bulur.
 * Rapor bulunamaması hata değildir: bu durumda tüm kaynaklar kapsanmamış sayılır.
 */
export async function discoverCoverage(
  root: vscode.Uri,
  ruleSets: TestRuleSet[]
): Promise<DiscoveryResult> {
  const problems: DiscoveryProblem[] = [];
  const modules: ModuleReport[] = [];
  const seenReports = new Set<string>();

  for (const pattern of unique(ruleSets.map((rs) => rs.coverage.reportPath))) {
    let uris: vscode.Uri[];
    try {
      uris = await findAll(root, pattern, null);
    } catch (err) {
      problems.push({ path: pattern, message: describe(err) });
      continue;
    }
    for (const uri of uris) {
      const relPath = relativeTo(root, uri);
      if (seenReports.has(relPath)) {
        continue;
      }
      seenReports.add(relPath);
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const report = parseJacocoXml(new TextDecoder('utf-8').decode(bytes));
        modules.push({ moduleRoot: moduleRootFromReportPath(relPath), reportPath: relPath, report });
      } catch (err) {
        problems.push({
          path: relPath,
          message: err instanceof JacocoParseError ? err.message : describe(err)
        });
      }
    }
  }

  const sourceFiles = new Set<string>();
  for (const ruleSet of ruleSets) {
    for (const pattern of ruleSet.include) {
      let uris: vscode.Uri[];
      try {
        uris = await findAll(root, pattern, SOURCE_EXCLUDE);
      } catch (err) {
        problems.push({ path: pattern, message: describe(err) });
        continue;
      }
      for (const uri of uris) {
        const relPath = relativeTo(root, uri);
        if (isIncluded(relPath, ruleSet.include, ruleSet.exclude)) {
          sourceFiles.add(relPath);
        }
      }
    }
  }

  const testFiles = new Set<string>();
  for (const testRoot of unique(ruleSets.map((rs) => normalizePath(rs.test.testRoot)))) {
    if (testRoot === '') {
      continue;
    }
    try {
      for (const uri of await findAll(root, `**/${testRoot}/**/*.java`, SOURCE_EXCLUDE)) {
        testFiles.add(relativeTo(root, uri));
      }
    } catch (err) {
      problems.push({ path: testRoot, message: describe(err) });
    }
  }

  modules.sort((a, b) => a.reportPath.localeCompare(b.reportPath));
  return {
    modules,
    sourceFiles: [...sourceFiles].sort(),
    testFiles: [...testFiles].sort(),
    problems
  };
}

/**
 * Derleme komutunun çalıştırılacağı dizini bulur: en üstteki `pom.xml`'in bulunduğu klasör.
 * Çok modüllü projede kök reaktör tüm modülleri derler ve her modülün raporunu üretir.
 * POM bulunamazsa workspace kökü kullanılır.
 */
export async function findBuildRoot(root: vscode.Uri): Promise<string> {
  const poms = await findAll(root, '**/pom.xml', SOURCE_EXCLUDE);
  const dirs = poms
    .map((uri) => normalizePath(path.dirname(relativeTo(root, uri))))
    .map((dir) => (dir === '.' ? '' : dir));
  if (dirs.length === 0) {
    return '';
  }
  // En az segment içeren yol = en üstteki modül.
  dirs.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  return dirs[0] ?? '';
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.trim() !== ''))];
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
