import * as vscode from 'vscode';

/** Onay kararının kalıcı olarak tutulduğu depo (`context.workspaceState` ile bağlanır). */
export interface ConsentStore {
  get(key: string): string | undefined;
  update(key: string, value: string): Promise<void>;
}

const KEY_PREFIX = 'codeHealth.buildConsent:';

export interface ConsentResult {
  allowed: boolean;
  /** İzin verilmediyse kullanıcıya gösterilecek gerekçe. */
  reason?: string;
}

/**
 * Derleme komutunu çalıştırmadan ÖNCE çağrılmalıdır.
 *
 * Komut metni kural dosyasından (yani workspace içeriğinden) geldiği için keyfi kod
 * yürütme yüzeyidir. Üç kapı uygulanır:
 *  1. Workspace Trust zorunlu — güvenilmeyen klasörde asla çalıştırılmaz.
 *  2. İlk çalıştırmada komut, dizin ve (varsa) JDK kökü gösterilerek modal onay alınır.
 *  3. Onay komut metnine VE JDK köküne bağlı saklanır; biri değişirse yeniden sorulur.
 */
export async function ensureBuildConsent(
  command: string,
  cwd: string,
  displayCwd: string,
  state: ConsentStore,
  javaHome?: string
): Promise<ConsentResult> {
  if (!vscode.workspace.isTrusted) {
    return {
      allowed: false,
      reason:
        'Bu workspace güvenilir olarak işaretlenmediği için derleme komutu çalıştırılmaz. ' +
        'Kapsam taraması için klasöre güvenin (Workspace Trust) veya raporu kendiniz üretip yalnızca okumayı seçin.'
    };
  }

  const key = KEY_PREFIX + cwd;
  // Onay değeri komutu ve JDK kökünü birlikte kapsar; ikisinden biri değişirse yeniden sorulur.
  const approved = javaHome ? `${command}\nJAVA_HOME=${javaHome}` : command;
  if (state.get(key) === approved) {
    return { allowed: true };
  }

  const choice = await vscode.window.showWarningMessage(
    'Kod Sağlığı, kural setinizde tanımlı derleme komutunu çalıştıracak.',
    {
      modal: true,
      detail:
        `Komut:  ${command}\n` +
        `Dizin:  ${displayCwd || '(workspace kökü)'}\n` +
        (javaHome ? `JAVA_HOME:  ${javaHome}\n` : '') +
        '\nBu komut kural dosyanızdan okunur ve kabuk üzerinde çalıştırılır. ' +
        'Yalnızca içeriğine güvendiğiniz depolarda onaylayın.'
    },
    'Çalıştır ve Bir Daha Sorma',
    'Yalnızca Bu Kez'
  );

  if (choice === 'Çalıştır ve Bir Daha Sorma') {
    await state.update(key, approved);
    return { allowed: true };
  }
  if (choice === 'Yalnızca Bu Kez') {
    return { allowed: true };
  }
  return { allowed: false, reason: 'Derleme komutu onaylanmadı; kapsam taraması yapılmadı.' };
}
