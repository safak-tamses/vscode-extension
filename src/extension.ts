import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import { ConfigStore } from './config';
import type { CodeHealthSettings, SettingsStore } from './config';
import { FetchHttpClient } from './http';
import { VscodeSecretVault } from './audit/secrets';
import { AuditLogger, FsFileAppender } from './audit/audit';
import type { OutputSink } from './audit/audit';
import { SonarClient } from './sonar/client';
import { componentToPath } from './sonar/types';
import type { SonarIssue, SonarRule } from './sonar/types';
import { baseName, isAbsolutePath, normalizeRelPath, pickBestSuffixMatch } from './sonar/locate';
import { CopilotGateway } from './llm/copilotGateway';
import { createLlmGateway } from './llm/factory';
import { LlmUnavailableError } from './llm/gateway';
import type { CancelSignal, LlmGateway } from './llm/gateway';
import { loadRuleSets } from './coverage/rulesLoader';
import type { LoadedRules } from './coverage/rulesLoader';
import { WorkspaceRuleFileSystem, createSampleRuleSet } from './coverage/vscodeRules';
import { NodeBuildRunner } from './coverage/build';
import { ensureBuildConsent } from './coverage/buildGate';
import type { ConsentStore } from './coverage/buildGate';
import { SOURCE_EXCLUDE, discoverCoverage, findBuildRoot } from './coverage/discover';
import { applyMavenPath, mavenExecutableCandidates, usesMaven } from './coverage/maven';
import type { Platform } from './coverage/maven';
import { javaExecutableRelPath, javaHomeCandidates, withJavaHome } from './coverage/java';
import { describeReasons } from './coverage/gaps';
import type { CoverageGap } from './coverage/gaps';
import { formatBuilds, ruleSetFor, scanCoverage } from './coverage/service';
import type { BuildRecord, CoverageScanResult } from './coverage/service';
import type { TestRuleSet } from './coverage/rules';
import { runTestGeneration, toCancelSignal } from './testgen/flow';
import { groupFindings } from './ui/grouping';
import { FindingsTreeProvider } from './ui/tree';
import { CoverageTreeProvider } from './ui/coverageTree';
import { ConfigPanel } from './ui/configPanel';
import { CoveragePanel } from './ui/coveragePanel';
import { DetailPanel } from './ui/detailPanel';
import { buildFindingView } from './ui/findingView';
import { buildCoverageView, gapId } from './ui/coverageView';
import type { ProviderStatus } from './ui/messages';
import { htmlToText } from './ui/sanitize';
import { buildFixContext } from './fix/context';
import type { FixContext } from './fix/context';
import { FixOrchestrator } from './fix/orchestrator';
import { PreviewContentProvider, previewAndDecide } from './fix/diff';

/** Ayar alanı -> VS Code configuration anahtarı eşlemesi (derleyici eksiksizliği zorunlu kılar). */
const SETTING_KEYS: { [K in keyof CodeHealthSettings]: string } = {
  sonarUrl: 'sonarUrl',
  projectKey: 'projectKey',
  branch: 'branch',
  authScheme: 'authScheme',
  maxIssues: 'maxIssues',
  projectRoot: 'projectRoot',
  auditLogPath: 'auditLogPath',
  snippetPadding: 'snippetPadding',
  rulesDir: 'rulesDir',
  mavenPath: 'mavenPath',
  javaHome: 'javaHome',
  llmProvider: 'llm.provider',
  copilotVendor: 'llm.copilotVendor',
  copilotFamily: 'llm.copilotFamily',
  localProtocol: 'llm.local.protocol',
  localBaseUrl: 'llm.local.baseUrl',
  localModel: 'llm.local.model',
  localTemperature: 'llm.local.temperature',
  localMaxOutputTokens: 'llm.local.maxOutputTokens',
  localTimeoutSec: 'llm.local.timeoutSec',
  localExtraHeaders: 'llm.local.extraHeaders',
  testGenMaxRepairAttempts: 'testGen.maxRepairAttempts',
  testGenMaxContextChars: 'testGen.maxContextChars'
};

/** VS Code workspace configuration tabanlı ayar deposu. */
class VscodeSettingsStore implements SettingsStore {
  read(): CodeHealthSettings {
    const c = vscode.workspace.getConfiguration('codeHealth');
    // 0.1.x'te ayar "codeHealth.copilotVendor" idi; geriye dönük okunur.
    const legacyVendor = c.get<string>('copilotVendor', '');
    return {
      sonarUrl: c.get<string>(SETTING_KEYS.sonarUrl, ''),
      projectKey: c.get<string>(SETTING_KEYS.projectKey, ''),
      branch: c.get<string>(SETTING_KEYS.branch, ''),
      authScheme: c.get<'bearer' | 'basic'>(SETTING_KEYS.authScheme, 'bearer'),
      maxIssues: c.get<number>(SETTING_KEYS.maxIssues, 500),
      projectRoot: c.get<string>(SETTING_KEYS.projectRoot, ''),
      auditLogPath: c.get<string>(SETTING_KEYS.auditLogPath, ''),
      snippetPadding: c.get<number>(SETTING_KEYS.snippetPadding, 8),
      rulesDir: c.get<string>(SETTING_KEYS.rulesDir, '.code-health/rules'),
      mavenPath: c.get<string>(SETTING_KEYS.mavenPath, ''),
      javaHome: c.get<string>(SETTING_KEYS.javaHome, ''),
      llmProvider: c.get<'copilot' | 'local'>(SETTING_KEYS.llmProvider, 'copilot'),
      copilotVendor: c.get<string>(SETTING_KEYS.copilotVendor, '') || legacyVendor || 'copilot',
      copilotFamily: c.get<string>(SETTING_KEYS.copilotFamily, ''),
      localProtocol: c.get<'openai' | 'ollama'>(SETTING_KEYS.localProtocol, 'openai'),
      localBaseUrl: c.get<string>(SETTING_KEYS.localBaseUrl, ''),
      localModel: c.get<string>(SETTING_KEYS.localModel, ''),
      localTemperature: c.get<number>(SETTING_KEYS.localTemperature, 0.1),
      localMaxOutputTokens: c.get<number>(SETTING_KEYS.localMaxOutputTokens, 4096),
      localTimeoutSec: c.get<number>(SETTING_KEYS.localTimeoutSec, 120),
      localExtraHeaders: sanitizeHeaders(c.get<unknown>(SETTING_KEYS.localExtraHeaders, {})),
      testGenMaxRepairAttempts: c.get<number>(SETTING_KEYS.testGenMaxRepairAttempts, 1),
      testGenMaxContextChars: c.get<number>(SETTING_KEYS.testGenMaxContextChars, 60000)
    };
  }

