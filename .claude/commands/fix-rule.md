---
description: Tek bir Sonar kuralı için bulguları çöz (diff onaylı)
allowed-tools: Read, Edit, Bash(npm run *)
---
$ARGUMENTS kuralına ait bulguları SonarQube'den çek. Her bulgu için:
1) Bağlamı derle, 2) fix öner + gerekçe yaz, 3) diff göster (uygulama).
Hiçbir değişikliği otomatik uygulama; her birini onaya sun. Sonunda özet ver.
