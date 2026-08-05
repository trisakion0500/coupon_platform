import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { AuditAction } from '../common/audit-log/audit-action.enum';
import { AuditLogService } from '../common/audit-log/audit-log.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { SpExecutorService } from '../common/database/sp-executor.service';
import { ProjectIdentityCacheService } from '../common/project-identity-cache/project-identity-cache.service';
import { BusinessException } from '../common/response/business.exception';
import {
  buildPaginatedResult,
  PaginatedResult,
} from '../common/response/pagination';
import { ResultCode } from '../common/response/result-code.enum';
import { RoleCode } from '../common/roles/role-code.enum';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectListQueryDto } from './dto/project-list-query.dto';
import { RotateApiSecretDto } from './dto/rotate-api-secret.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

export interface ProjectRow {
  project_id: number;
  company_id: number;
  company_code: string;
  company_name: string;
  project_code: string;
  project_name: string;
  api_key: string;
  description: string | null;
  status: number;
  secret_rotated_at: string | null;
  created_at: string;
  updated_at: string;
  /** 낙관적 동시성 제어 토큰 — PATCH/재발급 요청 시 이 값을 그대로 되돌려 보내야 한다. */
  edit_count: number;
}

/**
 * SP_PROJECT_LIST 반환 행 — 요청한 page가 데이터 범위를 벗어나면 project_id를 비롯한
 * 모든 데이터 컬럼이 NULL인 채로 total_count만 채워진 행 1개가 온다(LEFT JOIN ... ON TRUE).
 */
interface ProjectListRow extends Omit<ProjectRow, 'project_id'> {
  project_id: number | null;
  total_count: number;
}

/** SP_PROJECT_CREATE가 반환하는 행 — company 조인 없이 자기 자신의 컬럼만 있다. */
interface ProjectCreateRow {
  project_id: number;
  company_id: number;
  project_code: string;
  project_name: string;
  description: string | null;
  api_key: string;
  status: number;
  created_at: string;
  updated_at: string;
  edit_count: number;
  /** 감사로그(log_audit)용 — after_json은 api_secret류가 '***'로 마스킹돼 있다. */
  after_json: Record<string, unknown>;
  requester_name: string | null;
}

export interface ProjectCreateResponse {
  project_id: number;
  company_id: number;
  project_code: string;
  project_name: string;
  description: string | null;
  api_key: string;
  status: number;
  created_at: string;
  updated_at: string;
  edit_count: number;
  /** 이 응답에만 1회 노출되는 평문 Secret(13_PROJECT_API.md 2.1). */
  api_secret: string;
}

export interface ProjectLookupRow {
  project_id: number;
  project_name: string;
}

export interface ApiSecretRotateResponse {
  project_id: number;
  /** 이 응답에만 1회 노출되는 평문 Secret(13_PROJECT_API.md 2.5). */
  api_secret: string;
  secret_rotated_at: string;
  edit_count: number;
}

/** SP_PROJECT_UPDATE 반환 행 — 감사로그(log_audit)용 before_json/after_json/requester_name 포함. */
interface ProjectUpdateRow extends ProjectRow {
  before_json: Record<string, unknown>;
  after_json: Record<string, unknown>;
  requester_name: string | null;
}

/** SP_PROJECT_API_SECRET_ROTATE 반환 행 — 감사로그(log_audit)용 필드 포함. */
interface ApiSecretRotateRow {
  project_id: number;
  company_id: number;
  project_name: string;
  secret_rotated_at: string;
  edit_count: number;
  before_json: Record<string, unknown>;
  after_json: Record<string, unknown>;
  requester_name: string | null;
}

/** 요청자 컨텍스트 — JwtAuthGuard가 검증한 JWT 페이로드 값(DB 재조회 없이 신뢰). */
export interface ProjectRequester {
  userId: number;
  roleCode: RoleCode;
  companyId: number;
}

/**
 * 13_PROJECT_API.md 6개 엔드포인트(생성/목록/상세/수정/Secret재발급/코드조회)의 비즈니스 로직.
 *
 * @author trisakion
 */
@Injectable()
export class ProjectService {
  constructor(
    private readonly spExecutor: SpExecutorService,
    private readonly crypto: CryptoService,
    private readonly auditLog: AuditLogService,
    private readonly projectIdentityCache: ProjectIdentityCacheService,
  ) {}

