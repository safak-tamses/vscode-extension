import type { Paged, SonarHotspot, SonarIssue, SonarRule } from './types';

/** Düşük seviyeli HTTP portu (test edilebilirlik için enjekte edilir). */
export interface HttpClient {
  get(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }>;
}

export interface SonarConfig {
  baseUrl: string;
  projectKey: string;
  branch?: string;
  authScheme: 'bearer' | 'basic';
}

export class SonarApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'SonarApiError';
  }
}

type TokenProvider = () => Promise<string | undefined>;

interface IssuesSearchResponse {
  total?: number;
  p?: number;
  ps?: number;
  issues?: SonarIssue[];
}

interface RuleShowResponse {
  rule?: SonarRule;
}

interface HotspotsSearchResponse {
  paging?: { total?: number; pageIndex?: number; pageSize?: number };
  hotspots?: SonarHotspot[];
}

interface ValidateResponse {
  valid?: boolean;
}

interface SonarErrorBody {
  errors?: Array<{ msg?: string }>;
}

/**
 * Tipli SonarQube Web API istemcisi. Token SecretStorage'dan `getToken` ile alınır;
 * koda/loga yazılmaz. Tüm hatalar SonarApiError'a haritalanır.
 */
export class SonarClient {
  private readonly baseUrl: string;

  constructor(
    private readonly http: HttpClient,
    private readonly getToken: TokenProvider,
    private readonly cfg: SonarConfig
  ) {
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
  }

  async searchIssues(opts: { page?: number; pageSize?: number } = {}): Promise<Paged<SonarIssue>> {
    const p = opts.page ?? 1;
    const ps = opts.pageSize ?? 100;
    let url =
      `${this.baseUrl}/api/issues/search?componentKeys=${encodeURIComponent(this.cfg.projectKey)}` +
      `&resolved=false&ps=${ps}&p=${p}`;
    if (this.cfg.branch) {
      url += `&branch=${encodeURIComponent(this.cfg.branch)}`;
    }
    const json = this.parse<IssuesSearchResponse>(await this.request(url));
    const issues = json.issues ?? [];
    return { items: issues, total: json.total ?? issues.length, p: json.p ?? p, ps: json.ps ?? ps };
  }

  /** Sayfaları dolaşarak tüm açık bulguları çeker; `cap` sınırını aşmaz. */
  async searchAllIssues(cap = 500, pageSize = 500): Promise<SonarIssue[]> {
    const all: SonarIssue[] = [];
    let page = 1;
    while (all.length < cap) {
      const res = await this.searchIssues({ page, pageSize });
      all.push(...res.items);
      const fetched = page * res.ps;
      if (res.items.length === 0 || fetched >= res.total) {
        break;
      }
      page += 1;
    }
    return all.slice(0, cap);
  }

  /** Tek bir bulguyu anahtarına göre sorgular (fix sonrası durum doğrulaması için). */
  async findIssue(key: string): Promise<SonarIssue | undefined> {
    const url = `${this.baseUrl}/api/issues/search?issues=${encodeURIComponent(key)}&ps=1&p=1`;
    const json = this.parse<IssuesSearchResponse>(await this.request(url));
    return json.issues?.[0];
  }

  async showRule(key: string): Promise<SonarRule> {
    const url = `${this.baseUrl}/api/rules/show?key=${encodeURIComponent(key)}`;
    const json = this.parse<RuleShowResponse>(await this.request(url));
    const r = json.rule;
    if (!r) {
      throw new SonarApiError(404, `Kural bulunamadı: ${key}`);
    }
    return {
      key: r.key ?? key,
      name: r.name ?? key,
      htmlDesc: r.htmlDesc,
      mdDesc: r.mdDesc,
      severity: r.severity,
      type: r.type
    };
  }

  async searchHotspots(opts: { page?: number; pageSize?: number } = {}): Promise<Paged<SonarHotspot>> {
    const p = opts.page ?? 1;
    const ps = opts.pageSize ?? 100;
    let url =
      `${this.baseUrl}/api/hotspots/search?projectKey=${encodeURIComponent(this.cfg.projectKey)}` +
      `&ps=${ps}&p=${p}`;
    if (this.cfg.branch) {
      url += `&branch=${encodeURIComponent(this.cfg.branch)}`;
    }
    const json = this.parse<HotspotsSearchResponse>(await this.request(url));
    const hotspots = json.hotspots ?? [];
    const paging = json.paging ?? {};
    return {
      items: hotspots,
      total: paging.total ?? hotspots.length,
      p: paging.pageIndex ?? p,
      ps: paging.pageSize ?? ps
    };
  }

  /** Bağlantı + token doğrulaması. Hata fırlatmaz; sonucu raporlar. */
  async validateConnection(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const json = this.parse<ValidateResponse>(
        await this.request(`${this.baseUrl}/api/authentication/validate`)
      );
      if (json.valid === true) {
        return { ok: true };
      }
      return { ok: false, detail: 'Token doğrulanamadı (valid=false). Token veya yetkileri kontrol edin.' };
    } catch (err) {
      if (err instanceof SonarApiError) {
        return { ok: false, detail: err.message };
      }
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private async authHeader(): Promise<Record<string, string>> {
    const token = await this.getToken();
    if (!token) {
      throw new SonarApiError(
        0,
        'SonarQube token bulunamadı. "Kod Sağlığı: Bağlantıyı Yapılandır" ile token girin.'
      );
    }
    if (this.cfg.authScheme === 'basic') {
      return { Authorization: 'Basic ' + Buffer.from(`${token}:`).toString('base64') };
    }
    return { Authorization: `Bearer ${token}` };
  }

  private async request(url: string): Promise<string> {
    const headers: Record<string, string> = { Accept: 'application/json', ...(await this.authHeader()) };
    const res = await this.http.get(url, headers);
    if (res.status < 200 || res.status >= 300) {
      throw this.toError(res.status, res.body);
    }
    return res.body;
  }

  private parse<T>(body: string): T {
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new SonarApiError(0, 'SonarQube yanıtı çözümlenemedi (geçersiz JSON).');
    }
  }

  private toError(status: number, body: string): SonarApiError {
    let detail = '';
    try {
      const parsed = JSON.parse(body) as SonarErrorBody;
      detail = (parsed.errors ?? [])
        .map((e) => e.msg)
        .filter((m): m is string => Boolean(m))
        .join('; ');
    } catch {
      /* gövde JSON değilse yok say */
    }
    if (status === 401 || status === 403) {
      return new SonarApiError(
        status,
        `SonarQube kimlik doğrulaması başarısız (HTTP ${status}). ` +
          `Token geçersiz veya yetkisiz olabilir; "Kod Sağlığı: Bağlantıyı Yapılandır" ile kontrol edin.` +
          (detail ? ` Detay: ${detail}` : '')
      );
    }
    return new SonarApiError(status, `SonarQube isteği başarısız (HTTP ${status}).` + (detail ? ` ${detail}` : ''));
  }
}
