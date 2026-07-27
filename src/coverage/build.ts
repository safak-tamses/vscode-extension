import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { CancelSignal } from '../llm/gateway';

export interface BuildOptions {
  timeoutSec: number;
  /** Canlı çıktı; Output kanalına akıtmak için. */
  onOutput?: (chunk: string) => void;
  cancel?: CancelSignal;
  env?: NodeJS.ProcessEnv;
}

export interface BuildResult {
  /** Çıkış kodu; süreç sinyalle sonlandıysa null. */
  code: number | null;
  ok: boolean;
  durationMs: number;
  /** stdout + stderr birleşik çıktı (son MAX_OUTPUT_CHARS karakter). */
  output: string;
  timedOut: boolean;
  cancelled: boolean;
}

/** Derleme komutunu çalıştıran port; testlerde sahte çalıştırıcı enjekte edilir. */
export interface BuildRunner {
  run(command: string, cwd: string, options: BuildOptions): Promise<BuildResult>;
}

const MAX_OUTPUT_CHARS = 200_000;
const KILL_GRACE_MS = 5_000;

/** Süreci (ve alt süreçlerini) sonlandırır; kabuk üzerinden çalıştığı için süreç grubu hedeflenir. */
function terminate(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    }
    process.kill(-pid, 'SIGTERM');
    setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // Süreç zaten sonlanmış.
      }
    }, KILL_GRACE_MS).unref();
  } catch {
    child.kill('SIGKILL');
  }
}

/**
 * Kural dosyasındaki derleme komutunu çalıştırır (ör. `mvn clean install`).
 *
 * GÜVENLİK: komut workspace içeriğinden gelir. Bu sınıf komutu doğrulamaz; çağıran katman
 * `ensureBuildConsent` ile Workspace Trust ve açık kullanıcı onayını garanti etmek zorundadır.
 */
export class NodeBuildRunner implements BuildRunner {
  run(command: string, cwd: string, options: BuildOptions): Promise<BuildResult> {
    return new Promise<BuildResult>((resolve) => {
      const startedAt = Date.now();
      let output = '';
      let timedOut = false;
      let cancelled = false;
      let settled = false;

      const append = (chunk: Buffer | string): void => {
        const text = chunk.toString();
        options.onOutput?.(text);
        output += text;
        if (output.length > MAX_OUTPUT_CHARS) {
          output = output.slice(-MAX_OUTPUT_CHARS);
        }
      };

      let child: ChildProcess;
      try {
        child = spawn(command, {
          cwd,
          shell: true,
          env: options.env ?? process.env,
          detached: process.platform !== 'win32'
        });
      } catch (err) {
        resolve({
          code: null,
          ok: false,
          durationMs: Date.now() - startedAt,
          output: `Derleme komutu başlatılamadı: ${err instanceof Error ? err.message : String(err)}`,
          timedOut: false,
          cancelled: false
        });
        return;
      }

      child.stdout?.on('data', append);
      child.stderr?.on('data', append);

      const timer = setTimeout(
        () => {
          timedOut = true;
          append(`\n[kod-sağlığı] Zaman aşımı (${options.timeoutSec} sn); derleme sonlandırılıyor.\n`);
          terminate(child);
        },
        Math.max(1, options.timeoutSec) * 1000
      );
      const sub = options.cancel?.onCancellationRequested(() => {
        cancelled = true;
        append('\n[kod-sağlığı] Kullanıcı iptal etti; derleme sonlandırılıyor.\n');
        terminate(child);
      });

      const finish = (code: number | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        sub?.dispose();
        resolve({
          code,
          ok: code === 0 && !timedOut && !cancelled,
          durationMs: Date.now() - startedAt,
          output,
          timedOut,
          cancelled
        });
      };

      child.on('error', (err: Error) => {
        append(`\n[kod-sağlığı] Derleme komutu çalıştırılamadı: ${err.message}\n`);
        finish(null);
      });
      child.on('close', (code) => finish(code));
    });
  }
}

/**
 * Maven/JVM çıktısından derleyici hatalarını süzer; onarım isteminde tam log yerine
 * yalnızca ilgili satırlar kullanılır.
 */
export function extractCompilerErrors(output: string, maxLines = 60): string {
  const lines = output.split(/\r?\n/);
  const interesting = lines.filter((line) =>
    /(\[ERROR\]|ERROR\]|error:|cannot find symbol|COMPILATION ERROR|Tests run:|expected:|BUILD FAILURE)/i.test(line)
  );
  const picked = (interesting.length > 0 ? interesting : lines.slice(-maxLines)).slice(0, maxLines);
  return picked.join('\n').trim();
}
