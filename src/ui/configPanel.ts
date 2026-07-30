import * as vscode from 'vscode';
import { getNonce, getWebviewHtml } from './html';
import type { ConfigStore } from '../config';
import type {
  ConfigFromWebview,
  ConfigToWebview,
  LlmFormState,
  RuleFileView,
  RulesView,
  SonarFormState,
  ToolPathView
} from './messages';
import { SonarClient } from '../sonar/client';
import { isAbsolutePath, relativeToRoot } from '../sonar/locate';
import { mavenExecutableCandidates } from '../coverage/maven';
import type { Platform } from '../coverage/maven';
import { javaExecutableRelPath, javaHomeCandidates } from '../coverage/java';
import { FetchHttpClient } from '../http';
import { CopilotGateway } from '../llm/copilotGateway';
import { LocalLlmGateway } from '../llm/localGateway';
import type { LlmProbeResult } from '../llm/gateway';
import type { LoadedRules } from '../coverage/rulesLoader';
import type { TestRuleSet } from '../coverage/rules';

export interface ConfigPanelDeps {
  store: ConfigStore;
  extensionUri: vscode.Uri;
  /** Kural setlerini okur (kurulum ekranındaki "Test Kuralları" sekmesi). */
  loadRules: () => Promise<LoadedRules>;
  /** Örnek kural setini oluşturur. */
  createSampleRules: () => Promise<void>;
  onSaved: (target: 'sonar' | 'llm') => void;
}

function currentPlatform(): Platform {
  return process.platform === 'win32' ? 'win32' : 'posix';
}

/** Bağlantı, model sağlayıcı ve test kurallarını yöneten kurulum ekranı (tekil). */
export class ConfigPanel {
  private static current: ConfigPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private ready = false;

