import { parseRuleSet } from './rules';
import type { RuleIssue, TestRuleSet } from './rules';

/** Kural dosyalarını okuyan port; gerçek implementasyon `vscode.workspace.fs` ile bağlanır. */
export interface RuleFileSystem {
  /** Verilen dizindeki `.md` dosyalarının workspace köküne göreli yollarını döndürür. */
  listRuleFiles(dir: string): Promise<string[]>;
  readFile(relPath: string): Promise<string>;
}

export interface RuleFileReport {
  path: string;
  ruleSetId?: string;
  /** Kural seti `enabled: false` ile kapatılmışsa true. */
  disabled: boolean;
  errors: RuleIssue[];
  warnings: RuleIssue[];
}

export interface LoadedRules {
  /** Geçerli ve etkin kural setleri; önce yüksek `priority`, sonra `id` sırasıyla. */
  ruleSets: TestRuleSet[];
  /** Her kural dosyasının durumu (kurulum ekranında gösterilir). */
  files: RuleFileReport[];
  hasErrors: boolean;
}

/**
 * Kural dizinindeki tüm `.md` dosyalarını okur, ayrıştırır ve doğrular.
 * Hatalı bir dosya diğerlerini engellemez; hatası kullanıcıya raporlanır.
 */
export async function loadRuleSets(fs: RuleFileSystem, dir: string): Promise<LoadedRules> {
  const paths = (await fs.listRuleFiles(dir)).slice().sort((a, b) => a.localeCompare(b));
  const files: RuleFileReport[] = [];
  const ruleSets: TestRuleSet[] = [];
  const seenIds = new Map<string, string>();

  for (const path of paths) {
    let text: string;
    try {
      text = await fs.readFile(path);
    } catch (err) {
      files.push({
        path,
        disabled: false,
        errors: [{ line: 0, message: `Dosya okunamadı: ${err instanceof Error ? err.message : String(err)}` }],
        warnings: []
      });
      continue;
    }

    const parsed = parseRuleSet(text, path);
    const report: RuleFileReport = {
      path,
      ruleSetId: parsed.ruleSet?.id,
      disabled: parsed.ruleSet ? !parsed.ruleSet.enabled : false,
      errors: [...parsed.errors],
      warnings: [...parsed.warnings]
    };

    if (parsed.ruleSet) {
      const previous = seenIds.get(parsed.ruleSet.id);
      if (previous) {
        report.errors.push({
          line: 0,
          message: `"${parsed.ruleSet.id}" kimliği "${previous}" dosyasında da kullanılmış; kimlikler benzersiz olmalı.`
        });
      } else {
        seenIds.set(parsed.ruleSet.id, path);
        if (parsed.ruleSet.enabled) {
          ruleSets.push(parsed.ruleSet);
        }
      }
    }
    files.push(report);
  }

  ruleSets.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return { ruleSets, files, hasErrors: files.some((f) => f.errors.length > 0) };
}
