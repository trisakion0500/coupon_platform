import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { CryptoService } from '../common/crypto/crypto.service';
import { SpExecutorService } from '../common/database/sp-executor.service';
import { BusinessException } from '../common/response/business.exception';
import {
  buildPaginatedResult,
  PaginatedResult,
} from '../common/response/pagination';
import { ResultCode } from '../common/response/result-code.enum';
import { RoleCode } from '../common/roles/role-code.enum';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectListQueryDto } from './dto/project-list-query.dto';
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
}

interface ProjectListRow extends ProjectRow {
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
}

export interface ProjectCreateResponse extends ProjectCreateRow {
  /** 이 응답에만 1회 노출되는 평문 Secret(11_PROJECT_API.md 2.1). */
  api_secret: string;
}

export interface ProjectLookupRow {
  project_id: number;
  project_name: string;
}

export interface ApiSecretRotateResponse {
  project_id: number;
  /** 이 응답에만 1회 노출되는 평문 Secret(11_PROJECT_API.md 2.5). */
  api_secret: string;
  secret_rotated_at: string;
}

/** 요청자 컨텍스트 — JwtAuthGuard가 검증한 JWT 페이로드 값(DB 재조회 없이 신뢰). */
export interface ProjectRequester {
  userId: number;
  roleCode: RoleCode;
  companyId: number;
}

/**
 * 11_PROJECT_API.md 6개 엔드포인트(생성/목록/상세/수정/Secret재발급/코드조회)의 비즈니스 로직.
 *
 * @author trisakion
 */
@Injectable()
export class ProjectService {
  constructor(
    private readonly spExecutor: SpExecutorService,
    private readonly crypto: CryptoService,
  ) {}

  async create(dto: CreateProjectDto): Promise<ProjectCreateResponse> {
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
    ]);

    if (result === 31001) {
      throw new BusinessException(ResultCode.COMPANY_NOT_FOUND);
    }
    if (result === 32001) {
      throw new BusinessException(ResultCode.DUPLICATE_DATA);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    return { ...data[0], api_secret: apiSecretPlain };
  }

  async list(
    query: ProjectListQueryDto,
    requester: ProjectRequester,
  ): Promise<PaginatedResult<ProjectRow>> {
    const companyId =
      requester.roleCode === RoleCode.SUPER_ADMIN
        ? (query.company_id ?? null)
        : requester.companyId;

    const offset = (query.page - 1) * query.page_size;
    const { result, data } = await this.spExecutor.callProcedure<
      ProjectListRow[]
    >('SP_PROJECT_LIST', [
      companyId,
      query.status ?? null,
      query.page_size,
      offset,
    ]);

    if (result !== 0) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const rows = data ?? [];
    const totalCount = rows[0]?.total_count ?? 0;
    const items: ProjectRow[] = rows.map((row) => ({
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
    }));

    return buildPaginatedResult(query, totalCount, items);
  }

  async getById(
    projectId: number,
    requester: ProjectRequester,
  ): Promise<ProjectRow> {
    const { result, data } = await this.spExecutor.callProcedure<ProjectRow[]>(
      'SP_PROJECT_GET_BY_ID',
      [projectId],
    );

    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.PROJECT_NOT_FOUND);
    }

    const project = data[0];
    if (
      requester.roleCode !== RoleCode.SUPER_ADMIN &&
      project.company_id !== requester.companyId
    ) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }

    return project;
  }

  async update(projectId: number, dto: UpdateProjectDto): Promise<ProjectRow> {
    const { result, data } = await this.spExecutor.callProcedure<ProjectRow[]>(
      'SP_PROJECT_UPDATE',
      [
        projectId,
        dto.project_name ?? null,
        dto.description ?? null,
        dto.status ?? null,
      ],
    );

    if (result === 31002) {
      throw new BusinessException(ResultCode.PROJECT_NOT_FOUND);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    return data[0];
  }

  /**
   * 11_PROJECT_API.md 2.5 — SUPER_ADMIN은 무조건 통과, DEVELOPER는 해당 project_id에 실제
   * 활성 user_role이 있어야 한다(SP_PROJECT_API_SECRET_ROTATE 내부에서 FN_CHECK_PROJECT_ACCESS로
   * 재검증). 새 평문 Secret은 여기서 생성해 암호화값만 SP에 전달하고, 응답에는 이 평문을 직접 얹는다.
   */
  async rotateApiSecret(
    projectId: number,
    requester: ProjectRequester,
  ): Promise<ApiSecretRotateResponse> {
    const apiSecretPlain = this.generateRandomHex();
    const apiSecretEnc = this.crypto.encrypt(apiSecretPlain);

    const { result, data } = await this.spExecutor.callProcedure<
      Array<{ project_id: number; secret_rotated_at: string }>
    >('SP_PROJECT_API_SECRET_ROTATE', [
      projectId,
      requester.userId,
      requester.roleCode,
      apiSecretEnc,
    ]);

    if (result === 31002) {
      throw new BusinessException(ResultCode.PROJECT_NOT_FOUND);
    }
    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    return { ...data[0], api_secret: apiSecretPlain };
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
