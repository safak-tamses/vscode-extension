export interface ParsedFix {
  /** Önerilen yeni kod; boşsa uygulanabilir bir öneri yok. */
  newCode: string;
  /** Değişiklik gerekçesi (kullanıcıya gösterilir). */
  rationale: string;
}

const FENCE = /```[a-zA-Z0-9]*\n([\s\S]*?)```/;
const RATIONALE_MARKER = /(?:RATIONALE|GEREK[ÇC]E)\s*:\s*([\s\S]*)/i;

/** LLM yanıtından kod bloğunu ve gerekçeyi ayrıştırır (saf fonksiyon). */
export function parseFixResponse(raw: string): ParsedFix {
  const fence = raw.match(FENCE);
  const newCode = fence && fence[1] ? fence[1].replace(/\n+$/, '') : '';

  let rationale: string;
  const marker = raw.match(RATIONALE_MARKER);
  if (marker && marker[1]) {
    rationale = marker[1].trim();
  } else if (fence && fence.index !== undefined) {
    const after = raw.slice(fence.index + fence[0].length).trim();
    rationale = after || raw.slice(0, fence.index).trim();
  } else {
    rationale = raw.trim();
  }

  return { newCode, rationale };
}
