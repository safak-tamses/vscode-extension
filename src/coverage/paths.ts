import { normalizePath } from './glob';

/**
 * JaCoCo rapor yolundan Maven modül kökünü çıkarır (saf fonksiyon).
 * `modules/order-service/target/site/jacoco/jacoco.xml` -> `modules/order-service`
 * `target/site/jacoco/jacoco.xml` -> `""` (tek modüllü proje, workspace kökü)
 * `/target/` bulunamazsa raporun bulunduğu dizinin üstü kullanılır.
 */
export function moduleRootFromReportPath(reportPath: string): string {
  const path = normalizePath(reportPath);
  const marker = path.lastIndexOf('/target/');
  if (marker >= 0) {
    return path.slice(0, marker);
  }
  if (path.startsWith('target/')) {
    return '';
  }
  const segments = path.split('/');
  segments.pop();
  segments.pop();
  return segments.join('/');
}

/** Modül kökünün gösterilecek adı; kök modül için "(kök)". */
export function moduleNameOf(moduleRoot: string): string {
  const normalized = normalizePath(moduleRoot);
  if (normalized === '') {
    return '(kök)';
  }
  return normalized.split('/').filter(Boolean).pop() ?? normalized;
}

/** Boş parçaları atarak yol birleştirir. */
export function joinPath(...parts: string[]): string {
  return parts
    .map((p) => normalizePath(p))
    .filter((p) => p !== '')
    .join('/');
}

/** `<modül>/<sourceRoot>/<paket>/<Dosya>.java` */
export function sourcePathFor(
  moduleRoot: string,
  sourceRoot: string,
  packagePath: string,
  fileName: string
): string {
  return joinPath(moduleRoot, sourceRoot, packagePath, fileName);
}

/** `<modül>/<testRoot>/<paket>/<Sınıf><suffix>.java` */
export function testPathFor(
  moduleRoot: string,
  testRoot: string,
  packagePath: string,
  simpleClassName: string,
  suffix: string
): string {
  return joinPath(moduleRoot, testRoot, packagePath, `${simpleClassName}${suffix}.java`);
}

/**
 * Kaynak dosya yolundan sınıf bilgisini çıkarır. Rapor bulunmadığında (hiç test yok →
 * JaCoCo dosyası üretilmemiş) yalnızca kaynak listesinden boşluk üretmek için kullanılır.
 * Yol `<sourceRoot>` içermiyorsa `undefined` döner.
 */
export function classInfoFromSourcePath(
  filePath: string,
  sourceRoot: string
): { moduleRoot: string; packagePath: string; fileName: string; simpleName: string } | undefined {
  const path = normalizePath(filePath);
  const root = normalizePath(sourceRoot);
  const marker = root === '' ? -1 : path.lastIndexOf(`${root}/`);
  if (marker === -1) {
    return undefined;
  }
  const moduleRoot = normalizePath(path.slice(0, marker)).replace(/\/+$/, '');
  const rest = path.slice(marker + root.length + 1);
  const segments = rest.split('/');
  const fileName = segments.pop() ?? rest;
  return {
    moduleRoot,
    packagePath: segments.join('/'),
    fileName,
    simpleName: fileName.replace(/\.java$/i, '')
  };
}
