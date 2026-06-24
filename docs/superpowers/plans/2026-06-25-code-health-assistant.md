# Akıllı Kod Sağlığı Asistanı — Implementation Plan

> **For agentic workers:** Bu plan inline (executing-plans) ile bu oturumda uygulanır. Adımlar checkbox (`- [ ]`) ile takip edilir. Çekirdek iş mantığı TDD ile yazılır; VS Code glue ince tutulur ve mantık saf fonksiyonlara çekilip test edilir.

**Goal:** SonarQube Enterprise bulgularını VS Code içinde gösteren, GitHub Copilot (`vscode.lm`) ile fix öneren, her değişikliği diff + gerekçe ile onaya sunan (otomatik merge yok), kullanıcının bağlantı bilgilerini bir config ekranından girip kaydettiği, pilota hazır paketlenebilir (`.vsix`) bir eklenti.

**Architecture:** Temiz katmanlı, tek yönlü bağımlılık (`ui → fix → sonar`; `audit` her katmandan çağrılır). Her katman bağımlılıklarını constructor/port (arayüz) ile alır; `extension.ts` gerçek `vscode` implementasyonlarını bağlar, testler sahte (fake) implementasyon verir (Dependency Inversion). Webview'lar bağımlılıksız vanilla TS + tipli postMessage.

**Tech Stack:** TypeScript (strict) · VS Code Extension API (`engines.vscode ^1.90.0`) · esbuild (eklenti + webview bundling) · `node:test` + `tsx` (birim test) · `@vscode/vsce` (paketleme). Runtime bağımlılığı: **yok**.

## Global Constraints

- **OTOMATIK MERGE YOK.** Hiçbir kod değişikliği kullanıcı onayı olmadan dosyaya yazılmaz; her fix önce diff olarak gösterilir.
- **Config-gating:** Bağlantı bilgileri (SonarQube URL + projectKey + token) girilip kaydedilmeden tarama/çözüm işlemleri yapılamaz; kullanıcı önce config ekranına yönlendirilir.
- **Token YALNIZCA SecretStorage'da.** Koda / loga / settings / audit kaydına yazılmaz (audit'te redakte).
- **Her öneri ve onay audit'e işlenir** (kim, ne zaman, hangi kural/dosya, karar).
- **TypeScript strict; `any` yasak.** Tüm dış çağrılar (Sonar, lm) try/catch + kullanıcıya anlamlı hata.
- **Yeni davranış için test.** Çekirdek mantıkta hedef >%80; TDD.
- **Webview güvenliği:** CSP + nonce, uzak kaynak yok, tüm dinamik HTML escape.
- Komutlar: `npm run compile` · `npm test` · `npm run lint` · `npm run package`.

---

## File Structure

```
code-health-assistant/  (= mevcut /Users/safaktamses/Desktop/vscode-extension)
├─ package.json              # eklenti manifesti: contributes (view, commands, menus, configuration), engines, scripts
├─ tsconfig.json             # strict
├─ esbuild.mjs               # eklenti (node/cjs) + webview (browser/iife) bundle
├─ .eslintrc.json            # lint
├─ .gitignore                # node_modules, out, dist, *.vsix, .code-health/
├─ .vscodeignore             # .vsix'i yalın tutar
├─ CLAUDE.md                 # plandaki proje hafızası şablonu
├─ .mcp.json                 # SonarQube MCP (geliştirme aracı; takımla paylaşılan)
├─ .claude/
│  ├─ settings.json          # izinler + PostToolUse hook (lint+compile)
│  ├─ commands/fix-rule.md
│  ├─ commands/review-diff.md
│  └─ agents/reviewer.md
├─ README.md                 # kurulum + pilot kullanım notu
├─ src/
│  ├─ extension.ts           # activate/deactivate; DI wiring; komut/view/webview kaydı; config-gating
│  ├─ config.ts              # ConfigStore: settings oku/yaz, isComplete(), token SecretReader üzerinden
│  ├─ sonar/
│  │  ├─ types.ts            # Severity, IssueType, SonarIssue, SonarRule, SonarHotspot, Paged<T>, arama paramları
│  │  └─ client.ts           # SonarClient: searchIssues/showRule/searchHotspots/validateConnection; auth; paging; hata
│  ├─ ui/
│  │  ├─ grouping.ts         # SAF: bulgu[] -> proje>dosya>önem ağacı
│  │  ├─ tree.ts             # FindingsTreeProvider (TreeDataProvider) + ikon/önem
│  │  ├─ configPanel.ts      # Config webview (form + Bağlantıyı Test Et + Kaydet)
│  │  ├─ detailPanel.ts      # Bulgu detay webview (kural/önem/mesaj/açıklama/konum + Çöz/Tümünü Çöz)
│  │  ├─ messages.ts         # tipli postMessage protokolü (config + detail)
│  │  ├─ html.ts             # SAF: nonce, escapeHtml, getWebviewHtml(csp...)
│  │  └─ webview/
│  │     ├─ config.ts        # config ekranı tarafı (vanilla TS)
│  │     ├─ detail.ts        # detay ekranı tarafı (vanilla TS)
│  │     └─ styles.css       # --vscode-* tema değişkenleriyle tutarlı stil
│  ├─ fix/
│  │  ├─ context.ts          # SAF: buildFixContext(issue, ruleDesc, fileText, padding)
│  │  ├─ parse.ts            # SAF: parseFixResponse(raw) -> {newCode, rationale}
│  │  ├─ orchestrator.ts     # FixOrchestrator: lm çağrısı -> öneri; uygulama YOK; audit 'suggestion'
│  │  └─ diff.ts             # diff önizleme + Uygula/Reddet -> WorkspaceEdit; audit accept/reject
│  └─ audit/
│     ├─ secrets.ts          # SecretReader portu + VscodeSecretVault
│     └─ audit.ts            # AuditEvent + AuditLogger (JSONL appender + OutputChannel); FileAppender portu
└─ test/
   ├─ sonar/client.test.ts
   ├─ fix/context.test.ts
   ├─ fix/parse.test.ts
   ├─ fix/orchestrator.test.ts
   ├─ ui/grouping.test.ts
   ├─ ui/html.test.ts
   ├─ audit/audit.test.ts
   └─ config.test.ts
```

