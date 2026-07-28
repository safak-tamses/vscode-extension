# Akıllı Kod Sağlığı Asistanı (VS Code Eklentisi)

Kurumsal kod sağlığını VS Code içinde iki koldan ele alır:

1. **SonarQube bulguları** — listeler, açıklar ve yapay zekâ ile çözüm önerir.
2. **Eksik birim testleri** — JaCoCo kapsam raporlarını okuyup test edilmemiş sınıf/metotları bulur ve
   **sizin yazdığınız kural setine göre** JUnit 5 testleri üretir.

Model sağlayıcı olarak **GitHub Copilot** veya **şirket içi (self-hosted) local LLM** kullanılabilir.
**Otomatik merge yoktur** — üretilen her değişiklik önce diff olarak gösterilir, yazma kararı sizindir.
Token ve API anahtarları yalnızca VS Code SecretStorage'da tutulur; sıfır runtime bağımlılığı vardır.

---

## Özellikler

### SonarQube tarafı
- **Bağlantı ekranı:** URL, Project Key, Branch, Token. Kaydetmeden tarama/çözüm yapılamaz (config-gating).
- **Bulgu paneli:** proje › dosya › önem derecesi ağacı; ikon ve renklerle önceliklendirme.
- **Açıklama:** kural adı, önem/tip, mesaj ve "neden sorun" açıklaması (`rules/show`), ilgili konuma gitme.
- **Çözüm:** seçili sağlayıcı bir düzeltme + gerekçe üretir → **diff editörü** → yalnızca **"Uygula"** derseniz yazılır.
- **Tümünü Çöz:** her bulgu tek tek diff onayına gelir (sessiz toplu uygulama yok), iptal edilebilir.

### Test kapsamı tarafı
- **Kapsam taraması:** kural setinizdeki derleme komutunu (ör. `mvn clean install`) **onayınızla** çalıştırır,
  `jacoco.xml` raporlarını okur; çok modüllü Maven projeleri desteklenir.
- **Eksik test tespiti:** hiç test edilmemiş metotlar, kapsanmayan satır numaraları ve eşik altı sınıflar;
  aciliyete göre sıralanır. Testi **hiç olmayan** sınıf için sıfırdan yazar, **eksik** olanı tamamlar.
- **Kural odaklı üretim:** ekibinizin `.code-health/rules/*.md` dosyalarındaki yazım kuralları modele **aynen** iletilir.
- **Doğrulama:** test uygulandıktan sonra yeniden derleyip **önce/sonra kapsam farkını** raporlar;
  derleme kırılırsa derleyici hatasıyla sınırlı bir onarım turu önerir (yine diff onaylı).
- **Denetim kaydı:** her öneri/onay/ret/derleme/doğrulama JSONL olarak kaydedilir.

---

## Gereksinimler

- **VS Code ≥ 1.90**
- Model sağlayıcı (biri yeterli):
  - **GitHub Copilot** + **Copilot Chat** eklentileri kurulu ve oturum açık, **veya**
  - Erişilebilir bir **local LLM sunucusu** (OpenAI uyumlu `/chat/completions` ya da Ollama `/api/chat`).
- SonarQube bulguları için: erişilebilir bir **SonarQube** sunucusu ve **token**'ı.
- Test üretimi için: **Java 17+**, **Maven** ve projede **jacoco-maven-plugin**.

---

## Kurulum

```bash
code --install-extension code-health-assistant-0.1.0.vsix
```

veya VS Code → Extensions → "..." → **Install from VSIX...**

---

## 1) Model sağlayıcıyı seçin

Etkinlik çubuğundaki **Kod Sağlığı** simgesi → **Kurulum** → **Yapay Zekâ** sekmesi.
(Komut paleti: **Kod Sağlığı: Model Sağlayıcıyı Seç**.)

### GitHub Copilot
Ek alan gerekmez. İsterseniz `vendor` ve model ailesi (`gpt-4o` gibi) belirtebilirsiniz.
**Modeli Test Et** ile erişimi doğrulayın.

### Şirket içi Local LLM

| Alan | Açıklama |
|---|---|
| **Protokol** | `OpenAI uyumlu` (vLLM, TGI, LM Studio, LiteLLM, kurumsal ağ geçitleri) veya `Ollama` |
| **Sunucu adresi** | `http://llm.kurum-ici.local:8000/v1` · Ollama için `http://localhost:11434` |
| **Model adı** | Sunucuda yüklü model kimliği, ör. `qwen2.5-coder:32b` |
| **API anahtarı** | Gerekiyorsa. **Yalnızca SecretStorage'a** yazılır |
| **Sıcaklık / token / zaman aşımı** | Kod için sıcaklığı düşük (0–0.2), test üretimi için token'ı yüksek tutun |

