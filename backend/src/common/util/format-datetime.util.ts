/**
 * 08_API_COMMON.md 4장: 날짜/시간은 `YYYY-MM-DD HH:mm:ss` 문자열로 전송하며 타임존 변환을
 * 수행하지 않는다(서비스와 DB가 동일한 타임존 환경이라는 전제). DB에서 조회한 DATETIME 값은
 * mysql2의 `dateStrings: true` 설정으로 이미 이 형식의 문자열로 오므로, 이 함수는 앱 레이어에서
 * 직접 계산한 `Date`(예: JWT 만료시각)를 응답에 실을 때만 필요하다.
 *
 * @author trisakion
 */
export function formatDateTime(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}