---

## M1 — İskelet + Config Store + Secrets + Sonar İstemcisi

**Hedef:** Derlenen/test edilen iskelet; tipli SonarQube istemcisi; config store; SecretStorage. `npm run compile` + `npm test` yeşil.

### Task 1.1: Proje iskeleti ve toolchain

**Files:** Create `package.json`, `tsconfig.json`, `esbuild.mjs`, `.eslintrc.json`, `.gitignore`, `.vscodeignore`, `CLAUDE.md`, `.mcp.json`, `.claude/settings.json`, `.claude/commands/fix-rule.md`, `.claude/commands/review-diff.md`, `.claude/agents/reviewer.md`

- [ ] `git init` (mevcut dizinde), `.gitignore` ekle.
- [ ] `package.json`: `engines.vscode ^1.90.0`, scripts (`compile`=esbuild, `watch`, `test`=`node --import tsx --test`, `lint`=eslint, `package`=`vsce package`), devDeps (`@types/vscode@^1.90.0`, `@types/node`, `typescript`, `esbuild`, `tsx`, `eslint`, `@typescript-eslint/*`, `@vscode/vsce`). `contributes`: viewsContainer (activity bar), view `codeHealthFindings`, commands, menus, configuration (`codeHealth.sonarUrl`, `projectKey`, `branch`, `authScheme`, `auditLogPath`, `snippetPadding`, `copilotVendor`, `maxIssues`).
- [ ] `tsconfig.json`: strict, `noUncheckedIndexedAccess`, `module nodenext`/`bundler`, `types: ["node","vscode"]`.
- [ ] `esbuild.mjs`: iki build — (a) `src/extension.ts` → `dist/extension.js` (platform node, format cjs, external `vscode`); (b) `src/ui/webview/config.ts` & `detail.ts` → `dist/webview/*.js` (platform browser, format iife). CSS kopyala.
- [ ] CLAUDE.md = plandaki şablon; `.mcp.json` SonarQube MCP; `.claude/*` plandaki komut/agent içerikleri.
- [ ] **Kabul:** `npm install` çalışır; `npm run compile` boş `src` ile hata vermez (placeholder `extension.ts` ile). Commit.

### Task 1.2: Sonar tipleri ve istemci (TDD)

**Files:** Create `src/sonar/types.ts`, `src/sonar/client.ts`, `test/sonar/client.test.ts`

