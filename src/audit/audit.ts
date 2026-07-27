import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export type AuditEventType =
  | 'suggestion'
  | 'accept'
  | 'reject'
  | 'rescan'
  | 'error'
  | 'rules-load'
  | 'coverage-scan'
  | 'build'
  | 'test-suggestion'
  | 'test-accept'
  | 'test-reject'
  | 'test-verify';

export interface AuditEvent {
  type: AuditEventType;
  /** ISO-8601 zaman damgası */
  at: string;
  actor: string;
  ruleKey?: string;
  issueKey?: string;
  file?: string;
  detail?: string;
  /** Kullanılan model sağlayıcı ("copilot" | "local"). */
  provider?: string;
  /** Model etiketi; gizli değer içermez. */
  model?: string;
  durationMs?: number;
}

/** record()'a verilen girdi — `at` ve `actor` logger tarafından doldurulur. */
export interface AuditInput {
  type: AuditEventType;
  ruleKey?: string;
  issueKey?: string;
  file?: string;
  detail?: string;
  provider?: string;
  model?: string;
  durationMs?: number;
}

export interface FileAppender {
  append(line: string): Promise<void>;
}

export interface OutputSink {
  line(text: string): void;
}

export interface Clock {
  now(): Date;
}

/** Denetim kaydı yazıcı arayüzü (test edilebilirlik için). */
export interface AuditSink {
  record(input: AuditInput): Promise<void>;
}

const REAL_CLOCK: Clock = { now: () => new Date() };

/**
 * Yapılandırılmış denetim kaydı: her olay JSONL satırı olarak eklenir ve
 * okunur bir satır Output kanalına yazılır. Token gibi gizli alanlar AuditEvent
 * şemasında bulunmadığından kayda asla sızmaz.
 */
export class AuditLogger implements AuditSink {
  constructor(
    private readonly appender: FileAppender,
    private readonly output: OutputSink,
    private readonly actor: string,
    private readonly clock: Clock = REAL_CLOCK
  ) {}

  async record(input: AuditInput): Promise<void> {
    const event: AuditEvent = {
      type: input.type,
      at: this.clock.now().toISOString(),
      actor: this.actor,
      ...(input.ruleKey ? { ruleKey: input.ruleKey } : {}),
      ...(input.issueKey ? { issueKey: input.issueKey } : {}),
      ...(input.file ? { file: input.file } : {}),
      ...(input.detail ? { detail: input.detail } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {})
    };
    try {
      await this.appender.append(JSON.stringify(event));
    } catch (err) {
      // Denetim kaydı yazılamazsa Output'a düş; akışı bozma.
      this.output.line(`[audit-write-error] ${err instanceof Error ? err.message : String(err)}`);
    }
    this.output.line(format(event));
  }
}

function format(event: AuditEvent): string {
  const parts = [`[${event.at}]`, event.type.toUpperCase(), `actor=${event.actor}`];
  if (event.ruleKey) {
    parts.push(`rule=${event.ruleKey}`);
  }
  if (event.issueKey) {
    parts.push(`issue=${event.issueKey}`);
  }
  if (event.file) {
    parts.push(`file=${event.file}`);
  }
  if (event.provider) {
    parts.push(`provider=${event.provider}`);
  }
  if (event.model) {
    parts.push(`model=${event.model}`);
  }
  if (event.durationMs !== undefined) {
    parts.push(`durationMs=${event.durationMs}`);
  }
  if (event.detail) {
    parts.push(`detail=${event.detail}`);
  }
  return parts.join(' ');
}

/** JSONL satırlarını (newline ile) dosyaya ekleyen gerçek appender; dizini oluşturur. */
export class FsFileAppender implements FileAppender {
  constructor(private readonly path: string) {}

  async append(line: string): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, line + '\n', 'utf8');
  }
}
