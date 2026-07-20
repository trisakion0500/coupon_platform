import { Injectable } from '@nestjs/common';
import { LogSpExecutorService } from '../database/log-sp-executor.service';
import { AuditAction } from './audit-action.enum';

/** 감사 대상 테이블(13_LOG_AUDIT_API.md 2.1) — coupon_campaign/coupon_code 등은 별도 로그로 관리하므로 여기 포함하지 않는다. */
export type AuditTableName = 'company' | 'project' | 'user' | 'user_role';

/**
 * `AuditLogService.record()` 호출 시 필요한 값 — 대부분 각 도메인 SP(SP_COMPANY_UPDATE 등)가
 * 이미 계산해 반환한 값을 그대로 옮기기만 하면 된다(02_DEV_CONVENTIONS.md 3.2, "SP 내부 캡처"
 * 방식 참고).
 */
export interface AuditLogEntry {
  action: AuditAction;
  /** company/user는 자기 자신, project/user_role은 소속 회사(project.company_id) */
  companyId: number | null;
  /** company/user는 NULL, project/user_role은 자기 자신 */
  projectId: number | null;
  tableName: AuditTableName;
  /** 단일 PK는 문자열화한 값, 복합 PK(user_role)는 `{"user_id":x,"project_id":y}` JSON 문자열 */
  targetId: string;
  targetName: string | null;
  /** SP가 JSON_OBJECT(...)로 반환한 값(mysql2가 JS 객체로 파싱) — CREATE는 null */
  beforeJson: Record<string, unknown> | null;
  /** SP가 JSON_OBJECT(...)로 반환한 값(mysql2가 JS 객체로 파싱) */
  afterJson: Record<string, unknown>;
  createdBy: number;
  createdByName: string | null;
}

/**
 * `log_audit`(company/project/user/user_role 감사 로그) 적재 공용 래퍼. 각 도메인 서비스가
 * `LogSpExecutorService.logCall`을 직접 호출하지 않고 이 서비스를 통하게 해, 파라미터 순서/
 * JSON 직렬화 같은 세부사항을 한 곳에서만 관리한다(02_DEV_CONVENTIONS.md 2장 모듈화 원칙).
 *
 * @author trisakion
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly logSpExecutor: LogSpExecutorService) {}

  /**
   * 감사 로그를 적재한다. `LogSpExecutorService.logCall`이 이미 실패를 삼키므로(로그 DB 장애가
   * 메인 트랜잭션에 영향을 주면 안 된다는 02_DEV_CONVENTIONS.md 1장 원칙) fire-and-forget으로
   * 호출해도 안전하다 — 호출부는 `await` 없이 그대로 두거나 `void`로 명시한다.
   */
  async record(entry: AuditLogEntry): Promise<void> {
    await this.logSpExecutor.logCall('SP_LOG_AUDIT_CREATE', [
      entry.action,
      entry.companyId,
      entry.projectId,
      entry.tableName,
      entry.targetId,
      entry.targetName,
      entry.beforeJson === null ? null : JSON.stringify(entry.beforeJson),
      JSON.stringify(entry.afterJson),
      entry.createdBy,
      entry.createdByName,
    ]);
  }
}
