# Akıllı Kod Sağlığı Asistanı (VS Code Eklentisi)

SonarQube Enterprise bulgularını VS Code içinde gösterir, **GitHub Copilot** (`vscode.lm`) ile çözüm önerir ve **her değişikliği diff + gerekçe ile kullanıcı onayına** sunar. **Otomatik merge yoktur** — onaysız hiçbir kod yazılmaz. Kurumsal kullanım için tasarlanmıştır (token yalnızca SecretStorage'da, denetim kaydı, sıkı CSP, sıfır runtime bağımlılığı).

## Özellikler

- **Bağlantı yapılandırma ekranı:** SonarQube URL, Project Key (repo), Branch ve Token girip kaydedin. Kaydetmeden tarama/çözüm yapılamaz (config-gating).
- **Bulgu paneli:** Bulgular **proje › dosya › önem derecesi** olarak gruplanır; önem ikon/renkleriyle gösterilir.
- **Açıklama:** Bir bulguya tıklayınca kural adı, önem/tip, mesaj ve "neden sorun" açıklaması (rules/show) detay panelinde gösterilir; ilgili konuma editörde gidilir.
- **Çözüm (Copilot):** "Çöz" ile Copilot bir düzeltme + gerekçe üretir; değişiklik **diff editöründe** önizlenir; yalnızca **"Uygula"** seçilirse `WorkspaceEdit` ile yazılır.
- **Tümünü Çöz:** Her bulgu **tek tek** diff onayına gelir (sessiz toplu uygulama yok), iptal edilebilir.
- **Denetim kaydı (audit):** Her öneri/onay/ret/yeniden-tarama; kim, ne zaman, hangi kural/dosya — JSONL + Output kanalı.
- **Graceful degradation:** Copilot erişilemezse bulgu görüntüleme ve manuel çözüm çalışmaya devam eder.

## Gereksinimler

- **VS Code ≥ 1.90** (Language Model API).
- **GitHub Copilot** + **Copilot Chat** eklentileri kurulu ve oturum açık (çözüm önerileri için).
- Erişilebilir bir **SonarQube** sunucusu ve **token**'ı.

## Kurulum

```bash
# Paketten kurulum
code --install-extension code-health-assistant-0.1.0.vsix
```

veya VS Code → Extensions → "..." → **Install from VSIX...**

## Yapılandırma

1. Etkinlik çubuğundaki **Kod Sağlığı** simgesine tıklayın.
2. **"Bağlantıyı yapılandırın"** (veya panel başlığındaki ⚙️) ile config ekranını açın.
3. Alanları doldurun:
   - **SonarQube Enterprise URL** — ör. `https://sonar.kurum-ici.local`
   - **Project Key (repo)** — proje anahtarı (proje URL'sini yapıştırırsanız `?id=` değeri otomatik ayıklanır).
   - **Branch** — opsiyonel.
   - **Token** — **SecretStorage**'da saklanır; ayar dosyasına/loga yazılmaz.
4. **Bağlantıyı Test Et** ile doğrulayın, **Kaydet**'e basın.
5. Panel başlığındaki ⟳ ile **Tara**'yın.

> Ayarlar (URL/Project Key/Branch/Auth) workspace `settings.json`'a (`codeHealth.*`) yazılır; **token asla** oraya yazılmaz.

## Güvenlik & Uyum

- **Token yalnızca VS Code SecretStorage'da** tutulur; koda/loga/ayar dosyasına/denetim kaydına yazılmaz.
- **Otomatik merge yok:** her fix önce diff olarak gösterilir, onay kullanıcıya aittir.
- **Denetim kaydı:** varsayılan konum `<workspace>/.code-health/audit.log` (JSONL). `codeHealth.auditLogPath` ile merkezi/ağ yoluna (SIEM beslemesi) yönlendirilebilir. Satır şeması: `{type, at, actor, ruleKey, issueKey, file, detail}`.
- **Webview güvenliği:** sıkı CSP (`script-src` yalnızca nonce), kural açıklaması extension tarafında sanitize edilir.
- **Sıfır runtime bağımlılığı** — kurumsal güvenlik/lisans incelemesi kolaydır.

## Ayarlar (`codeHealth.*`)

| Ayar | Açıklama |
|---|---|
| `sonarUrl` | SonarQube sunucu adresi |
| `projectKey` | Proje anahtarı |
| `branch` | Taranacak dal (boşsa ana dal) |
| `authScheme` | `bearer` (10.x+) / `basic` (eski) |
| `auditLogPath` | Denetim kaydı yolu (boşsa workspace) |
| `snippetPadding` | Fix bağlamı için satır payı (vars. 8) |
| `copilotVendor` | Language Model sağlayıcısı (vars. `copilot`) |
| `maxIssues` | Tek taramada azami bulgu (vars. 500) |

## Komutlar

- **Kod Sağlığı: Bağlantıyı Yapılandır**
- **Kod Sağlığı: Bulguları Tara**
- **Kod Sağlığı: Çöz** / **Tümünü Çöz**
- **Kod Sağlığı: Kayıtlı Token'ı Sil**

## Pilot Notları / Sınırlamalar

- SonarQube'de bir bulgunun **kesin kapanışı**, sunucuda yeni analiz çalıştıktan sonra görünür. Fix uygulandığında bulgu listeden iyimser olarak çıkarılır ve durum sorgulanır.
- Dosya yolu eşlemesi açık workspace klasör(ler)ine göredir; bulgunun dosyası workspace'te bulunmalıdır.
- Kurumsal proxy / self-signed sertifika gerekiyorsa HTTP istemcisine bir agent eklenebilir (`src/sonar/http.ts`).

## Geliştirme

```bash
npm install
npm run compile   # tsc (strict) + esbuild (extension + webview)
npm test          # node:test birim testleri
npm run lint
npm run package   # .vsix üretir (vsce)
```

Mimari: `ui → fix → sonar`, `audit` her katmandan; katmanlar bağımlılıklarını port/arayüz ile alır (DI), gerçek `vscode` bağlama `extension.ts`'te yapılır.
