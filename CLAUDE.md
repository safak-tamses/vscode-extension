# Proje: Akıllı Kod Sağlığı Asistanı (VS Code Eklentisi)

## Genel Bakış
İki işi yapan VS Code eklentisi:
1. SonarQube Enterprise bulgularını gösterir ve yapay zekâ ile çözüm önerir.
2. JaCoCo kapsam raporlarından eksik birim testlerini bulur ve ekibin kural setine göre
   JUnit 5 testleri üretir.
Her değişiklik DIFF olarak kullanıcı onayına sunulur.
Model sağlayıcı: GitHub Copilot (vscode.lm) VEYA şirket içi local LLM (OpenAI uyumlu / Ollama).
Hedef stack: TypeScript + VS Code Extension API + Webview (bağımlılıksız vanilla TS).
Çözülecek kod tabanı: Spring Boot (Java 17, backend+BFF) ve React (TypeScript, ön yüz).

## Mutlak Kurallar (asla ihlal etme)
- OTOMATIK MERGE YOK. Hiçbir kod/test dosyası kullanıcı onayı olmadan yazılmaz.
- Tüm fix'ler ve üretilen test dosyaları önce diff olarak gösterilir; kabul/red kullanıcıya aittir.
- Bağlantı bilgileri (URL/projectKey/token) girilip kaydedilmeden Sonar işlemi yapılamaz (config-gating).
  Aynı şekilde model sağlayıcı yapılandırılmadan çözüm/test üretimi yapılamaz.
- Token ve API anahtarları SADECE VS Code SecretStorage'da tutulur; koda/loga/ayar dosyasına/audit'e yazılmaz.
- Kural dosyasından gelen derleme komutu, Workspace Trust + açık kullanıcı onayı olmadan ÇALIŞTIRILMAZ;
  onay komut metnine bağlıdır, komut değişirse yeniden sorulur.
- Modelin verdiği dosya yolu doğrulanmadan kullanılmaz: mutlak yol, `..` ve test kökü dışı reddedilir.
- Her öneri, onay, ret, derleme ve doğrulama denetim kaydına (audit) işlenir.
- Kritik alan değişiklikleri için test/doğrulama adımı zorunludur.

## Mimari Sınırlar
- src/sonar     : SonarQube Web API istemcisi (tipli)
- src/llm       : sağlayıcı soyutlaması — gateway portu, Copilot, local (openai|ollama), factory
- src/coverage  : kural seti (md+frontmatter), glob, JaCoCo ayrıştırma, derleme + onay kapısı, boşluk analizi
- src/testgen   : test üretimi — istem, güvenli ayrıştırma, orkestratör, doğrulama, akış
- src/fix       : Sonar düzeltme orkestratörü + diff/onay
- src/ui        : TreeView'lar + Webview panelleri (kurulum, bulgu detayı, test kapsamı)
- src/audit     : denetim kaydı + SecretStorage erişimi
- src/config.ts : ayar + gizli değer okuma/yazma, isSonarComplete()/isLlmComplete()
- src/http.ts   : tek fetch adaptörü (HttpClient + PostClient portları)
- Bağımlılık tek yönlü: ui -> {fix, testgen} -> {sonar, coverage, llm}; audit her katmandan çağrılır.
- Her katman bağımlılıklarını constructor (port/arayüz) ile alır; gerçek vscode bağlama extension.ts'te.
- Saf mantık (ayrıştırma, gruplama, istem kurma, kapsam hesabı) vscode import ETMEZ ve doğrudan test edilir.

## Komutlar
- Derleme:  npm run compile
- Test:     npm test
- Lint:     npm run lint
- Paketle:  npm run package  (vsce)

## Kod Standartları
- TypeScript strict mode açık. any kullanma.
- Tüm dış çağrılar (Sonar, lm) try/catch + kullanıcıya anlamlı hata.
- Yeni davranış için her zaman test yaz.

## Çalışma Yöntemi
- Önce Plan Modu, planı bana göster, onaylamadan kod yazma.
- Küçük adımlar; her milestone tek commit.
- Emin değilsen dur ve sor; varsayım yapma.
