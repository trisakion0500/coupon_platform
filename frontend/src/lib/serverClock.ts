import { getHealth } from '@/api/health';

const RESYNC_INTERVAL_MS = 5 * 60 * 1000;

let offsetMs = 0;
let syncStarted = false;

async function sync() {
  try {
    const { server_time } = await getHealth();
    offsetMs = server_time - Date.now();
  } catch {
    // 동기화 실패는 무시 — 마지막으로 성공한 오프셋(최초 동기화 전이면 0)을 그대로 쓴다.
  }
}

/**
 * 오프셋 동기화를 앱 전체에서 1회만 시작한다 — `useServerClock`(헤더 표시)과 `getServerNow`
 * (다른 컴포넌트의 일회성 판단)가 이 모듈의 오프셋을 공유하므로, 여러 곳에서 호출해도 중복
 * 동기화가 일어나지 않는다.
 */
export function startServerClockSync() {
  if (syncStarted) return;
  syncStarted = true;
  void sync();
  setInterval(sync, RESYNC_INTERVAL_MS);
}

/**
 * 오프셋 보정된 "지금"(ms). 헤더의 실시간 시계와 달리 별도 구독/리렌더 트리거가 없는 순수
 * 함수라, 캠페인 활성화 가능 여부처럼 렌더 시점에 한 번만 판단하면 되는 곳에 적합하다 —
 * 브라우저 로컬 `Date.now()`/`dayjs()`를 직접 쓰면 관리자 기기 시계가 실제 서버(DB `NOW()`)
 * 판정과 어긋날 수 있어(헤더 시계 기능 자체가 이 문제를 보여주기 위한 것) 반드시 이 함수를
 * 통해야 한다.
 */
export function getServerNow(): number {
  return Date.now() + offsetMs;
}
