import type { CoverageGap } from '../coverage/gaps';

export interface MethodEntry {
  kind: 'method';
  label: string;
  gap: CoverageGap;
  line?: number;
}

export interface ClassEntry {
  kind: 'class';
  label: string;
  gap: CoverageGap;
  children: MethodEntry[];
}

export interface PackageEntry {
  kind: 'package';
  label: string;
  children: ClassEntry[];
}

export interface ModuleEntry {
  kind: 'module';
  label: string;
  moduleName: string;
  gapCount: number;
  children: PackageEntry[];
}

export type CoverageNode = ModuleEntry | PackageEntry | ClassEntry | MethodEntry;

/**
 * Kapsam boşluklarını modül › paket › sınıf › metot hiyerarşisine dönüştürür (saf fonksiyon).
 * Modüller en çok boşluğa, sınıflar en yüksek aciliyet skoruna göre sıralanır.
 */
export function groupGaps(gaps: readonly CoverageGap[]): ModuleEntry[] {
  const modules = new Map<string, Map<string, ClassEntry[]>>();
  for (const gap of gaps) {
    const packages = modules.get(gap.moduleName) ?? new Map<string, ClassEntry[]>();
    modules.set(gap.moduleName, packages);
    const packageName = gap.packageName || '(varsayılan paket)';
    const classes = packages.get(packageName) ?? [];
    classes.push({
      kind: 'class',
      label: gap.simpleName,
      gap,
      children: gap.uncoveredMethods.map<MethodEntry>((m) => ({
        kind: 'method',
        label: m.signature,
        gap,
        ...(m.line !== undefined ? { line: m.line } : {})
      }))
    });
    packages.set(packageName, classes);
  }

  const out: ModuleEntry[] = [];
  for (const [moduleName, packages] of modules) {
    const packageEntries: PackageEntry[] = [];
    let gapCount = 0;
    for (const [label, classes] of packages) {
      classes.sort((a, b) => b.gap.score - a.gap.score || a.label.localeCompare(b.label));
      gapCount += classes.length;
      packageEntries.push({ kind: 'package', label, children: classes });
    }
    packageEntries.sort((a, b) => a.label.localeCompare(b.label));
    out.push({ kind: 'module', label: moduleName, moduleName, gapCount, children: packageEntries });
  }
  out.sort((a, b) => b.gapCount - a.gapCount || a.moduleName.localeCompare(b.moduleName));
  return out;
}