  /**
   * Ayarlar global (kullanıcı) kapsamına yazılır: bağlantı/model kurulumu bir kez yapılır ve
   * tüm workspace'lerde geçerli kalır. Bir anahtarın workspace kapsamında değeri varsa
   * (eski sürümden kalan ya da bilinçli proje bazlı override) global değer görünmez kalacağı
   * için aynı değer oraya da yazılır — mevcut girdiler silinmez, yalnızca eşitlenir.
   */
  async write(partial: Partial<CodeHealthSettings>): Promise<void> {
    const c = vscode.workspace.getConfiguration('codeHealth');
    for (const [field, value] of Object.entries(partial)) {
      const key = SETTING_KEYS[field as keyof CodeHealthSettings];
      if (!key) {
        continue;
      }
      await c.update(key, value, vscode.ConfigurationTarget.Global);
      const scoped = c.inspect(key);
      if (scoped?.workspaceValue !== undefined) {
        await c.update(key, value, vscode.ConfigurationTarget.Workspace);
      }
      if (scoped?.workspaceFolderValue !== undefined) {
        await c.update(key, value, vscode.ConfigurationTarget.WorkspaceFolder);
      }
    }
  }
}

/** Ayar dosyasından gelen serbest nesneyi string->string başlık haritasına indirger. */
function sanitizeHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string') {
        out[key] = value;
      }
    }
  }
  return out;
}