**Interfaces / Produces:**
- `type Severity = 'BLOCKER'|'CRITICAL'|'MAJOR'|'MINOR'|'INFO'`
- `type IssueType = 'BUG'|'VULNERABILITY'|'CODE_SMELL'`
- `interface SonarIssue { key; rule; severity: Severity; type: IssueType; component; project; line?; message; textRange?: {startLine;endLine;startOffset;endOffset}; status; }`
- `interface SonarRule { key; name; htmlDesc?; mdDesc?; severity; type; }`
- `interface SonarHotspot { key; component; project; securityCategory; vulnerabilityProbability; line?; message; }`
- `interface Paged<T> { items: T[]; total: number; p: number; ps: number; }`
- `interface HttpClient { get(url: string, headers: Record<string,string>): Promise<{ status: number; body: string }> }`
- `interface SonarConfig { baseUrl: string; projectKey: string; branch?: string; authScheme: 'bearer'|'basic' }`
- `class SonarApiError extends Error { status: number }`
- `class SonarClient { constructor(http, getToken: ()=>Promise<string|undefined>, cfg: SonarConfig); searchIssues(opts?:{page?;pageSize?}): Promise<Paged<SonarIssue>>; searchAllIssues(cap?:number): Promise<SonarIssue[]>; showRule(key): Promise<SonarRule>; searchHotspots(opts?): Promise<Paged<SonarHotspot>>; validateConnection(): Promise<{ ok: boolean; detail?: string }> }`

- [ ] **Step 1 (test):** fake `HttpClient` ile `searchIssues` doğru URL'i (`/api/issues/search?componentKeys=KEY&branch=...&p=1&ps=...`) ve `Authorization: Bearer <token>` header'ını üretir; JSON gövdesini `Paged<SonarIssue>`'a parse eder.
- [ ] **Step 2 (test):** 401 dönerse `SonarApiError(status=401)` fırlatır; mesaj token yönlendirmesi içerir.
- [ ] **Step 3 (test):** `authScheme:'basic'` → `Authorization: Basic base64(token:)`.
- [ ] **Step 4 (test):** `searchAllIssues` sayfaları `total`'a göre dolaşır, `cap`'i aşmaz.
- [ ] **Step 5 (test):** `validateConnection` `/api/authentication/validate` çağırır; `{valid:true}` → `{ok:true}`; 401 → `{ok:false, detail}`.
- [ ] **Step 6 (impl):** testleri geçecek `client.ts`. **Step 7:** `npm test` yeşil. **Commit.**

### Task 1.3: Secrets + Config store (TDD)

**Files:** Create `src/audit/secrets.ts`, `src/config.ts`, `test/config.test.ts`

**Interfaces / Produces:**
- `interface SecretReader { get(key): Promise<string|undefined>; store(key,val): Promise<void>; delete(key): Promise<void> }`
- `const SONAR_TOKEN_KEY = 'codeHealth.sonarToken'`
- `class VscodeSecretVault implements SecretReader` (wraps `context.secrets`)
- `interface CodeHealthSettings { sonarUrl: string; projectKey: string; branch: string; authScheme: 'bearer'|'basic'; ... }`
- `interface SettingsStore { read(): CodeHealthSettings; write(partial): Promise<void> }` (port; impl `vscode.workspace.getConfiguration`)
- `class ConfigStore { constructor(settings: SettingsStore, secrets: SecretReader); getSettings(); saveSettings(partial); getToken(); setToken(t); clearToken(); isComplete(): Promise<boolean> }`
- `isComplete()` = `sonarUrl` & `projectKey` dolu **ve** token mevcut.