Notlar:
- Yalnızca host verirseniz OpenAI protokolünde `/v1` otomatik eklenir; yanlışlıkla yapıştırılan
  `/chat/completions` eki temizlenir.
- Kurumsal ağ geçidi ek başlık istiyorsa `codeHealth.llm.local.extraHeaders` kullanın —
  **gizli değer yazmayın**, o ayar dosyaya kaydedilir.
- Self-signed sertifika için `NODE_EXTRA_CA_CERTS` ortam değişkenini kullanın.

---

## 2) SonarQube bağlantısını yapılandırın

**Kurulum → Bağlantı** sekmesinde URL, Project Key (proje URL'sini yapıştırırsanız `?id=` otomatik ayıklanır),
Branch ve Token'ı girin → **Bağlantıyı Test Et** → **Kaydet**.
Panel başlığındaki ⟳ ile bulguları tarayın.

> Ayarlar workspace `settings.json`'a (`codeHealth.*`) yazılır; **token ve API anahtarı asla** oraya yazılmaz.

---

## 3) Test kural setinizi ekleyin

> **Kurallarınızı bu dizine, bu formatta eklemelisiniz ki eklenti görsün:**
> **`<workspace>/.code-health/rules/*.md`**
> (dizin `codeHealth.rulesDir` ile değiştirilebilir)

Başlamak için: **Kurulum → Test Kuralları → Örnek Kural Setini Oluştur**
(komut paleti: **Kod Sağlığı: Örnek Test Kural Setini Oluştur**). Bu, aşağıdaki dosyayı
`.code-health/rules/java-spring-unit-tests.md` olarak kopyalar; projenize göre uyarlayın.

### Format

Dosya iki bölümden oluşur:

| Bölüm | Kim okur | Ne işe yarar |
|---|---|---|
| `---` **arası frontmatter** | Eklenti | Hangi dosyalar, hangi eşikler, hangi derleme komutu, hangi rapor yolu |
| `---` **sonrası Markdown gövdesi** | **Model** | Ekibinizin test yazım kuralları — **modele aynen iletilir** |

Frontmatter bilinçli olarak **tam YAML değildir**; sıfır bağımlılık ilkesi gereği küçük ve kesin bir alt küme
desteklenir: `anahtar: değer`, girintili `- liste`, tek seviye iç içe blok (`coverage:`, `test:`) ve `#` yorum satırı.
Desteklenmeyen sözdizimi sessizce yutulmaz — **satır numarasıyla** kurulum ekranında gösterilir.

### Örnek kural seti (Spring Boot 3 / Java 17 / Maven + JaCoCo)

```markdown
---
id: java-spring-unit-tests
name: Spring Boot 3 / Java 17 Birim Test Kuralları
language: java
enabled: true
priority: 100

include:
  - "**/src/main/java/**/*.java"

exclude:
  - "**/*Application.java"
  - "**/config/**"
  - "**/dto/**"
  - "**/entity/**"
  - "**/exception/**"

coverage:
  tool: jacoco
  reportPath: "**/target/site/jacoco/jacoco.xml"
  buildCommand: "mvn -B clean install"
  buildTimeoutSec: 900
  minLineCoverage: 80
  minBranchCoverage: 70
  minMethodCoverage: 80

test:
  framework: junit5
  sourceRoot: "src/main/java"
  testRoot: "src/test/java"
  suffix: "Test"
  mocking: mockito
  assertions: assertj
---

## Genel ilkeler
- Üretim kodunu değiştirme. Yalnızca test dosyası üret.
- Sınıf başına tek test dosyası: `com.kurum.OrderService` → `src/test/java/com/kurum/OrderServiceTest.java`.
- Mevcut test dosyası varsa **koru ve genişlet**; var olan testleri silme.

## Yığın
- JUnit 5 + Mockito + AssertJ. `@ExtendWith(MockitoExtension.class)` + `@Mock` + `@InjectMocks`.
- `@SpringBootTest` kullanma — birim testi hızlı olmalı.

## Kapsanacak senaryolar
Kapsanmayan her public metot için en az: mutlu yol, hata yolu, sınır durumları ve her dal.

## Yasaklar
- `@Disabled` test bırakma, boş gövdeli test yazma, saat/rastgelelik/ağ bağımlılığı kurma.
```

Gönderilen dosyanın tamamı için: `resources/rules/java-spring-unit-tests.md`.

#### Frontmatter alanları

| Alan | Zorunlu | Varsayılan | Açıklama |
|---|---|---|---|
| `id` | ✔ | — | Benzersiz kimlik |
| `name` | | `id` | Ekranlarda görünen ad |
| `language` | | `java` | Bu sürümde yalnızca `java` |
| `enabled` | | `true` | `false` ise kural seti uygulanmaz |
| `priority` | | `100` | Bir dosya birden fazla kural setine uyarsa yüksek olan sahiplenir |
| `include` | ✔ | — | Kapsam aranacak kaynaklar (`**`, `*`, `?` glob) |
| `exclude` | | boş | Birim testi beklenmeyen yollar |
| `coverage.tool` | | `jacoco` | Bu sürümde yalnızca `jacoco` |
| `coverage.reportPath` | | `**/target/site/jacoco/jacoco.xml` | Rapor glob'u |
| `coverage.buildCommand` | ✔ | — | Raporu üreten komut |
| `coverage.buildTimeoutSec` | | `900` | Derleme zaman aşımı |
| `coverage.minLineCoverage` / `minBranchCoverage` / `minMethodCoverage` | | `80` / `70` / `80` | Eşikler |
| `test.framework` / `mocking` / `assertions` | | `junit5` / `mockito` / `assertj` | Bilgi amaçlı; asıl kural gövdededir |
| `test.sourceRoot` / `testRoot` / `suffix` | | `src/main/java` / `src/test/java` / `Test` | Yol ve adlandırma |

---

## 4) Kapsamı tarayın ve test üretin

**Eksik Testler** görünümündeki ⚗️ (veya komut paleti: **Kod Sağlığı: Test Kapsamını Tara**).
İki mod sunulur:

- **Derle ve tara** — kural setindeki komutu çalıştırıp taze rapor üretir (ilk seferde komut onayı istenir).
- **Var olan raporu oku** — daha önce üretilmiş `jacoco.xml` dosyalarını okur (hızlı).

Sonra **Test Kapsamı** panelinde veya ağaçta bir sınıf seçip **Test Üret** deyin. Akış:

```
kaynak + mevcut test + kapsanmayan metot/satır + kural gövdeniz
        ↓
   model önerisi
        ↓
   DIFF ÖNİZLEME  ──"Reddet"──▶  hiçbir şey yazılmaz
        ↓ "Uygula"
   dosya yazılır ve kaydedilir
        ↓ (isteğe bağlı) "Derle ve Doğrula"
   mvn clean install → yeni jacoco.xml → önce/sonra kapsam farkı
        ↓ derleme kırıldıysa
   "Onarmayı Dene" → derleyici hatası modele verilir → yine diff onayı
```

### Spring Boot örneği (uçtan uca)

1. Projede `jacoco-maven-plugin` tanımlı (`prepare-agent` + `report` hedefleri).
2. **Örnek Kural Setini Oluştur** → dosyayı kendi paket adlarınıza göre düzenleyin.
3. **Test Kapsamını Tara → Derle ve tara** → `mvn -B clean install` çalışır, her modülün
   `target/site/jacoco/jacoco.xml` dosyası okunur.
4. Panelde ör. `OrderService` · satır %30 · `create(OrderRequest): Order` test edilmemiş görünür.
5. **Test Üret** → `src/test/java/com/kurum/order/OrderServiceTest.java` diff olarak gelir.
6. **Uygula** → **Derle ve Doğrula** → `satır %30 → %88 (+58) — Eşikler karşılandı.`

---

## Güvenlik & Uyum

- **Otomatik merge yok:** Sonar düzeltmeleri ve üretilen test dosyaları dahil, her yazma diff + onay sonrasıdır.
- **Sırlar:** SonarQube token'ı ve local LLM API anahtarı **yalnızca SecretStorage'da**; ayar dosyasına,
  loga ve denetim kaydına yazılmaz (birim testleriyle doğrulanır).
- **Derleme komutu üç kapıdan geçer:** komut kural dosyasından (repo içeriğinden) geldiği için
  ① **Workspace Trust** zorunlu, ② komutu ve dizini gösteren **modal onay**,
  ③ onay komut metnine bağlı saklanır — **komut değişirse yeniden sorulur**.
- **Üretilen dosya yolu doğrulanır:** mutlak yollar, `..` ile üst dizine çıkış ve test kökü dışındaki hedefler
  reddedilir; paket ve sınıf adı dosya adıyla tutarlı olmak zorundadır.
- **Denetim kaydı:** varsayılan `<workspace>/.code-health/audit.log` (JSONL); `codeHealth.auditLogPath` ile
  merkezi/SIEM yoluna yönlendirilebilir. Şema: `{type, at, actor, ruleKey, issueKey, file, provider, model, durationMs, detail}`.
  Olay tipleri: `suggestion · accept · reject · rescan · rules-load · coverage-scan · build · test-suggestion ·
  test-accept · test-reject · test-verify · error`.
- **Webview güvenliği:** sıkı CSP (`script-src` yalnızca nonce), dış font/CDN yok, kural açıklaması
  extension tarafında sanitize edilir, HTML hiçbir zaman `innerHTML` ile yazılmaz.
- **Sıfır runtime bağımlılığı** — kurumsal güvenlik/lisans incelemesi kolaydır.

---

## Ayarlar (`codeHealth.*`)

| Ayar | Vars. | Açıklama |
|---|---|---|
| `sonarUrl` · `projectKey` · `branch` | `""` | SonarQube bağlantısı |
| `authScheme` | `bearer` | `bearer` (10.x+) / `basic` (eski) |
| `maxIssues` | `500` | Tek taramada azami bulgu |
| `snippetPadding` | `8` | Fix bağlamı için satır payı |
| `auditLogPath` | `""` | Boşsa `<workspace>/.code-health/audit.log` |
| `rulesDir` | `.code-health/rules` | Test kural setlerinin dizini |
| `llm.provider` | `copilot` | `copilot` / `local` |
| `llm.copilotVendor` · `llm.copilotFamily` | `copilot` · `""` | Copilot model seçimi |
| `llm.local.protocol` | `openai` | `openai` / `ollama` |
| `llm.local.baseUrl` · `llm.local.model` | `""` | Local LLM adresi ve modeli |
| `llm.local.temperature` · `maxOutputTokens` · `timeoutSec` | `0.1` · `4096` · `120` | Üretim parametreleri |
| `llm.local.extraHeaders` | `{}` | Ağ geçidi başlıkları (**gizli değer yazmayın**) |
| `testGen.maxRepairAttempts` | `1` | Derlenmeyen test için onarım turu sayısı |
| `testGen.maxContextChars` | `60000` | İstem bağlam bütçesi |

---

## Komutlar

| Komut | İşlev |
|---|---|
| **Bağlantıyı Yapılandır** | Kurulum ekranını açar |
| **Model Sağlayıcıyı Seç** | Kurulum → Yapay Zekâ sekmesi |
| **Bulguları Tara** | SonarQube bulgularını çeker |
| **Çöz** / **Tümünü Çöz** | Bulgu(lar) için diff onaylı düzeltme |
| **Test Kapsamını Tara** | Derleme + JaCoCo okuma + eksik test tespiti |
| **Test Kapsamı Panelini Aç** | Özet ve eksik test listesi |
| **Eksik Birim Testini Üret** | Seçili sınıf için diff onaylı test üretimi |
| **Örnek Test Kural Setini Oluştur** | `.code-health/rules/` altına örnek dosya |
| **Kayıtlı SonarQube Token'ını Sil** / **Local LLM API Anahtarını Sil** | SecretStorage temizliği |

---

## Sınırlamalar

- Test üretimi bu sürümde **Java / Maven / JaCoCo** içindir. Mimari çok dilli kurulmuştur; `coverage`
  katmanına yeni bir rapor adaptörü eklemek yeterlidir.
- SonarQube'de bir bulgunun **kesin kapanışı**, sunucuda yeni analiz çalıştıktan sonra görünür.
  Fix uygulandığında bulgu listeden iyimser olarak çıkarılır ve durum sorgulanır.
- Dosya eşlemesi açık workspace klasör(ler)ine göredir; bulgunun/kaynağın workspace'te bulunması gerekir.
- Üretilen testler **öneridir**: kabul etmeden önce gözden geçirin. Kaynak dosya bağlam bütçesine sığmazsa
  kırpılır ve bu durum size bildirilir.
- Kurumsal proxy gerekiyorsa HTTP istemcisine bir agent eklenebilir (`src/http.ts`).

---

## Geliştirme

```bash
npm install
npm run compile   # tsc (strict) + esbuild (extension + 3 webview)
npm test          # node:test birim testleri
npm run lint
npm run package   # .vsix üretir (vsce)
```

### Mimari

```
src/sonar/     SonarQube Web API istemcisi (tipli)
src/llm/       sağlayıcı soyutlaması: Copilot (vscode.lm) | local (openai|ollama)
src/coverage/  kural seti · glob · JaCoCo · derleme + onay kapısı · boşluk analizi
src/testgen/   istem · güvenli ayrıştırma · orkestratör · doğrulama · akış
src/fix/       Sonar düzeltme orkestratörü + diff/onay
src/ui/        TreeView'lar + webview panelleri
src/audit/     denetim kaydı + SecretStorage
```

Bağımlılık yönü tek yönlüdür: `ui → {fix, testgen} → {sonar, coverage, llm}`; `audit` her katmandan çağrılır.
Her katman bağımlılıklarını constructor (port/arayüz) ile alır; gerçek `vscode` bağlama `extension.ts`'te yapılır.
Saf mantık (ayrıştırma, gruplama, istem kurma, kapsam hesabı) `vscode` içermez ve doğrudan test edilir.