export function activate(context: vscode.ExtensionContext): void {
  const store = new ConfigStore(new VscodeSettingsStore(), new VscodeSecretVault(context.secrets));
  const http = new FetchHttpClient();
  const tree = new FindingsTreeProvider();
  const coverageTree = new CoverageTreeProvider();
  const previewProvider = new PreviewContentProvider();

  const settings = store.getSettings();
  const channel = vscode.window.createOutputChannel('Kod Sağlığı Audit');
  const outputSink: OutputSink = { line: (text) => channel.appendLine(text) };
  const audit = new AuditLogger(
    new FsFileAppender(resolveAuditPath(settings)),
    outputSink,
    safeActor()
  );

  // Sağlayıcı ayarları değiştiğinde gateway yeniden kurulur; aksi halde önbellek korunur.
  let gatewayCache: { key: string; gateway: LlmGateway } | undefined;
  const llm = (): LlmGateway => {
    const llmSettings = store.getLlmSettings();
    const key = JSON.stringify(llmSettings);
    if (!gatewayCache || gatewayCache.key !== key) {
      gatewayCache = {
        key,
        gateway: createLlmGateway(llmSettings, {
          http,
          getApiKey: () => store.getLocalApiKey(),
          createCopilotGateway: (cfg) => new CopilotGateway(cfg)
        })
      };
    }
    return gatewayCache.gateway;
  };

  const providerStatus = async (): Promise<ProviderStatus> => {
    const gateway = llm();
    return {
      id: gateway.id,
      label: gateway.label,
      available: await gateway.isAvailable(),
      hint: gateway.unavailableHint()
    };
  };

  let currentIssues: SonarIssue[] = [];

  const makeClient = (): SonarClient => new SonarClient(http, () => store.getToken(), store.getSonarConfig());

  const workspaceRoot = (): vscode.Uri | undefined => vscode.workspace.workspaceFolders?.[0]?.uri;

  // -------------------------------------------------------------- dosya konumu çözümlemesi

  /**
   * `codeHealth.projectRoot` ayarındaki proje kökü. Mutlak yol doğrudan, göreli yol workspace
   * köküne göre yorumlanır. Ayar boşsa undefined (yalnızca workspace klasörleri kullanılır).
   */
  const projectRootUri = (): vscode.Uri | undefined => {
    const configured = store.getSettings().projectRoot.trim();
    if (configured === '') {
      return undefined;
    }
    if (isAbsolutePath(configured)) {
      return vscode.Uri.file(configured);
    }
    const root = workspaceRoot();
    return root ? vscode.Uri.joinPath(root, ...normalizeRelPath(configured)) : undefined;
  };

  /** Dosyanın aranacağı kökler, öncelik sırasıyla: ayardaki proje kökü, sonra workspace klasörleri. */
  const searchRoots = (): vscode.Uri[] => {
    const configured = projectRootUri();
    const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri);
    return configured ? [configured, ...folders] : folders;
  };

  /**
   * Kök altında aranabilecek güvenli bir göreli yol mu? Mutlak yollar ve `..` içeren yollar
   * kök dışına çıkabileceği için reddedilir (bkz. proje kuralları).
   */
  const safeSegments = (relPath: string): string[] | undefined => {
    if (isAbsolutePath(relPath)) {
      return undefined;
    }
    const segments = normalizeRelPath(relPath);
    return segments.length > 0 && !segments.includes('..') ? segments : undefined;
  };

  const fileExists = async (uri: vscode.Uri): Promise<boolean> => {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  };

  /** Yolun kaç üst dizini bu kökün altında gerçekten var? (kök seçimi için puan) */
  const existingDepth = async (root: vscode.Uri, dirSegments: string[]): Promise<number> => {
    let depth = 0;
    for (let i = 1; i <= dirSegments.length; i += 1) {
      if (!(await fileExists(vscode.Uri.joinPath(root, ...dirSegments.slice(0, i))))) {
        break;
      }
      depth = i;
    }
    return depth;
  };

  /**
   * Henüz var olmayan bir dosyanın (üretilen test dosyası) yazılacağı hedef. Kökler
   * resolveFileUri ile aynı sırayla denenir ve üst dizin zinciri en derin var olan kök seçilir;
   * böylece kök zaten yolun içinde geçiyorsa ön ek ikinci kez eklenmez. Hiçbirinde yoksa
   * öncelik sırasındaki ilk kök kullanılır.
   */
  const workspaceFileUri = async (relPath: string): Promise<vscode.Uri | undefined> => {
    const segments = safeSegments(relPath);
    if (!segments) {
      return undefined;
    }
    const dirSegments = segments.slice(0, -1);
    let best: { uri: vscode.Uri; depth: number } | undefined;
    for (const root of searchRoots()) {
      const depth = await existingDepth(root, dirSegments);
      if (!best || depth > best.depth) {
        best = { uri: vscode.Uri.joinPath(root, ...segments), depth };
      }
    }
    return best?.uri;
  };

  /**
   * Göreli yolu gerçek dosyaya çözer. Sıra: yapılandırılmış proje kökü → workspace klasörleri →
   * dosya adına göre workspace araması. Bulunamazsa undefined.
   */
  const resolveFileUri = async (relPath: string): Promise<vscode.Uri | undefined> => {
    const segments = safeSegments(relPath);
    if (!segments) {
      return undefined;
    }
    for (const root of searchRoots()) {
      const uri = vscode.Uri.joinPath(root, ...segments);
      if (await fileExists(uri)) {
        return uri;
      }
    }
    return searchWorkspaceFor(relPath);
  };

  /**
   * Son çare: dosya adıyla workspace'i tarar ve yolun sonundan en çok segment eşleşen adayı seçer.
   * Aynı skorda birden çok aday varsa seçim belirsizdir; yanlış dosyayı açmaktansa vazgeçilir.
   */
  const searchWorkspaceFor = async (relPath: string): Promise<vscode.Uri | undefined> => {
    const name = baseName(relPath);
    if (name === '') {
      return undefined;
    }
    const found = await vscode.workspace.findFiles(`**/${name}`, SOURCE_EXCLUDE, 50);
    const best = pickBestSuffixMatch(
      relPath,
      found.map((uri) => uri.fsPath)
    );
    return best === undefined ? undefined : found.find((uri) => uri.fsPath === best);
  };

  /** Dosya bulunamadığında denenen kökleri gösterir ve kurulum ekranına yönlendirir. */
  const reportMissingFile = async (relPath: string): Promise<void> => {
    const roots = searchRoots().map((uri) => uri.fsPath);
    const detail =
      roots.length > 0
        ? `Denenen kökler: ${roots.join(' · ')}`
        : 'Açık bir workspace klasörü yok.';
    const pick = await vscode.window.showWarningMessage(
      `Dosya bulunamadı: ${relPath}. ${detail}`,
      'Proje Kökünü Ayarla'
    );
    if (pick === 'Proje Kökünü Ayarla') {
      openConfig();
    }
  };

  /** Bulgunun dosyasını açıp ilgili satıra konumlanır. */
  const revealIssueLocation = async (issue: SonarIssue): Promise<void> => {
    const rel = componentToPath(issue.component, issue.project);
    const uri = await resolveFileUri(rel);
    if (!uri) {
      await reportMissingFile(rel);
      return;
    }
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, {
        preview: true,
        viewColumn: vscode.ViewColumn.One
      });
      const line = Math.max(0, (issue.textRange?.startLine ?? issue.line ?? 1) - 1);
      const pos = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    } catch {
      void vscode.window.showWarningMessage(`Dosya açılamadı: ${rel}`);
    }
  };

  /** Kural dizinini okur; workspace açık değilse boş sonuç döner. */
  const loadRules = async (): Promise<LoadedRules> => {
    const root = workspaceRoot();
    if (!root) {
      return { ruleSets: [], files: [], hasErrors: false };
    }
    const loaded = await loadRuleSets(
      new WorkspaceRuleFileSystem(root),
      store.getSettings().rulesDir
    );
    await audit.record({
      type: 'rules-load',
      detail: `${loaded.ruleSets.length} kural seti · ${loaded.files.length} dosya${loaded.hasErrors ? ' · hatalı dosya var' : ''}`
    });
    return loaded;
  };

  // ---------------------------------------------------------------- kapsam / test üretimi

  const buildChannel = vscode.window.createOutputChannel('Kod Sağlığı Derleme');
  const buildRunner = new NodeBuildRunner();
  const consentStore: ConsentStore = {
    get: (key) => context.workspaceState.get<string>(key),
    update: async (key, value) => {
      await context.workspaceState.update(key, value);
    }
  };
  let coverage: CoverageScanResult | undefined;

  // ------------------------------------------------------------------------ Maven konumu

  const platformKind = (): Platform => (process.platform === 'win32' ? 'win32' : 'posix');

  /**
   * Ayardaki Maven yolunu gerçek bir çalıştırılabilir dosyaya çözer. Dizin, `bin` dizini ve
   * doğrudan dosya kabul edilir. Ayar boşsa ya da hiçbir aday yoksa undefined.
   */
  const resolveMavenExecutable = async (configured: string): Promise<string | undefined> => {
    for (const candidate of mavenExecutableCandidates(configured, platformKind())) {
      if (await fileExists(vscode.Uri.file(candidate))) {
        return candidate;
      }
    }
    return undefined;
  };

  /**
   * Derleme komutunu çalıştırmaya hazır hale getirir: Maven yolu ayarlıysa komutun başındaki
   * `mvn` belirteci tam yolla değiştirilir. Ayar boşsa komut olduğu gibi kalır ve `mvn`
   * PATH üzerinden bulunur (varsayılan davranış).
   */
  const effectiveBuildCommand = async (command: string, warn = false): Promise<string> => {
    const configured = store.getSettings().mavenPath.trim();
    if (configured === '' || !usesMaven(command)) {
      return command;
    }
    const executable = await resolveMavenExecutable(configured);
    if (!executable) {
      if (warn) {
        void vscode.window.showWarningMessage(
          `Maven konumu bulunamadı: ${configured}. Komut PATH üzerinden çalıştırılacak. ` +
            'Kurulum ekranı › Test Kuralları sekmesinden yolu düzeltebilirsiniz.'
        );
      }
      return command;
    }
    return applyMavenPath(command, executable, platformKind());
  };

  /** Ayardaki JDK yolunu, içinde gerçekten `bin/java` bulunan bir köke çözer. */
  const resolveJavaHome = async (configured: string): Promise<string | undefined> => {
    const platform = platformKind();
    for (const candidate of javaHomeCandidates(configured, platform)) {
      const exe = `${candidate}${platform === 'win32' ? '\\' : '/'}${javaExecutableRelPath(platform)}`;
      if (await fileExists(vscode.Uri.file(exe))) {
        return candidate;
      }
    }
    return undefined;
  };

  /**
   * Derleme sürecinin ortamı. JDK yolu ayarlıysa JAVA_HOME ayarlanır ve `<home>/bin` PATH'in
   * başına eklenir; aksi halde undefined döner ve süreç eklentinin ortamını devralır.
   */
  const buildEnvironment = async (warn = false): Promise<NodeJS.ProcessEnv | undefined> => {
    const configured = store.getSettings().javaHome.trim();
    if (configured === '') {
      return undefined;
    }
    const home = await resolveJavaHome(configured);
    if (!home) {
      if (warn) {
        void vscode.window.showWarningMessage(
          `JDK bulunamadı: ${configured}. Derleme ortamın JAVA_HOME değeriyle çalıştırılacak. ` +
            'Kurulum ekranı › Test Kuralları sekmesinden yolu düzeltebilirsiniz.'
        );
      }
      return undefined;
    }
    return withJavaHome(process.env, home, platformKind()) as NodeJS.ProcessEnv;
  };

  const runBuildPort = async (
    ruleSet: TestRuleSet,
    cancel?: CancelSignal
  ): Promise<BuildRecord | undefined> => {
    const root = workspaceRoot();
    if (!root) {
      return undefined;
    }
    const command = await effectiveBuildCommand(ruleSet.coverage.buildCommand, true);
    const buildRoot = await findBuildRoot(root);
    const cwd = vscode.Uri.joinPath(root, ...buildRoot.split('/').filter(Boolean)).fsPath;
    const skipped = (reason: string): BuildRecord => ({
      ruleSetId: ruleSet.id,
      command,
      cwd: buildRoot,
      ok: false,
      durationMs: 0,
      timedOut: false,
      cancelled: false,
      skippedReason: reason,
      output: ''
    });

    const env = await buildEnvironment(true);
    const javaHome = env?.JAVA_HOME;

    const consent = await ensureBuildConsent(command, cwd, buildRoot, consentStore, javaHome);
    if (!consent.allowed) {
      return skipped(consent.reason ?? 'onay verilmedi');
    }

    buildChannel.show(true);
    buildChannel.appendLine(`\n$ ${command}      (${buildRoot || 'workspace kökü'})`);
    if (javaHome) {
      buildChannel.appendLine(`  JAVA_HOME=${javaHome}`);
    }
    const result = await buildRunner.run(command, cwd, {
      timeoutSec: ruleSet.coverage.buildTimeoutSec,
      onOutput: (chunk) => buildChannel.append(chunk),
      ...(cancel ? { cancel } : {}),
      ...(env ? { env } : {})
    });
    buildChannel.appendLine(
      `\n[kod-sağlığı] çıkış kodu ${result.code ?? '-'} · ${(result.durationMs / 1000).toFixed(1)} sn\n`
    );
    return {
      ruleSetId: ruleSet.id,
      command,
      cwd: buildRoot,
      ok: result.ok,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
      output: result.output
    };
  };

  const runScan = async (build: boolean, cancel?: CancelSignal): Promise<CoverageScanResult> => {
    const root = workspaceRoot();
    const result = await scanCoverage(
      {
        loadRules,
        discover: (ruleSets) =>
          root
            ? discoverCoverage(root, ruleSets)
            : Promise.resolve({ modules: [], sourceFiles: [], testFiles: [], problems: [] }),
        runBuild: runBuildPort,
        audit
      },
      { build, ...(cancel ? { cancel } : {}) }
    );
    await publishCoverage(result);
    return result;
  };

  /** Tarama sonucunu ağaç ve panele yayar. */
  const publishCoverage = async (result: CoverageScanResult): Promise<void> => {
    coverage = result;
    coverageTree.setGaps(result.gaps);
    if (CoveragePanel.isOpen) {
      CoveragePanel.postView(buildCoverageView(result, await providerStatus(), new Date()));
    }
  };

  const openCoveragePanel = async (result?: CoverageScanResult): Promise<void> => {
    const view = result ?? coverage;
    CoveragePanel.show(
      {
        extensionUri: context.extensionUri,
        onScan: (build) => void runScanCommand(build),
        onGenerate: (id) => void generateTestCommand(findGapById(id)),
        onOpenSource: (id) => void openGapFile(findGapById(id), 'source'),
        onOpenTest: (id) => void openGapFile(findGapById(id), 'test'),
        onConfigure: () => openConfig(),
        onCreateSampleRules: () => void vscode.commands.executeCommand('code-health.createSampleRules')
      },
      view ? buildCoverageView(view, await providerStatus(), new Date()) : undefined
    );
  };

  const findGapById = (id: string): CoverageGap | undefined =>
    coverage?.gaps.find((gap) => gapId(gap) === id);

  const openGapFile = async (gap: CoverageGap | undefined, which: 'source' | 'test', line?: number): Promise<void> => {
    if (!gap) {
      return;
    }
    const relPath = which === 'source' ? gap.sourcePath : gap.testPath;
    const uri = await resolveFileUri(relPath);
    if (!uri) {
      await reportMissingFile(relPath);
      return;
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.One });
    if (line !== undefined) {
      const pos = new vscode.Position(Math.max(0, line - 1), 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
  };

  /** Kural seti yoksa kullanıcıyı doğru adıma yönlendirir; taramaya devam edilebilirse true döner. */
  const ensureRules = async (): Promise<boolean> => {
    const root = workspaceRoot();
    if (!root) {
      void vscode.window.showWarningMessage('Kapsam taraması için bir klasör/workspace açık olmalı.');
      return false;
    }
    const rules = await loadRules();
    if (rules.ruleSets.length > 0) {
      return true;
    }
    const pick = await vscode.window.showWarningMessage(
      rules.hasErrors
        ? 'Kural dosyalarında hata var; kapsam taraması yapılamaz.'
        : 'Etkin bir test kural seti bulunamadı.',
      rules.hasErrors ? 'Kural Dosyasını Aç' : 'Örnek Kural Seti Oluştur'
    );
    if (pick === 'Örnek Kural Seti Oluştur') {
      await vscode.commands.executeCommand('code-health.createSampleRules');
    } else if (pick === 'Kural Dosyasını Aç') {
      const broken = rules.files.find((f) => f.errors.length > 0);
      if (broken) {
        const uri = vscode.Uri.joinPath(root, ...broken.path.split('/').filter(Boolean));
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
      }
    }
    return false;
  };

  /** Taramayı çalıştırır; `build` verilmezse kullanıcıya derleme yapılıp yapılmayacağı sorulur. */
  const runScanCommand = async (build?: boolean): Promise<void> => {
    if (!(await ensureRules())) {
      return;
    }
    const command = await effectiveBuildCommand(
      (await loadRules()).ruleSets[0]?.coverage.buildCommand ?? 'mvn clean install'
    );

    let shouldBuild = build;
    if (shouldBuild === undefined) {
      const mode = await vscode.window.showQuickPick(
        [
          {
            label: '$(play) Derle ve tara',
            description: command,
            detail: 'Taze JaCoCo raporu üretir. Komut onayınızla çalıştırılır.',
            build: true
          },
          {
            label: '$(file-code) Var olan raporu oku',
            description: 'derleme yapılmaz',
            detail: 'Daha önce üretilmiş jacoco.xml dosyalarını okur (hızlı).',
            build: false
          }
        ],
        { title: 'Kapsam taraması', placeHolder: 'Nasıl taranacak?' }
      );
      if (!mode) {
        return;
      }
      shouldBuild = mode.build;
    }

    CoveragePanel.postBusy(true, shouldBuild ? command : 'Raporlar okunuyor…');
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Kod Sağlığı: kapsam taranıyor', cancellable: true },
        async (progress, token) => {
          if (shouldBuild) {
            progress.report({ message: command });
          }
          return runScan(shouldBuild === true, toCancelSignal(token));
        }
      );
      reportScan(result);
      await openCoveragePanel(result);
    } finally {
      CoveragePanel.postBusy(false);
    }
  };

  const reportScan = (result: CoverageScanResult): void => {
    if (result.blocker) {
      void vscode.window.showWarningMessage('Kod Sağlığı: ' + result.blocker);
      return;
    }
    for (const problem of result.problems) {
      buildChannel.appendLine(`[rapor-hatası] ${problem.path}: ${problem.message}`);
    }
    const summary =
      `Kod Sağlığı: ${result.gaps.length} eksik test · ` +
      `satır %${Math.round(result.summary.lineCoverage)} · dal %${Math.round(result.summary.branchCoverage)} · ` +
      `${result.modules.length} rapor. ${formatBuilds(result.builds)}`;
    void vscode.window.showInformationMessage(summary);
  };

  const pickGap = async (gaps: readonly CoverageGap[]): Promise<CoverageGap | undefined> => {
    const items = gaps.map((gap) => ({
      label: `$(beaker) ${gap.simpleName}`,
      description: `satır %${Math.round(gap.lineCoverage)} · ${gap.uncoveredMethods.length} metot test edilmemiş`,
      detail: `${gap.moduleName} › ${gap.packageName || '(varsayılan paket)'} — ${describeReasons(gap.reasons)}`,
      gap
    }));
    const picked = await vscode.window.showQuickPick(items, {
      title: `Eksik birim testleri (${gaps.length})`,
      placeHolder: 'Test üretilecek sınıfı seçin',
      matchOnDescription: true,
      matchOnDetail: true
    });
    return picked?.gap;
  };

  const testFlowDeps = {
    llm,
    audit,
    previewProvider,
    resolveUri: resolveFileUri,
    targetUri: workspaceFileUri,
    maxContextChars: () => store.getSettings().testGenMaxContextChars,
    maxRepairAttempts: () => store.getSettings().testGenMaxRepairAttempts,
    // runScan sonucu zaten ağaca ve panele yayar; ayrıca onRescanned vermeye gerek yok.
    rescan: async (cancel?: CancelSignal): Promise<CoverageScanResult> =>
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Kod Sağlığı: derleniyor ve doğrulanıyor',
          cancellable: true
        },
        (_progress, token) => runScan(true, cancel ?? toCancelSignal(token))
      )
  };

  const generateTestCommand = async (input?: unknown): Promise<void> => {
    if (!store.isLlmComplete()) {
      const pick = await vscode.window.showWarningMessage(
        'Model sağlayıcı yapılandırması eksik: ' + store.describeLlm().missing.join(', '),
        'Yapılandır'
      );
      if (pick === 'Yapılandır') {
        openConfig();
      }
      return;
    }
    let gap = extractGap(input);
    if (!gap) {
      if (!coverage || coverage.gaps.length === 0) {
        const pick = await vscode.window.showInformationMessage(
          'Önce kapsam taraması yapılmalı.',
          'Şimdi Tara'
        );
        if (pick === 'Şimdi Tara') {
          await runScanCommand();
        }
        return;
      }
      gap = await pickGap(coverage.gaps);
    }
    if (!gap) {
      return;
    }
    const ruleSet = ruleSetFor(gap, coverage?.ruleSets ?? []);
    if (!ruleSet) {
      void vscode.window.showWarningMessage(
        `"${gap.ruleSetId}" kural seti artık yüklü değil. Kapsam taramasını yenileyin.`
      );
      return;
    }
    const id = gapId(gap);
    const outcome = await runTestGeneration(gap, ruleSet, testFlowDeps);
    if (outcome === 'applied') {
      CoveragePanel.postOutcome(id, 'applied', `Test yazıldı: ${gap.testPath}`);
    } else if (outcome === 'rejected') {
      CoveragePanel.postOutcome(id, 'rejected');
    } else if (outcome !== 'noop') {
      CoveragePanel.postOutcome(id, 'error');
    }
  };

  context.subscriptions.push(
    channel,
    vscode.window.registerTreeDataProvider('codeHealthFindings', tree),
    vscode.window.registerTreeDataProvider('codeHealthCoverage', coverageTree),
    vscode.workspace.registerTextDocumentContentProvider(PreviewContentProvider.scheme, previewProvider)
  );

  void store.isSonarComplete().then((complete) => tree.setConfigured(complete));

  const openConfig = (focus?: 'sonar' | 'llm' | 'rules'): void => {
    ConfigPanel.show(
      {
        store,
        extensionUri: context.extensionUri,
        loadRules,
        createSampleRules: () => createSampleRulesCommand(),
        onSaved: (target) => {
          if (target === 'llm') {
            gatewayCache = undefined;
            if (coverage) {
              void publishCoverage(coverage);
            }
            return;
          }
          void store.isSonarComplete().then((complete) => {
            tree.setConfigured(complete);
            if (complete) {
              void refresh();
            }
          });
        }
      },
      focus
    );
  };

  /** Örnek kural setini kopyalar ve açık kurulum panelini tazeler. */
  const createSampleRulesCommand = async (): Promise<void> => {
    const root = workspaceRoot();
    if (!root) {
      void vscode.window.showWarningMessage('Kural seti oluşturmak için bir klasör/workspace açık olmalı.');
      return;
    }
    try {
      const created = await createSampleRuleSet(context.extensionUri, root, store.getSettings().rulesDir);
      if (created) {
        const loaded = await loadRules();
        ConfigPanel.refreshRules();
        void vscode.window.showInformationMessage(
          `Örnek kural seti hazır. Şu an ${loaded.ruleSets.length} kural seti etkin.`
        );
      }
    } catch (err) {
      void vscode.window.showErrorMessage(
        'Kural seti oluşturulamadı: ' + (err instanceof Error ? err.message : String(err))
      );
    }
  };

  const refresh = async (): Promise<void> => {
    if (!(await store.isSonarComplete())) {
      tree.setConfigured(false);
      const pick = await vscode.window.showWarningMessage(
        'Önce SonarQube bağlantısını yapılandırın (URL, Project Key, Token).',
        'Yapılandır'
      );
      if (pick === 'Yapılandır') {
        openConfig();
      }
      return;
    }
    try {
      const issues = await makeClient().searchAllIssues(store.getSettings().maxIssues, 500);
      currentIssues = issues;
      tree.setFindings(groupFindings(issues));
      void vscode.window.showInformationMessage(`Kod Sağlığı: ${issues.length} bulgu yüklendi.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage('Kod Sağlığı tarama hatası: ' + msg);
    }
  };

  const assembleContext = async (issue: SonarIssue): Promise<FixContext | undefined> => {
    const uri = await resolveFileUri(componentToPath(issue.component, issue.project));
    if (!uri) {
      return undefined;
    }
    let ruleDescription = '';
    try {
      const rule = await makeClient().showRule(issue.rule);
      ruleDescription = htmlToText(rule.htmlDesc ?? rule.mdDesc ?? '');
    } catch {
      // Açıklama alınamazsa istem yine de oluşturulur.
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    return buildFixContext(issue, ruleDescription, doc.getText(), store.getSettings().snippetPadding);
  };

  const rescanAfterFix = async (issue: SonarIssue): Promise<void> => {
    await audit.record({
      type: 'rescan',
      ruleKey: issue.rule,
      issueKey: issue.key,
      file: componentToPath(issue.component, issue.project)
    });
    let stillOpen = true;
    try {
      const found = await makeClient().findIssue(issue.key);
      stillOpen = Boolean(found && found.status !== 'CLOSED' && found.status !== 'RESOLVED');
    } catch {
      // Doğrulama sorgusu başarısızsa iyimser davran; yerel değişiklik uygulandı.
    }
    currentIssues = currentIssues.filter((i) => i.key !== issue.key);
    tree.setFindings(groupFindings(currentIssues));
    void vscode.window.showInformationMessage(
      stillOpen
        ? 'Fix uygulandı ve listeden çıkarıldı. SonarQube tarafında kesin kapanış, sunucuda yeni analiz sonrası görünür.'
        : 'Fix uygulandı; SonarQube bulguyu kapanmış olarak raporladı.'
    );
  };

  const runFix = async (issue: SonarIssue): Promise<void> => {
    DetailPanel.postBusy(true);
    try {
      const ctx = await assembleContext(issue);
      if (!ctx) {
        DetailPanel.postBusy(false);
        DetailPanel.postOutcome(
          'error',
          'İlgili dosya bulunamadı. Kurulum ekranındaki "Proje Kök Dizini" ayarını kontrol edin.'
        );
        await reportMissingFile(componentToPath(issue.component, issue.project));
        return;
      }
      const orchestrator = new FixOrchestrator(llm(), audit);
      let proposal;
      try {
        proposal = await orchestrator.propose(issue, ctx);
      } catch (err) {
        if (err instanceof LlmUnavailableError) {
          await audit.record({
            type: 'error',
            ruleKey: issue.rule,
            issueKey: issue.key,
            provider: llm().id,
            detail: 'llm-unavailable'
          });
          DetailPanel.postBusy(false);
          DetailPanel.postOutcome('error', err.message);
          return;
        }
        throw err;
      }
      DetailPanel.postBusy(false);
      const outcome = await previewAndDecide(proposal, {
        resolveUri: resolveFileUri,
        provider: previewProvider,
        onAccept: () =>
          audit.record({ type: 'accept', ruleKey: issue.rule, issueKey: issue.key, file: proposal.filePath }),
        onReject: () =>
          audit.record({ type: 'reject', ruleKey: issue.rule, issueKey: issue.key, file: proposal.filePath })
      });
      if (outcome === 'applied') {
        DetailPanel.postOutcome('applied');
        await rescanAfterFix(issue);
      } else if (outcome === 'rejected') {
        DetailPanel.postOutcome('rejected');
      } else if (outcome === 'noop') {
        DetailPanel.postOutcome('error', 'Uygulanabilir bir öneri üretilmedi.');
      } else {
        DetailPanel.postOutcome('error', 'Değişiklik uygulanamadı.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await audit.record({ type: 'error', issueKey: issue.key, detail: msg });
      DetailPanel.postBusy(false);
      DetailPanel.postOutcome('error', msg);
    }
  };

  const runFixAll = async (): Promise<void> => {
    if (currentIssues.length === 0) {
      void vscode.window.showInformationMessage('Çözülecek bulgu yok. Önce tarayın.');
      return;
    }
    const gateway = llm();
    if (!(await gateway.isAvailable())) {
      void vscode.window.showWarningMessage(
        `${gateway.label} kullanılamıyor; toplu çözüm yapılamaz. ${gateway.unavailableHint()}`
      );
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `${currentIssues.length} bulgu tek tek diff onayına gelecek (sessiz toplu uygulama YOK). Devam edilsin mi?`,
      { modal: true },
      'Devam'
    );
    if (confirm !== 'Devam') {
      return;
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Kod Sağlığı: Tümünü Çöz', cancellable: true },
      async (progress, token) => {
        const orchestrator = new FixOrchestrator(gateway, audit);
        const signal = toCancelSignal(token);
        const issues = [...currentIssues];
        for (let i = 0; i < issues.length; i++) {
          const issue = issues[i];
          if (token.isCancellationRequested || !issue) {
            break;
          }
          progress.report({ message: `${i + 1}/${issues.length} — ${issue.rule}`, increment: 100 / issues.length });
          try {
            const ctx = await assembleContext(issue);
            if (!ctx) {
              continue;
            }
            const proposal = await orchestrator.propose(issue, ctx, signal);
            const outcome = await previewAndDecide(proposal, {
              resolveUri: resolveFileUri,
              provider: previewProvider,
              onAccept: () =>
                audit.record({ type: 'accept', ruleKey: issue.rule, issueKey: issue.key, file: proposal.filePath }),
              onReject: () =>
                audit.record({ type: 'reject', ruleKey: issue.rule, issueKey: issue.key, file: proposal.filePath })
            });
            if (outcome === 'applied') {
              await rescanAfterFix(issue);
            }
          } catch (err) {
            if (err instanceof LlmUnavailableError) {
              void vscode.window.showWarningMessage(
                `${gateway.label} erişimi kesildi; toplu çözüm durduruldu.`
              );
              break;
            }
            await audit.record({
              type: 'error',
              issueKey: issue.key,
              detail: err instanceof Error ? err.message : String(err)
            });
          }
        }
      }
    );
  };

  const showFinding = async (issue: SonarIssue): Promise<void> => {
    await revealIssueLocation(issue);
    let rule: SonarRule | undefined;
    try {
      rule = await makeClient().showRule(issue.rule);
    } catch {
      // Açıklama alınamazsa bulgu yine gösterilir.
    }
    const view = buildFindingView(issue, rule, await providerStatus());
    DetailPanel.show(
      {
        extensionUri: context.extensionUri,
        onFix: () => void runFix(issue),
        onFixAll: () => void runFixAll(),
        onOpenLocation: () => void revealIssueLocation(issue)
      },
      view
    );
  };

  context.subscriptions.push(
    buildChannel,
    vscode.commands.registerCommand('code-health.configure', () => openConfig()),
    vscode.commands.registerCommand('code-health.configureLlm', () => openConfig('llm')),
    vscode.commands.registerCommand('code-health.refresh', () => void refresh()),
    vscode.commands.registerCommand('code-health.openFinding', (issue: SonarIssue) => {
      if (isSonarIssue(issue)) {
        void showFinding(issue);
      }
    }),
    vscode.commands.registerCommand('code-health.fix', (node: unknown) => {
      const issue = extractIssue(node);
      if (issue) {
        void (async () => {
          await showFinding(issue);
          await runFix(issue);
        })();
      }
    }),
    vscode.commands.registerCommand('code-health.fixAll', () => void runFixAll()),
    vscode.commands.registerCommand('code-health.clearToken', async () => {
      await store.clearToken();
      tree.setConfigured(await store.isSonarComplete());
      void vscode.window.showInformationMessage('Kod Sağlığı: kayıtlı SonarQube token’ı silindi.');
    }),
    vscode.commands.registerCommand('code-health.clearLlmKey', async () => {
      await store.clearLocalApiKey();
      gatewayCache = undefined;
      void vscode.window.showInformationMessage('Kod Sağlığı: kayıtlı local LLM API anahtarı silindi.');
    }),
    vscode.commands.registerCommand('code-health.scanCoverage', () => void runScanCommand()),
    vscode.commands.registerCommand('code-health.showCoverage', () => void openCoveragePanel()),
    vscode.commands.registerCommand('code-health.generateTest', (node: unknown) =>
      void generateTestCommand(node)
    ),
    vscode.commands.registerCommand('code-health.openGapSource', (node: unknown) => {
      const gap = extractGap(node);
      const line = node && typeof node === 'object' && 'line' in node ? (node as { line?: number }).line : undefined;
      void openGapFile(gap, 'source', line);
    }),
    vscode.commands.registerCommand('code-health.createSampleRules', () => void createSampleRulesCommand())
  );
}

export function deactivate(): void {
  // Temizlik context.subscriptions üzerinden yapılır.
}

function safeActor(): string {
  try {
    return os.userInfo().username || 'unknown';
  } catch {
    return 'unknown';
  }
}

function resolveAuditPath(settings: CodeHealthSettings): string {
  if (settings.auditLogPath) {
    return settings.auditLogPath;
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  const base = folder ? folder.uri.fsPath : os.tmpdir();
  return path.join(base, '.code-health', 'audit.log');
}

function isSonarIssue(value: unknown): value is SonarIssue {
  return Boolean(value && typeof value === 'object' && 'key' in value && 'rule' in value);
}

function extractIssue(node: unknown): SonarIssue | undefined {
  if (node && typeof node === 'object' && 'issue' in node) {
    const issue = (node as { issue: unknown }).issue;
    if (isSonarIssue(issue)) {
      return issue;
    }
  }
  return undefined;
}

function isCoverageGap(value: unknown): value is CoverageGap {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'qualifiedName' in value &&
      'testPath' in value &&
      'ruleSetId' in value
  );
}

/** Komut argümanı doğrudan bir boşluk ya da onu taşıyan bir ağaç düğümü olabilir. */
function extractGap(node: unknown): CoverageGap | undefined {
  if (isCoverageGap(node)) {
    return node;
  }
  if (node && typeof node === 'object' && 'gap' in node) {
    const gap = (node as { gap: unknown }).gap;
    if (isCoverageGap(gap)) {
      return gap;
    }
  }
  return undefined;
}