- [ ] **Step 1 (test):** fake settings+secrets ile `isComplete()` → token yokken `false`, hepsi dolunca `true`.
- [ ] **Step 2 (test):** `saveSettings` token'ı settings'e YAZMAZ (token yalnızca `setToken` ile secrets'a).
- [ ] **Step 3 (impl + run):** yeşil. **Commit.**

---

## M2 — Config Ekranı + Gating + Bulgu Ağacı + Detay Paneli

**Hedef:** Kullanıcı bağlantı bilgilerini girip kaydeder (Bağlantıyı Test Et ile doğrular); kaydedilmeden işlem yapılamaz; bulgular proje>dosya>önem ağacında; tıklayınca açıklama paneli açılır.

### Task 2.1: Webview HTML yardımcıları (TDD)

**Files:** Create `src/ui/html.ts`, `test/ui/html.test.ts`
**Produces:** `getNonce(): string`, `escapeHtml(s): string`, `getWebviewHtml(opts:{nonce;cspSource;scriptUri;styleUri;title}): string` (CSP `default-src 'none'; script-src 'nonce-...'; style-src ${cspSource}`).
- [ ] **Test:** `escapeHtml('<b>&"')` → `&lt;b&gt;&amp;&quot;`; html CSP + nonce içerir. **Impl + run.** Commit.

### Task 2.2: Bulgu gruplama (TDD)

**Files:** Create `src/ui/grouping.ts`, `test/ui/grouping.test.ts`
**Produces:** `interface FindingNode` (union: project|file|severity|issue); `groupFindings(issues: SonarIssue[]): ProjectNode[]` — proje>dosya>önem(öncelik sırası BLOCKER→INFO)>issue.
- [ ] **Test:** karışık issue listesi doğru hiyerarşi + önem sıralaması + sayımlar. **Impl + run.** Commit.

### Task 2.3: Config webview ekranı + gating

**Files:** Create `src/ui/messages.ts`, `src/ui/configPanel.ts`, `src/ui/webview/config.ts`, `src/ui/webview/styles.css`; Modify `src/extension.ts`
**Mesaj protokolü (tipli):** ext→wv `{type:'init', payload: settings(token hariç) + hasToken}`; wv→ext `{type:'test', payload: form}`, `{type:'save', payload: form+token?}`; ext→wv `{type:'testResult', payload:{ok,detail}}`, `{type:'saved'}`.
- [ ] `configPanel.ts`: `ConfigPanel.show(store, client factory)`. Form alanları: **SonarQube URL**, **Project Key** (veya proje URL'i yapıştır → key parse), **Branch** (ops.), **Token** (girilince secrets'a; mevcutsa "•••• kayıtlı"), **Auth scheme** (Bearer/Basic, advanced). **Bağlantıyı Test Et** → geçici client ile `validateConnection()` → sonuç gösterilir. **Kaydet** → `saveSettings` + `setToken` → panel kapanır, tree refresh.
- [ ] `webview/config.ts`: tema değişkenli, erişilebilir form; mesajlaşma; durum (test ediliyor/başarılı/hata).
- [ ] **Gating:** `extension.ts` — komut `code-health.configure`; `code-health.refresh` çağrıldığında `isComplete()` değilse uyarı + config ekranını aç; tree boşken "Yapılandır" düğümü gösterir.
- [ ] **Kabul:** Eksik configde tarama engellenir + config ekranı açılır; geçerli bilgiyle Test Et yeşil, Kaydet sonrası tarama açılır. Commit (M2 ile birlikte).

### Task 2.4: Findings TreeView + Detay paneli

**Files:** Create `src/ui/tree.ts`, `src/ui/detailPanel.ts`, `src/ui/webview/detail.ts`; Modify `src/extension.ts`
- [ ] `tree.ts`: `FindingsTreeProvider` `grouping`'i kullanır; önem ikon/renk (`ThemeIcon`); `refresh()`; issue düğümüne tıklama → `code-health.openFinding`.
- [ ] `detailPanel.ts`: `DetailPanel.show(issue, rule)` → webview; `showRule` ile açıklama (htmlDesc güvenli render/escape). Mesaj: wv→ext `{type:'fix'}`, `{type:'fixAll'}`, `{type:'openLocation'}`. Butonlar **Çöz**/**Tümünü Çöz** (M2'de stub → bilgi mesajı).
- [ ] `openFinding` komutu: editörde konuma git + paneli aç + `showRule` çağır.
- [ ] **Kabul:** Gerçek bulgular dosya bazlı görünür; tıklama açıklamayı getirir. **Commit (M2).**

---

## M3 — Çözüm Orkestratörü + Diff/Onay + Audit (en kritik)

**Hedef:** Copilot (`vscode.lm`) ile fix üretimi + diff önizleme + onay/red + gerekçe + audit. Onaysız yazma YOK.

### Task 3.1: Audit logger (TDD)

**Files:** Create `src/audit/audit.ts`, `test/audit/audit.test.ts`
**Produces:** `type AuditEvent = {type:'suggestion'|'accept'|'reject'|'rescan'|'error'; at:string; actor:string; ruleKey?; issueKey?; file?; detail?}`; `interface FileAppender { append(line): Promise<void> }`; `interface OutputSink { line(s): void }`; `class AuditLogger { constructor(appender, out, actor); record(ev): Promise<void> }` — JSONL satırı + okunur Output satırı; **token asla yazılmaz**.
- [ ] **Test:** `record` JSONL şekli doğru, `at` ISO, `actor` set; appender'a tam bir satır + `\n`. **Impl + run.** Commit.

### Task 3.2: Fix context + parse (TDD, SAF)

**Files:** Create `src/fix/context.ts`, `src/fix/parse.ts`, `test/fix/context.test.ts`, `test/fix/parse.test.ts`
**Produces:** `buildFixContext(issue, ruleDesc, fileText, padding): { snippet; startLine; endLine; prompt }`; `parseFixResponse(raw): { newCode; rationale }` — model çıktısındaki ```` ```lang ... ``` ```` bloğu + `GEREKÇE:`/`RATIONALE:` bölümü.
- [ ] **Test (context):** textRange çevresi padding ile snippet; dosya sınırlarında taşma yok.
- [ ] **Test (parse):** code fence + gerekçe ayrışır; fence yoksa graceful (tüm metni rationale, newCode boş → uygulanmaz).
- [ ] **Impl + run.** Commit.

### Task 3.3: Orchestrator (TDD) + diff/onay

**Files:** Create `src/fix/orchestrator.ts`, `src/fix/diff.ts`, `test/fix/orchestrator.test.ts`; Modify `src/extension.ts`, `src/ui/detailPanel.ts`
**Produces:** `interface LanguageModelGateway { isAvailable(): Promise<boolean>; sendFix(prompt, token): Promise<{ raw: string }> }`; `class CopilotUnavailableError extends Error`; `class VscodeLmGateway implements LanguageModelGateway` (`vscode.lm.selectChatModels({vendor})` + `sendRequest`); `interface FixProposal { issueKey; ruleKey; file; range; newCode; rationale }`; `class FixOrchestrator { constructor(lm, audit); propose(ctx, issue): Promise<FixProposal> }` — lm yoksa `CopilotUnavailableError`; başarıda audit `suggestion`; **uygulama yapmaz.**
- [ ] **Test:** fake lm yapılandırılmış metin döner → `propose` doğru `FixProposal` + audit `suggestion` çağrısı; lm yok → `CopilotUnavailableError`; **hiçbir WorkspaceEdit yok.**
- [ ] `diff.ts`: `previewAndDecide(proposal, deps)` — diff editörü aç (orijinal vs öneri, virtual content provider), `showInformationMessage(rationale,'Uygula','Reddet')`; Uygula → `WorkspaceEdit.replace(range,newCode)` + audit `accept`; Reddet → audit `reject`.
- [ ] `extension.ts`/`detailPanel.ts`: **Çöz** → context derle (`showRule`+dosya) → `propose` → `previewAndDecide`. **Tümünü Çöz** → bulguları sırayla, her biri ayrı diff onayına.
- [ ] **Kabul:** Onaysız yazma yok; red akışı temiz; gerekçe görünür; audit kaydı oluşur. **Commit (M3).**

---

## M4 — Pilot Sertleştirme + Paketleme

**Hedef:** Graceful degradation, fix sonrası doğrulama, testler, README, paketleme.

### Task 4.1: Graceful degradation + rescan
**Files:** Modify `src/extension.ts`, `src/fix/orchestrator.ts`, `src/ui/detailPanel.ts`
- [ ] Copilot erişilemezse: detay paneli "Çöz" yerine bilgilendirme + manuel çözüm rehberi; bulgu görüntüleme çalışmaya devam eder. Hata audit `error`.
- [ ] Fix `accept` sonrası: ilgili kuralı/dosyayı yeniden `searchIssues` ile tara, bulgunun kapandığını teyit et; sonucu kullanıcıya göster + audit `rescan`. Commit.

### Task 4.2: README + .vscodeignore + paketleme
**Files:** Create `README.md`; ensure `.vscodeignore`
- [ ] README: kurulum, config ekranı kullanımı, güvenlik notları (token SecretStorage, otomatik merge yok), pilot kullanım.
- [ ] `npm run lint` + `npm run compile` + `npm test` yeşil; `npx @vscode/vsce package` → `.vsix` üretir (engine/manifest doğrula).
- [ ] **Kabul (Faz 1 DoD):** `.vsix` paketlenebiliyor · onaysız yazma yok · audit çalışıyor · çekirdek testler yeşil. **Commit (M4).**

---

## Self-Review (spec kapsam kontrolü)

- Plan §1.3/§2 CLAUDE.md → Task 1.1 ✓ · §3 repo iskeleti → Task 1.1 ✓ · §5 H1 Sonar istemci → 1.2 ✓ · H2 TreeView+Webview+açıklama → 2.2/2.4 ✓ · H3 fix+diff+onay+gerekçe → 3.2/3.3 ✓ · H4 audit+degradation+rescan+paketleme → 3.1/4.1/4.2 ✓ · §6 slash komutu → 1.1 ✓ · §7 güvenlik (token/secret, izinler, telemetry, audit) → 1.1/1.3/3.1 ✓.
- **Ek gereksinim (config ekranı):** Task 2.3 ✓ + gating (Global Constraints + 2.3) ✓.
- Tip tutarlılığı: `SonarClient`, `ConfigStore`, `FixOrchestrator`, `AuditLogger`, `LanguageModelGateway` imzaları tasklar arası tutarlı.
- Placeholder yok; her task bağımsız test edilebilir deliverable üretir.
