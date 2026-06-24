# Proje: Akıllı Kod Sağlığı Asistanı (VS Code Eklentisi)

## Genel Bakış
SonarQube Enterprise bulgularını VS Code içinde gösteren, Copilot (vscode.lm) ile
çözüm öneren, her değişikliği DIFF olarak kullanıcı onayına sunan eklenti.
Hedef stack: TypeScript + VS Code Extension API + Webview (bağımlılıksız vanilla TS).
Çözülecek kod tabanı: Spring Boot (Java, backend+BFF) ve React (TypeScript, ön yüz).

## Mutlak Kurallar (asla ihlal etme)
- OTOMATIK MERGE YOK. Hiçbir kod değişikliği kullanıcı onayı olmadan dosyaya yazılmaz.
- Tüm fix'ler önce diff olarak gösterilir; kabul/red kullanıcıya aittir.
- Bağlantı bilgileri (URL/projectKey/token) girilip kaydedilmeden işlem yapılamaz (config-gating).
- Token'lar SADECE VS Code SecretStorage'da tutulur; koda/loga/ayar dosyasına yazılmaz.
- Her öneri ve onay denetim kaydına (audit) işlenir.
- Kritik alan değişiklikleri için test/doğrulama adımı zorunludur.

## Mimari Sınırlar
- src/sonar     : SonarQube Web API istemcisi (tipli)
- src/ui        : TreeView + Webview panelleri (config + detay)
- src/fix       : Copilot orkestratörü (vscode.lm) + diff/onay
- src/audit     : denetim kaydı + SecretStorage erişimi
- src/config.ts : ayar + token okuma/yazma, isComplete()
- Katmanlar arası bağımlılık tek yönlü: ui -> fix -> sonar; audit her katmandan çağrılır.
- Her katman bağımlılıklarını constructor (port/arayüz) ile alır; gerçek vscode bağlama extension.ts'te.

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