  static show(deps: ConfigPanelDeps, focus?: 'sonar' | 'llm' | 'rules'): void {
    if (ConfigPanel.current) {
      ConfigPanel.current.deps = deps;
      ConfigPanel.current.panel.reveal(vscode.ViewColumn.Active);
      void ConfigPanel.current.postInit();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'codeHealthConfig',
      'Kod Sağlığı: Kurulum',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(deps.extensionUri, 'dist', 'webview')]
      }
    );
    ConfigPanel.current = new ConfigPanel(panel, deps);
    void focus;
  }

  /** Kural dosyaları değiştiğinde açık paneli tazeler. */
  static refreshRules(): void {
    void ConfigPanel.current?.postRules();
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private deps: ConfigPanelDeps
  ) {
    this.panel.webview.html = this.render();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: ConfigFromWebview) => void this.onMessage(msg),
      null,
      this.disposables
    );
  }

  private render(): string {
    const w = this.panel.webview;
    const nonce = getNonce();
    return getWebviewHtml({
      nonce,
      cspSource: w.cspSource,
      scriptUri: w
        .asWebviewUri(vscode.Uri.joinPath(this.deps.extensionUri, 'dist', 'webview', 'config.js'))
        .toString(),
      styleUri: w
        .asWebviewUri(vscode.Uri.joinPath(this.deps.extensionUri, 'dist', 'webview', 'styles.css'))
        .toString(),
      title: 'Kod Sağlığı: Kurulum'
    });
  }

  private post(msg: ConfigToWebview): void {
    void this.panel.webview.postMessage(msg);
  }

  private async onMessage(msg: ConfigFromWebview): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.ready = true;
        await this.postInit();
        break;
      case 'testSonar': {
        this.post({ type: 'busy', target: 'sonar', busy: true });
        const result = await this.testSonar(msg.form, msg.token);
        this.post({ type: 'busy', target: 'sonar', busy: false });
        this.post({
          type: 'testResult',
          target: 'sonar',
          ok: result.ok,
          ...(result.detail ? { detail: result.detail } : {})
        });
        break;
      }
      case 'saveSonar':
        await this.saveSonar(msg.form, msg.token);
        break;
      case 'testLlm': {
        this.post({ type: 'busy', target: 'llm', busy: true });
        const result = await this.testLlm(msg.form, msg.apiKey);
        this.post({ type: 'busy', target: 'llm', busy: false });
        this.post({ type: 'testResult', target: 'llm', ok: result.ok, detail: result.detail });
        break;
      }
      case 'saveLlm':
        await this.saveLlm(msg.form, msg.apiKey);
        break;
      case 'browseProjectRoot':
        await this.browseProjectRoot();
        break;
      case 'browseMavenPath':
        await this.browseToolPath('maven');
        break;
      case 'saveMavenPath':
        await this.deps.store.saveSettings({ mavenPath: msg.value.trim() });
        await this.postToolPaths();
        break;
      case 'browseJavaHome':
        await this.browseToolPath('java');
        break;
      case 'saveJavaHome':
        await this.deps.store.saveSettings({ javaHome: msg.value.trim() });
        await this.postToolPaths();
        break;
      case 'clearLlmKey':
        await this.deps.store.clearLocalApiKey();
        this.deps.onSaved('llm');
        void vscode.window.showInformationMessage('Kod Sağlığı: kayıtlı local LLM API anahtarı silindi.');
        await this.postInit();
        break;
      case 'reloadRules':
        await this.postRules();
        break;
      case 'createSampleRules':
        await this.deps.createSampleRules();
        await this.postRules();
        break;
      case 'openRuleFile':
        await this.openRuleFile(msg.path);
        break;
    }
  }

  private async postInit(): Promise<void> {
    if (!this.ready) {
      return;
    }
    const s = this.deps.store.getSettings();
    const sonar: SonarFormState = {
      sonarUrl: s.sonarUrl,
      projectKey: s.projectKey,
      branch: s.branch,
      authScheme: s.authScheme,
      projectRoot: s.projectRoot
    };
    const llm: LlmFormState = {
      provider: s.llmProvider,
      copilotVendor: s.copilotVendor,
      copilotFamily: s.copilotFamily,
      localProtocol: s.localProtocol,
      localBaseUrl: s.localBaseUrl,
      localModel: s.localModel,
      localTemperature: s.localTemperature,
      localMaxOutputTokens: s.localMaxOutputTokens,
      localTimeoutSec: s.localTimeoutSec
    };
    this.post({
      type: 'init',
      sonar,
      llm,
      hasSonarToken: Boolean(await this.deps.store.getToken()),
      hasLlmKey: Boolean(await this.deps.store.getLocalApiKey()),
      rules: await this.buildRulesView()
    });
  }

  private async postRules(): Promise<void> {
    if (!this.ready) {
      return;
    }
    this.post({ type: 'rules', rules: await this.buildRulesView() });
  }

  private async buildRulesView(): Promise<RulesView> {
    const loaded = await this.deps.loadRules();
    const byPath = new Map<string, TestRuleSet>(loaded.ruleSets.map((rs) => [rs.sourceFile, rs]));
    const files: RuleFileView[] = loaded.files.map((file) => {
      const ruleSet = byPath.get(file.path);
      return {
        path: file.path,
        ...(file.ruleSetId ? { ruleSetId: file.ruleSetId } : {}),
        ...(ruleSet ? { name: ruleSet.name } : {}),
        disabled: file.disabled,
        errors: file.errors,
        warnings: file.warnings,
        ...(ruleSet
          ? {
              summary:
                `eşikler: satır %${ruleSet.coverage.minLineCoverage} · dal %${ruleSet.coverage.minBranchCoverage} · ` +
                `metot %${ruleSet.coverage.minMethodCoverage}  —  ${ruleSet.coverage.buildCommand}`
            }
          : {})
      };
    });
    return {
      dir: this.deps.store.getSettings().rulesDir,
      files,
      activeCount: loaded.ruleSets.length,
      maven: await this.buildMavenView(),
      java: await this.buildJavaView()
    };
  }

  private async postToolPaths(): Promise<void> {
    this.post({
      type: 'toolPaths',
      maven: await this.buildMavenView(),
      java: await this.buildJavaView()
    });
  }

  private async isFile(path: string): Promise<boolean> {
    try {
      return (await vscode.workspace.fs.stat(vscode.Uri.file(path))).type === vscode.FileType.File;
    } catch {
      return false;
    }
  }

  /** Ayardaki Maven yolunu gerçek bir çalıştırılabilire çözmeye çalışır ve durumu özetler. */
  private async buildMavenView(): Promise<ToolPathView> {
    const path = this.deps.store.getSettings().mavenPath.trim();
    if (path === '') {
      return {
        path: '',
        ok: true,
        detail: 'Ayarlanmadı: derleme komutu olduğu gibi çalışır ve mvn PATH üzerinden bulunur.'
      };
    }
    for (const candidate of mavenExecutableCandidates(path, currentPlatform())) {
      if (await this.isFile(candidate)) {
        return { path, ok: true, detail: `Bulundu: ${candidate}` };
      }
    }
    return {
      path,
      ok: false,
      detail:
        'Bu yolda Maven çalıştırılabiliri bulunamadı. Maven kökünü (…/apache-maven-3.9.6), ' +
        `bin dizinini ya da doğrudan ${currentPlatform() === 'win32' ? 'mvn.cmd' : 'mvn'} dosyasını verin.`
    };
  }

  /** Ayardaki JDK yolunu, içinde `bin/java` bulunan bir köke çözmeye çalışır. */
  private async buildJavaView(): Promise<ToolPathView> {
    const platform = currentPlatform();
    const path = this.deps.store.getSettings().javaHome.trim();
    if (path === '') {
      return {
        path: '',
        ok: true,
        detail: 'Ayarlanmadı: derleme, ortamın JAVA_HOME ve PATH değerleriyle çalışır.'
      };
    }
    const sep = platform === 'win32' ? '\\' : '/';
    for (const candidate of javaHomeCandidates(path, platform)) {
      if (await this.isFile(`${candidate}${sep}${javaExecutableRelPath(platform)}`)) {
        return { path, ok: true, detail: `JAVA_HOME=${candidate}` };
      }
    }
    return {
      path,
      ok: false,
      detail:
        `Bu yolda ${javaExecutableRelPath(platform)} bulunamadı. JDK kökünü, bin dizinini ya da ` +
        'java çalıştırılabilir dosyasını verin (JRE değil, JDK gerekir).'
    };
  }

  /** Maven/JDK konumunu seçtirir ve doğrudan kaydeder. */
  private async browseToolPath(target: 'maven' | 'java'): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: true,
      canSelectMany: false,
      openLabel: target === 'maven' ? 'Maven Konumu Olarak Seç' : 'JDK Kökü Olarak Seç',
      title:
        target === 'maven'
          ? 'Maven kökü, bin dizini ya da mvn çalıştırılabilir dosyası'
          : 'JDK kökü, bin dizini ya da java çalıştırılabilir dosyası'
    });
    const chosen = picked?.[0];
    if (!chosen) {
      return;
    }
    await this.deps.store.saveSettings(
      target === 'maven' ? { mavenPath: chosen.fsPath } : { javaHome: chosen.fsPath }
    );
    await this.postToolPaths();
  }

  private async testSonar(form: SonarFormState, token: string): Promise<{ ok: boolean; detail?: string }> {
    try {
      if (!form.sonarUrl || !form.projectKey) {
        return { ok: false, detail: 'URL ve Project Key zorunludur.' };
      }
      const effectiveToken = token || (await this.deps.store.getToken());
      if (!effectiveToken) {
        return { ok: false, detail: 'Token girilmedi.' };
      }
      const client = new SonarClient(new FetchHttpClient(), async () => effectiveToken, {
        baseUrl: form.sonarUrl,
        projectKey: form.projectKey,
        ...(form.branch ? { branch: form.branch } : {}),
        authScheme: form.authScheme
      });
      const result = await client.validateConnection();
      return result.ok ? { ok: true, detail: 'Bağlantı başarılı. SonarQube erişimi doğrulandı.' } : result;
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private async saveSonar(form: SonarFormState, token: string): Promise<void> {
    this.post({ type: 'busy', target: 'sonar', busy: true });
    await this.deps.store.saveSettings({
      sonarUrl: form.sonarUrl,
      projectKey: form.projectKey,
      branch: form.branch,
      authScheme: form.authScheme,
      projectRoot: form.projectRoot
    });
    if (token) {
      await this.deps.store.setToken(token);
    }
    this.post({ type: 'busy', target: 'sonar', busy: false });
    // Kök dizin yoksa kayıt engellenmez; yalnızca uyarılır (ağ sürücüsü sonradan bağlanabilir).
    const problem = await this.checkProjectRoot(form.projectRoot);
    if (problem) {
      this.post({ type: 'testResult', target: 'sonar', ok: false, detail: problem });
    } else {
      this.post({ type: 'saved', target: 'sonar' });
    }
    this.deps.onSaved('sonar');
    void vscode.window.showInformationMessage('Kod Sağlığı: SonarQube bağlantısı kaydedildi.');
  }

  /** Proje kökü verilmişse gerçekten var olan bir dizin mi? Sorun varsa açıklama döner. */
  private async checkProjectRoot(value: string): Promise<string | undefined> {
    const trimmed = value.trim();
    if (trimmed === '') {
      return undefined;
    }
    const uri = this.projectRootUri(trimmed);
    if (!uri) {
      return `Kaydedildi, ancak göreli kök "${trimmed}" için açık bir workspace klasörü yok.`;
    }
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type === vscode.FileType.Directory) {
        return undefined;
      }
      return `Kaydedildi, ancak "${trimmed}" bir dizin değil.`;
    } catch {
      return `Kaydedildi, ancak "${trimmed}" bulunamadı. Bulgu dosyaları workspace içinde aranacak.`;
    }
  }

  private projectRootUri(value: string): vscode.Uri | undefined {
    if (isAbsolutePath(value)) {
      return vscode.Uri.file(value);
    }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    return root ? vscode.Uri.joinPath(root, ...value.split(/[\\/]/).filter(Boolean)) : undefined;
  }

  /** Klasör seçtirir ve sonucu (workspace altındaysa göreli) forma geri postalar. */
  private async browseProjectRoot(): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Proje Kökü Olarak Seç',
      title: 'Sonar bulgularındaki yolların göreli olduğu kök dizin',
      ...(root ? { defaultUri: root } : {})
    });
    const chosen = picked?.[0];
    if (!chosen) {
      return;
    }
    this.post({
      type: 'projectRoot',
      value: root ? relativeToRoot(root.fsPath, chosen.fsPath) : chosen.fsPath
    });
  }

  /** Formdaki (henüz kaydedilmemiş) değerlerle geçici bir gateway kurup dener. */
  private async testLlm(form: LlmFormState, apiKey: string): Promise<LlmProbeResult> {
    try {
      if (form.provider === 'copilot') {
        return await new CopilotGateway({ vendor: form.copilotVendor, family: form.copilotFamily }).probe();
      }
      const effectiveKey = apiKey || (await this.deps.store.getLocalApiKey());
      const gateway = new LocalLlmGateway(
        {
          protocol: form.localProtocol,
          baseUrl: form.localBaseUrl,
          model: form.localModel,
          temperature: form.localTemperature,
          maxOutputTokens: form.localMaxOutputTokens,
          timeoutSec: form.localTimeoutSec,
          extraHeaders: this.deps.store.getSettings().localExtraHeaders
        },
        new FetchHttpClient(),
        async () => effectiveKey
      );
      return await gateway.probe();
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private async saveLlm(form: LlmFormState, apiKey: string): Promise<void> {
    this.post({ type: 'busy', target: 'llm', busy: true });
    await this.deps.store.saveSettings({
      llmProvider: form.provider,
      copilotVendor: form.copilotVendor,
      copilotFamily: form.copilotFamily,
      localProtocol: form.localProtocol,
      localBaseUrl: form.localBaseUrl,
      localModel: form.localModel,
      localTemperature: form.localTemperature,
      localMaxOutputTokens: form.localMaxOutputTokens,
      localTimeoutSec: form.localTimeoutSec
    });
    if (apiKey) {
      await this.deps.store.setLocalApiKey(apiKey);
    }
    this.post({ type: 'busy', target: 'llm', busy: false });
    this.post({ type: 'saved', target: 'llm' });
    this.deps.onSaved('llm');
    void vscode.window.showInformationMessage(
      form.provider === 'local'
        ? `Kod Sağlığı: local LLM kaydedildi (${form.localModel}).`
        : 'Kod Sağlığı: GitHub Copilot sağlayıcı olarak kaydedildi.'
    );
  }

  private async openRuleFile(relPath: string): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) {
      return;
    }
    try {
      const uri = vscode.Uri.joinPath(root, ...relPath.split('/').filter(Boolean));
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    } catch {
      void vscode.window.showWarningMessage(`Kural dosyası açılamadı: ${relPath}`);
    }
  }

  private dispose(): void {
    ConfigPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}
