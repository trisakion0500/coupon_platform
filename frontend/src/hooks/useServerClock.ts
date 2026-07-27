import { useEffect, useState } from 'react';
import { getServerNow, startServerClockSync } from '@/lib/serverClock';

const TICK_INTERVAL_MS = 1000;

/**
 * 18_LAYOUT.md 2.1 — 헤더 실시간 시계용. 오프셋 동기화 자체는 `lib/serverClock`이 앱 전체에서
 * 공유하고(`startServerClockSync`가 중복 호출에 안전), 이 훅은 1초마다 리렌더를 트리거해
 * 화면에 흘러가는 시계를 보여주는 역할만 한다 — 오프셋이 필요한데 매초 리렌더까지는 필요 없는
 * 곳(예: 캠페인 활성화 가능 여부 판단)은 `getServerNow()`를 직접 쓰면 된다.
 */
export function useServerClock(): number {
  const [now, setNow] = useState(() => getServerNow());

  useEffect(() => {
    startServerClockSync();
    const tickTimer = setInterval(() => {
      setNow(getServerNow());
    }, TICK_INTERVAL_MS);

    return () => {
      clearInterval(tickTimer);
    };
  }, []);

  return now;
}
