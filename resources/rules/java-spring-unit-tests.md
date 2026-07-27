---
# ------------------------------------------------------------------------------
# Akıllı Kod Sağlığı Asistanı — birim test kural seti (ÖRNEK)
#
# Bu dosyayı workspace kökündeki `.code-health/rules/` dizinine kopyalayın ve
# projenize göre uyarlayın. Eklenti bu dizindeki tüm `*.md` dosyalarını okur.
#
# `---` blokları arasındaki alanlar MAKİNE tarafından okunur (eşikler, glob'lar,
# derleme komutu). `---` satırından SONRAKİ Markdown gövdesi ise modele AYNEN
# iletilir; ekibinizin test yazım kuralları oraya yazılır.
# ------------------------------------------------------------------------------

id: java-spring-unit-tests
name: Spring Boot 3 / Java 17 Birim Test Kuralları
language: java
enabled: true
priority: 100

# Test kapsamı aranacak kaynak dosyalar
include:
  - "**/src/main/java/**/*.java"

# Birim testi beklenmeyen dosyalar
exclude:
  - "**/*Application.java"
  - "**/config/**"
  - "**/configuration/**"
  - "**/dto/**"
  - "**/*Dto.java"
  - "**/*Request.java"
  - "**/*Response.java"
  - "**/entity/**"
  - "**/*Entity.java"
  - "**/exception/**"
  - "**/constants/**"
  - "**/*Constants.java"
  - "**/generated/**"

coverage:
  tool: jacoco
  # Çok modüllü Maven projelerinde her modülün raporu ayrı ayrı bulunur.
  reportPath: "**/target/site/jacoco/jacoco.xml"
  # Raporu üreten komut. Eklenti bunu modül kökünde çalıştırır ve ÖNCE onay ister.
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

- Üretim kodunu **değiştirme**. Yalnızca test dosyası üret.
- Sınıf başına tek test dosyası: `com.kurum.OrderService` → `src/test/java/com/kurum/OrderServiceTest.java`.
  Paket bildirimi üretim sınıfıyla **aynı** olmalıdır.
- Mevcut bir test dosyası verildiyse **onu koru ve genişlet**: var olan testleri silme,
  yeniden adlandırma veya davranışını değiştirme; yalnızca eksik senaryolar için yeni metotlar ekle.
- Testler **deterministik** olmalı: rastgele değer, gerçek saat, uyku (`Thread.sleep`),
  ağ/veritabanı/dosya sistemi erişimi kullanma.
- Testler birbirinden bağımsız olmalı ve herhangi bir sırada çalışabilmelidir.

## Yığın ve import'lar

- JUnit 5 (`org.junit.jupiter.api.*`), Mockito (`org.mockito.*`), AssertJ (`org.assertj.core.api.Assertions.assertThat`).
- Saf birim testi yaz: `@ExtendWith(MockitoExtension.class)` + `@Mock` + `@InjectMocks`.
  **Spring context'i ayağa kaldırma** (`@SpringBootTest` kullanma) — yavaştır ve birim testi değildir.
- Java 17 dilini kullanabilirsin (`var`, text block, record, switch expression).
- Yalnızca gerçekten kullanılan import'ları yaz; joker (`import x.*`) import kullanma.

## Adlandırma ve yapı

- Test metodu adı: `metotAdi_kosul_beklenenSonuc` (ör. `create_whenCustomerMissing_throwsNotFound`).
- Gerekirse `@DisplayName` ile okunur bir Türkçe açıklama ekle.
- Her test **given / when / then** yorum bloklarıyla üç bölüme ayrılır.
- Bir test tek bir davranışı doğrular; ilgisiz assertion'ları aynı teste yığma.

## Assertion kuralları

- Assertion'lar **AssertJ** ile yazılır: `assertThat(actual).isEqualTo(expected)`.
  `assertEquals` gibi ham JUnit assertion'ları kullanma.
- İstisna testleri: `assertThatThrownBy(() -> service.create(req)).isInstanceOf(NotFoundException.class).hasMessageContaining("müşteri")`.
- Koleksiyonlarda `containsExactly` / `containsExactlyInAnyOrder` gibi anlamlı matcher'ları tercih et.
- Her testte en az bir assertion bulunmalı; yalnızca `verify(...)` içeren test yazma
  (etkileşim doğrulaması sonucun yerine geçmez).

## Mock ve izolasyon kuralları

- Tüm dış bağımlılıklar (repository, client, publisher, mapper) `@Mock` ile izole edilir.
- Yalnızca o testte gerçekten kullanılan stub'ları tanımla; gereksiz `when(...)` yazma
  (Mockito `UnnecessaryStubbingException` fırlatır).
- Yan etkileri (kaydetme, olay yayınlama) `verify(repo).save(captor.capture())` ile doğrula ve
  `ArgumentCaptor` ile yakalanan nesnenin alanlarını assert et.
- Statik/`final` sınıfları mock'lamaya çalışma; test edilemeyen tasarımı GEREKÇE bölümünde belirt.

## Kapsanacak senaryolar

Kapsanmayan her public metot için **en az**:

1. **Mutlu yol** — geçerli girdi, beklenen sonuç.
2. **Hata yolu** — geçersiz girdi veya bağımlılığın istisna fırlatması.
3. **Sınır durumları** — `null`, boş koleksiyon, sıfır/negatif değer, eşik değerleri.
4. **Dallar** — `if` / `switch` / ternary / `Optional` dallarının her biri; branch kapsamı için şarttır.

Aynı mantığın farklı girdilerle tekrarı gerekiyorsa `@ParameterizedTest` + `@ValueSource` /
`@CsvSource` / `@MethodSource` kullan.

## Yasaklar

- `@Disabled` veya yorum satırına alınmış test bırakma.
- Boş gövdeli veya yalnızca `assertTrue(true)` içeren test yazma.
- Testin geçmesi için üretim kodunun davranışını varsayma; kaynağı okuyup gerçek davranışı test et.
- Gerçek `System.out` çıktısına, saat/rastgeleliğe veya çalışma sırasına bağımlılık kurma.

## Çıktı

- Yanıt **tek bir tam Java dosyası** olmalıdır: `package`, `import`'lar ve sınıf gövdesi eksiksiz.
- Dosya olduğu gibi kaydedilip `mvn clean install` ile derleneceği için **derlenebilir** olmalıdır.
