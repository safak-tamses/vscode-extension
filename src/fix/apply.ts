/**
 * Bir dosya metninin [startLine, endLine] (1-tabanlı, dahil) aralığını newCode ile değiştirir.
 * Diff önizlemesi için önerilen tam dosya içeriğini üretir (saf fonksiyon).
 */
export function spliceLines(fileText: string, startLine: number, endLine: number, newCode: string): string {
  const lines = fileText.split('\n');
  const before = lines.slice(0, startLine - 1);
  const after = lines.slice(endLine);
  return [...before, ...newCode.split('\n'), ...after].join('\n');
}
