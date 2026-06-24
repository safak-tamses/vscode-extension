# Akıllı Kod Sağlığı Asistanı — Claude Code Uygulama Planı

> Amaç: VS Code eklentisini (Sonar bulgularını tespit → görselleştir → açıkla → Copilot ile çöz → diff onayı) **Claude Code** ile, ~1 ayda pilota hazır hale getirmek.
> Bu doküman repo köküne konulmak ve Claude Code oturumlarında referans alınmak üzere yazılmıştır.

---

## 0. Roller ve net ayrım (önemli)

| Katman | Ne işe yarar |
|---|---|
| **Claude Code** | Eklentiyi **yazan** geliştirme ajanı (terminal / VS Code eklentisi). |
| **Copilot (`vscode.lm`)** | Eklentinin **çalışma anında** kullanıcıya fix önerisi üreten LLM katmanı. |
| **SonarQube MCP Server** | Geliştirme sırasında Claude Code'a SonarQube verisine (issue, kural, hotspot, kalite kapısı) erişim veren resmi araç. |

Yani: Claude Code ürünü inşa eder; Copilot ürünün içindeki motordur; SonarQube MCP ise hem geliştirmeyi hızlandırır hem de bulgu veri modelini doğrular.

---

## 1. Ön hazırlık (Gün 0)

### 1.1 Kurulum
- Node.js LTS kurulu olmalı.
- Claude Code: `npm i -g @anthropic-ai/claude-code` **veya** VS Code Eklentiler panelinden "Claude Code" araması ile kurulum (inline diff, @-mention, plan inceleme ve oturum geçmişi sağlar).
- Repo'yu oluştur: `git init code-health-assistant && cd code-health-assistant`

### 1.2 SonarQube MCP Server'ı bağla (geliştirme aracı olarak)
Resmi imaj Docker ile çalışır. Kurumsal **self-hosted SonarQube Server** için:

```bash
claude mcp add sonarqube \
  --env SONARQUBE_TOKEN=$SONARQUBE_TOKEN \
  --env SONARQUBE_URL=https://sonar.kurum-ici.local \
  -- docker run -i --rm --init --pull=always \
     -e SONARQUBE_TOKEN -e SONARQUBE_URL \
     -v "$PWD:/app/mcp-workspace:rw" \
     sonarsource/sonarqube-mcp:<surum>
```

Banka için kritik notlar:
- **Token'ı asla config dosyasına yazma.** Ortam değişkeni olarak export et; Docker `-e` ile konteynıra iletir.
- **Workspace mount** (`-v .../mcp-workspace`) sayesinde dosya içeriği ajan bağlamından geçmeden diskten okunur — veri sızıntısı yüzeyini azaltır.
- Telemetriyi kapat: `-e TELEMETRY_DISABLED=true`.
- Sürümü **pinle** (`:<surum>`), `latest` kullanma — kurumsal değişiklik kontrolü için.
- `/mcp` komutuyla bağlantının kurulduğunu doğrula.

> Not: MCP server geliştirme/keşif içindir. Eklentinin **runtime** SonarQube erişimi, eklenti içinde yazacağımız tipli REST istemcisidir (bkz. Hafta 1).

### 1.3 Proje hafızasını başlat
Claude Code oturumunda:
```
/init
```
Ardından üretilen `CLAUDE.md` dosyasını aşağıdaki şablonla değiştir.

---

## 2. CLAUDE.md şablonu (repo köküne)

```markdown
# Proje: Akıllı Kod Sağlığı Asistanı (VS Code Eklentisi)

## Genel Bakış
SonarQube Enterprise bulgularını VS Code içinde gösteren, Copilot (vscode.lm) ile
çözüm öneren, her değişikliği DIFF olarak kullanıcı onayına sunan eklenti.
Hedef stack: TypeScript + VS Code Extension API + Webview (React).
Çözülecek kod tabanı: Spring Boot (Java, backend+BFF) ve React (TypeScript, ön yüz).

## Mutlak Kurallar (asla ihlal etme)
- OTOMATIK MERGE YOK. Hiçbir kod değişikliği kullanıcı onayı olmadan dosyaya yazılmaz.
- Tüm fix'ler önce diff olarak gösterilir; kabul/red kullanıcıya aittir.
- Token'lar SADECE VS Code SecretStorage'da tutulur; koda/loga/ayar dosyasına yazılmaz.
- Her öneri ve onay denetim kaydına (audit) işlenir.
- Kritik alan değişiklikleri için test/doğrulama adımı zorunludur.

## Mimari Sınırlar
- src/sonar     : SonarQube Web API istemcisi (tipli)
- src/ui        : TreeView + Webview paneli
- src/fix       : Copilot orkestratörü (vscode.lm) + diff/onay
- src/audit     : denetim kaydı + SecretStorage erişimi
- Katmanlar arası bağımlılık tek yönlü: ui -> fix -> sonar; audit her katmandan çağrılır.

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
```