  async create(
    dto: CreateProjectDto,
    requesterUserId: number,
  ): Promise<ProjectCreateResponse> {
    const apiKey = this.generateRandomHex();
    const apiSecretPlain = this.generateRandomHex();
    const apiSecretEnc = this.crypto.encrypt(apiSecretPlain);

    const { result, data } = await this.spExecutor.callProcedure<
      ProjectCreateRow[]
    >('SP_PROJECT_CREATE', [
      dto.company_id,
      dto.project_code,
      dto.project_name,
      dto.description ?? null,
      apiKey,
      apiSecretEnc,
      requesterUserId,
    ]);

    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result === 31001) {
      throw new BusinessException(ResultCode.COMPANY_NOT_FOUND);
    }
    if (result === 32001) {
      throw new BusinessException(ResultCode.DUPLICATE_DATA);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const row = data[0];
    void this.auditLog.record({
      action: AuditAction.CREATE,
      companyId: row.company_id,
      projectId: row.project_id,
      tableName: 'project',
      targetId: String(row.project_id),
      targetName: row.project_name,
      beforeJson: null,
      afterJson: row.after_json,
      createdBy: requesterUserId,
      createdByName: row.requester_name,
    });
    // log_coupon_rate_limit 적재용 api_key->{project_id,company_id} write-through 캐시
    // (ProjectIdentityCacheService) — 실패해도 무시, 첫 캐시미스 때 SP 폴백으로 자연 복구된다.
    void this.projectIdentityCache.cacheIdentity(
      row.api_key,
      row.project_id,
      row.company_id,
    );

    return {
      project_id: row.project_id,
      company_id: row.company_id,
      project_code: row.project_code,
      project_name: row.project_name,
      description: row.description,
      api_key: row.api_key,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      edit_count: row.edit_count,
      api_secret: apiSecretPlain,
    };
  }

  /**
   * DEVELOPER의 스코핑은 더 이상 회사 단위가 아니다 — SUPER_ADMIN을 제외한 모든 호출자는
   * 실제 활성 `user_role`이 배정된 프로젝트만 보게끔 SP가 행 단위로 필터링한다(2026-07-24,
   * API Key/Secret을 다루는 화면이라 같은 회사 소속이라는 이유만으로 담당 아닌 프로젝트까지
   * 보이는 걸 문제로 판단해 캠페인 도메인과 동일한 user_role 기준으로 통일). `query.company_id`는
   * 스코핑이 아니라 누구나 쓸 수 있는 순수 필터라 role과 무관하게 그대로 전달한다.
   */
  async list(
    query: ProjectListQueryDto,
    requester: ProjectRequester,
  ): Promise<PaginatedResult<ProjectRow>> {
    const offset = (query.page - 1) * query.page_size;
    const { result, data } = await this.spExecutor.callProcedure<
      ProjectListRow[]
    >('SP_PROJECT_LIST', [
      query.company_id ?? null,
      query.status ?? null,
      query.page_size,
      offset,
      requester.userId,
    ]);

    if (result !== 0) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const rows = data ?? [];
    const totalCount = rows[0]?.total_count ?? 0;
    const items: ProjectRow[] = rows
      .filter(
        (row): row is ProjectListRow & { project_id: number } =>
          row.project_id !== null,
      )
      .map((row) => ({
        project_id: row.project_id,
        company_id: row.company_id,
        company_code: row.company_code,
        company_name: row.company_name,
        project_code: row.project_code,
        project_name: row.project_name,
        api_key: row.api_key,
        description: row.description,
        status: row.status,
        secret_rotated_at: row.secret_rotated_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        edit_count: row.edit_count,
      }));

    return buildPaginatedResult(query, totalCount, items);
  }

