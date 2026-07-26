import { resetDatabase } from './utils/reset-db';

/**
 * Jest globalSetup — `npm run test:e2e` 실행 시 전체 스펙 파일 실행 전 딱 한 번, 실제 로컬
 * DB(coupon_platform/coupon_platform_log)를 리셋+재시딩한다(`resetDatabase` 참고).
 *
 * @author trisakion
 */
export default async function globalSetup(): Promise<void> {
  await resetDatabase();
}