---

## 3. Repo iskeleti (Hedef yapı)

```
code-health-assistant/
├─ CLAUDE.md
├─ .claude/
│  ├─ settings.json          # izinler, hook'lar, mcpServers
│  ├─ commands/
│  │  ├─ fix-rule.md         # /fix-rule  : tek kural için fix akışı
│  │  └─ review-diff.md      # /review-diff: üretilen diff'i denetle
│  └─ agents/
│     └─ reviewer.md         # bağımsız "gözden geçiren" alt-ajan
├─ .mcp.json                 # SonarQube MCP (takımla paylaşılan)
├─ src/
│  ├─ sonar/  ├─ ui/  ├─ fix/  └─ audit/
├─ test/
└─ package.json
```

`.claude/settings.json` (izinleri sıkı tut):
```json
{
  "permissions": {
    "allow": ["Read", "Edit", "Bash(npm run *)", "Bash(git *)"],
    "deny":  ["Bash(rm -rf *)", "Bash(curl *)", "Bash(npm publish *)"]
  },
  "hooks": {
    "PostToolUse": [
      { "matcher": "Write|Edit",
        "command": "npm run lint --silent && npm run compile --silent" }
    ]
  }
}
```

---

## 4. Claude Code ile çalışma ritmi (her görevde uygula)

1. **Plan Modu ile başla** — `Shift+Tab` ile Plan Modu'na geç (salt-okunur). "Şu milestone'u planla" de, planı oku/onayla.
2. **Uygula** — onaydan sonra Default moda dön; edit'ler tek tek izninle ilerlesin (Auto-Accept'i bu projede kapalı tut — "otomatik merge yok" ilkesinin geliştirme karşılığı).
3. **Diff'i incele** — VS Code eklentisinde inline diff'i gözden geçir.
4. **Test + commit** — `npm test`, ardından milestone tek commit.
5. **Bağlamı temizle** — yeni göreve geçerken `/clear`; uzun süren görevde bağlam dolarsa `/compact`.
6. **Tekrarlayan iş için slash komutu** — örn. `/fix-rule java:S2095`.
7. **Bağımsız denetim için alt-ajan** — `reviewer` alt-ajanı üretilen fix'i ayrı bağlamda denetler (model rolü ayrışsın diye).

> İpucu: Karmaşık orkestrasyonda güçlü model (`claude-opus-4-8`), rutin/tekrarlı işlerde daha hızlı model (`claude-sonnet-4-6`) seç.

---

## 5. Faz 1 — 4 haftalık (~1 ay) milestone planı

Her milestone için: **Hedef → Claude Code prompt'u → Çıktı → Kabul kriteri**.

### Hafta 1 — Keşif & SonarQube Bağlantısı
**Hedef:** Eklenti iskeleti + tipli SonarQube istemcisi (issue/kural çekme).

**Prompt (Plan Modu):**
```
Plan modu. VS Code eklentisi iskeleti kur (yo code yerine elle, TypeScript strict).
src/sonar altında SonarQube Web API istemcisi tasarla:
- /api/issues/search (proje + branch parametreli, sayfalama)
- /api/rules/show (kural açıklaması)
- /api/hotspots/search (güvenlik)
Token'ı SecretStorage'dan oku. Tüm yanıtlar için tipli arayüzler üret.
Önce planı ve dosya listesini göster; onaylamadan kod yazma.
```
İsteğe bağlı doğrulama: SonarQube MCP üzerinden gerçek bir projenin issue şemasını
çektir, istemci tiplerini buna göre netleştir.

**Çıktı:** Çalışan iskelet, `src/sonar` istemcisi, birim testleri (mock yanıt).
**Kabul:** `npm run compile` + `npm test` yeşil; gerçek token ile issue listesi log'lanıyor.

---

### Hafta 2 — Görselleştirme & Açıklama
**Hedef:** Dosya bazlı bulgu paneli + tıkla→açıklama.

**Prompt:**
```
Plan modu. src/ui altında:
- Bulguları proje > dosya > önem derecesi olarak gruplayan bir TreeView.
- Bir bulguya tıklanınca Webview detay paneli aç: kural adı, önem, mesaj,
  "neden sorun" açıklaması (rules/show'dan), kod konumu.
- Panelden "Çöz" ve "Tümünü Çöz" aksiyon butonları (şimdilik stub).
Webview'i React ile yaz, mesajlaşmayı (postMessage) tipli kur.
```
**Çıktı:** Gezinilebilir bulgu paneli, açıklama görünümü.
**Kabul:** Gerçek bulgular dosya bazlı görünüyor; tıklama açıklamayı getiriyor.

---