  /**
   * DEVELOPER의 접근 판단 기준은 회사 소속이 아니라 실제 활성 `user_role` 배정 여부다
   * (2026-07-24, list()와 동일한 이유). user_role 배정 여부는 앱이 JWT만으로 판단할 수 없는
   * 정보라 앱 레이어에서 중복 검증하지 않는다 — SP(`FN_CHECK_PROJECT_ACCESS`)가 유일한
   * 방어선이다(campaign 도메인의 getById와 동일한 패턴, 04_DEV_CONVENTIONS.md 3.2 예외).
   */
  async getById(
    projectId: number,
    requester: ProjectRequester,
  ): Promise<ProjectRow> {
    const { result, data } = await this.spExecutor.callProcedure<ProjectRow[]>(
      'SP_PROJECT_GET_BY_ID',
      [projectId, requester.userId],
    );

    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.PROJECT_NOT_FOUND);
    }

    return data[0];
  }

  async update(
    projectId: number,
    dto: UpdateProjectDto,
    requesterUserId: number,
  ): Promise<ProjectRow> {
    const { result, data } = await this.spExecutor.callProcedure<
      ProjectUpdateRow[]
    >('SP_PROJECT_UPDATE', [
      projectId,
      dto.edit_count,
      dto.project_name ?? null,
      dto.description ?? null,
      dto.status ?? null,
      requesterUserId,
    ]);

    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result === 31002) {
      throw new BusinessException(ResultCode.PROJECT_NOT_FOUND);
    }
    if (result === 30005) {
      throw new BusinessException(ResultCode.UPDATE_CONFLICT);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const row = data[0];
    void this.auditLog.record({
      action: AuditAction.UPDATE,
      companyId: row.company_id,
      projectId: row.project_id,
      tableName: 'project',
      targetId: String(row.project_id),
      targetName: row.project_name,
      beforeJson: row.before_json,
      afterJson: row.after_json,
      createdBy: requesterUserId,
      createdByName: row.requester_name,
    });

    return {
      project_id: row.project_id,
      company_id: row.company_id,
      company_code: row.company_code,
      company_name: row.company_name,
      project_code: row.project_code,
      project_name: row.project_name,
      api_key: row.api_key,
      description: row.description,
      status: row.status,
      secret_rotated_at: row.secret_rotated_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      edit_count: row.edit_count,
    };
  }

  /**
   * 13_PROJECT_API.md 2.5 — SUPER_ADMIN은 무조건 통과, DEVELOPER는 해당 project_id에 실제
   * 활성 user_role이 있어야 한다(SP_PROJECT_API_SECRET_ROTATE 내부에서 FN_IS_SUPER_ADMIN +
   * FN_CHECK_PROJECT_ACCESS로 재검증 — role_code는 넘기지 않고 user_id만 전달한다).
   * 새 평문 Secret은 여기서 생성해 암호화값만 SP에 전달하고, 응답에는 이 평문을 직접 얹는다.
   */
  async rotateApiSecret(
    projectId: number,
    dto: RotateApiSecretDto,
    requester: ProjectRequester,
  ): Promise<ApiSecretRotateResponse> {
    const apiSecretPlain = this.generateRandomHex();
    const apiSecretEnc = this.crypto.encrypt(apiSecretPlain);

    const { result, data } = await this.spExecutor.callProcedure<
      ApiSecretRotateRow[]
    >('SP_PROJECT_API_SECRET_ROTATE', [
      projectId,
      dto.edit_count,
      requester.userId,
      apiSecretEnc,
    ]);

    if (result === 31002) {
      throw new BusinessException(ResultCode.PROJECT_NOT_FOUND);
    }
    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result === 30005) {
      throw new BusinessException(ResultCode.UPDATE_CONFLICT);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const row = data[0];
    void this.auditLog.record({
      action: AuditAction.UPDATE,
      companyId: row.company_id,
      projectId: row.project_id,
      tableName: 'project',
      targetId: String(row.project_id),
      targetName: row.project_name,
      beforeJson: row.before_json,
      afterJson: row.after_json,
      createdBy: requester.userId,
      createdByName: row.requester_name,
    });

    return {
      project_id: row.project_id,
      secret_rotated_at: row.secret_rotated_at,
      edit_count: row.edit_count,
      api_secret: apiSecretPlain,
    };
  }

  async lookup(
    companyId: number,
    projectCode: string,
  ): Promise<ProjectLookupRow> {
    const { result, data } = await this.spExecutor.callProcedure<
      ProjectLookupRow[]
    >('SP_PROJECT_GET_BY_CODE', [companyId, projectCode]);

    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.PROJECT_NOT_FOUND);
    }

    return data[0];
  }

  /** api_key/api_secret 평문 생성용 — 256비트 난수를 64자 hex로 표현한다. */
  private generateRandomHex(): string {
    return randomBytes(32).toString('hex');
  }
}
