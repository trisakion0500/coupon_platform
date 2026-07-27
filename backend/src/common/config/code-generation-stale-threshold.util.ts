/** `computeCodeGenerationStaleThresholdSec`가 받는 재시도 설정 3종(CODE_GENERATION_* env). */
export interface CodeGenerationRetrySettings {
  maxDbRetries: number;
  retryBaseDelayMs: number;
  staleSafetyMultiplier: number;
}

/**
 * "이만큼 `coupon_campaign.updated_at`이 안 움직였으면 코드 생성 job이 멈춘 것으로 본다"는
 * 정체 판정 임계값(초)을 재시도 설정에서 계산한다(07_COUPON_ISSUANCE_SCENARIO.md 2.4). 정상적으로
 * 살아있는 루프가 DB 일시 오류로 재시도할 때 만들 수 있는 이론상 최대 무진행 구간(jitter 최대치
 * 1.0 가정)은 backoff 누적합 `baseDelay × (2^retries − 1)`이므로, 여기에 안전 배율을 곱한다 —
 * 재시도 설정이 바뀌면 이 임계값도 자동으로 같이 늘어나 두 설정이 서로 어긋날 일이 없다.
 *
 * `POST /codes/abort`(`CampaignCodeService`)와 정체 감지 전용 모니터링 크론
 * (`StaleCodeGenerationMonitorService`) 둘 다 이 공식을 공유해야 "정체됐다"는 판정 기준이
 * 서로 어긋나지 않는다 — 원래 `CampaignService`에만 있던 private 계산이었으나, 감지 크론이
 * 신설되며(2026-07-23, 스케일아웃 점검 5번) 공용 유틸로 추출했고, 2026-07-24 리팩터링으로
 * 코드발급 로직 자체가 `CampaignCodeService`로 옮겨갔다.
 */
export function computeCodeGenerationStaleThresholdSec(
  settings: CodeGenerationRetrySettings,
): number {
  const worstCaseRetryWindowMs =
    settings.retryBaseDelayMs * (2 ** settings.maxDbRetries - 1);
  return Math.ceil(
    (worstCaseRetryWindowMs * settings.staleSafetyMultiplier) / 1000,
  );
}