### Hafta 3 — Çözüm Orkestratörü & Diff/Onay (en kritik)
**Hedef:** Copilot (vscode.lm) ile fix üretimi + diff önizleme + onay/red + gerekçe.

**Prompt:**
```
Plan modu. src/fix altında fix orkestratörü:
1. Seçili bulgu için bağlam derle: dosya parçası (snippet), kural açıklaması, mesaj.
2. vscode.lm ile Copilot modelini çağır; çıktı: önerilen yeni kod + DEĞİŞİKLİK GEREKÇESİ.
3. Değişikliği OTOMATIK UYGULAMA. VS Code diff editöründe önizleme aç.
4. Kullanıcı kabul ederse WorkspaceEdit ile uygula; reddederse at; her iki durumu audit'e yaz.
5. "Tümünü Çöz": her fix yine ayrı ayrı diff onayına düşer (toplu sessiz uygulama YOK).
Gerekçe metni: ne değişti, neden, hangi kuralı kapatıyor — kullanıcıya net göster.
```
**Çıktı:** Tek ve toplu çözüm akışı; her değişiklik diff + gerekçe ile onaya geliyor.
**Kabul:** Onaysız hiçbir yazma olmuyor; red akışı temiz; gerekçe görünür; audit kaydı oluşuyor.

---

### Hafta 4 — Pilot Sertleştirme
**Hedef:** Denetim kaydı, hata yönetimi, kapanış doğrulama, paketleme, testler.

**Prompt:**
```
Plan modu. Pilot için sağlamlaştır:
- src/audit: hangi bulgu/öneri/onay, kim, ne zaman — yapılandırılmış kayıt.
- Copilot erişilemezse graceful degradation: bulgu görüntüleme + manuel çözüm çalışmaya devam etsin.
- Fix sonrası ilgili bulguyu yeniden tara, kapandığını doğrula.
- Birim + entegrasyon testleri; vsce ile paketleme (npm run package).
- README + pilot kullanım notu.
```
**Çıktı:** Paketlenebilir `.vsix`, denetim kaydı, testler.
**Kabul:** 1–2 pilot takım kurabiliyor; KPI'lar (kabul oranı, çözüm süresi, geri dönüş) ölçülebiliyor.

---

## 6. Örnek slash komutu (`.claude/commands/fix-rule.md`)

```markdown
---
description: Tek bir Sonar kuralı için bulguları çöz (diff onaylı)
allowed-tools: Read, Edit, Bash(npm run *)
---
$ARGUMENTS kuralına ait bulguları SonarQube'den çek. Her bulgu için:
1) Bağlamı derle, 2) fix öner + gerekçe yaz, 3) diff göster (uygulama).
Hiçbir değişikliği otomatik uygulama; her birini onaya sun. Sonunda özet ver.
```

Kullanım: `/fix-rule java:S2095`

---

## 7. Güvenlik & uyum kontrol listesi (banka)

- [ ] Token yalnızca `export` + SecretStorage; repoda/loglarda yok.
- [ ] SonarQube MCP: workspace mount açık, telemetri kapalı, sürüm pinli.
- [ ] `.claude/settings.json` izinleri sıkı; yıkıcı komutlar `deny`.
- [ ] Auto-Accept Edits kapalı; tüm yazma onaya tabi.
- [ ] Denetim kaydı her öneri/onay için aktif.
- [ ] Yeni bağımlılıklar gözden geçiriliyor (lisans + güvenlik).
- [ ] Copilot kurumsal veri politikası güvenlik/uyum ile teyit edildi.

---

## 8. Tanım: "Bitti" (Definition of Done)

**Milestone DoD:** Plan onaylandı · kod + test yazıldı · lint/compile yeşil · diff insan onayından geçti · tek commit.
**Faz 1 DoD:** `.vsix` paketlenebiliyor · onaysız yazma yok · audit çalışıyor · pilot takım kurulumu yapabildi · KPI ölçümü başladı.

---

## 9. Sonraki fazlar (özet)

- **Faz 2 — Fortify (SAST):** güvenlik bulgularını aynı panele entegre et; sıkı onay/test kuralları.
- **Faz 3 — Commit-anı diff taraması:** git commit adımında değişen kodu tara, diff üzerinden olası sorunları erken tespit et ve anlık çözüm öner (shift-left). Claude Code tarafında bir `PreToolUse`/commit hook veya yerel git hook ile prototiplenebilir.

---

### Hızlı başlangıç özeti
1. Claude Code + SonarQube MCP kur → `/mcp` ile doğrula.
2. `/init` → `CLAUDE.md`'yi şablonla değiştir.
3. Her hafta: Plan Modu → onayla → uygula → diff incele → test → commit → `/clear`.
4. Otomatik merge yok; her fix diff + gerekçe + onay.
