import { Injectable } from '@nestjs/common';
import { SpExecutorService } from '../common/database/sp-executor.service';
import {
  buildPaginatedResult,
  PaginatedResult,
} from '../common/response/pagination';
import { BusinessException } from '../common/response/business.exception';
import { ResultCode } from '../common/response/result-code.enum';
import { CreateCompanyDto } from './dto/create-company.dto';
import { CompanyListQueryDto } from './dto/company-list-query.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

export interface CompanyRow {
  company_id: number;
  company_code: string;
  company_name: string;
  description: string | null;
  status: number;
  created_at: string;
  updated_at: string;
}

/**
 * SP_COMPANY_LIST 반환 행 — 요청한 page가 데이터 범위를 벗어나면 company_id를 비롯한
 * 모든 데이터 컬럼이 NULL인 채로 total_count만 채워진 행 1개가 온다(LEFT JOIN ... ON TRUE).
 */
interface CompanyListRow extends Omit<CompanyRow, 'company_id'> {
  company_id: number | null;
  total_count: number;
}

export interface CompanyLookupRow {
  company_id: number;
  company_name: string;
}

/** `SP_COMPANY_GET_ACTIVE_HEADER_DATA`의 단일 result set 행 — row_type으로 회사/프로젝트를 함께 담는다. */
interface HeaderDataRow {
  row_type: 'COMPANY' | 'PROJECT';
  id: number;
  company_id: number;
  name: string;
}

export interface ActiveHeaderData {
  companies: Array<{ company_id: number; company_name: string }>;
  projects: Array<{
    project_id: number;
    company_id: number;
    project_name: string;
  }>;
}

/**
 * 10_COMPANY_API.md 6개 엔드포인트(생성/목록/상세/수정/코드조회/헤더데이터)의 비즈니스 로직.
 *
 * @author trisakion
 */
@Injectable()
export class CompanyService {
  constructor(private readonly spExecutor: SpExecutorService) {}

  /**
   * 회사 관리메뉴는 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, SP도
   * FN_IS_SUPER_ADMIN(requesterUserId)으로 재확인한다(방어적 이중 체크,
   * 02_DEV_CONVENTIONS.md 3.2) — SP가 20001을 반환하면 PERMISSION_DENIED로 변환한다.
   */
  async create(
    dto: CreateCompanyDto,
    requesterUserId: number,
  ): Promise<CompanyRow> {
    const { result, data } = await this.spExecutor.callProcedure<CompanyRow[]>(
      'SP_COMPANY_CREATE',
      [
        dto.company_code,
        dto.company_name,
        dto.description ?? null,
        requesterUserId,
      ],
    );

    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result === 32001) {
      throw new BusinessException(ResultCode.DUPLICATE_DATA);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    return data[0];
  }

  async list(
    query: CompanyListQueryDto,
    requesterUserId: number,
  ): Promise<PaginatedResult<CompanyRow>> {
    const offset = (query.page - 1) * query.page_size;
    const { result, data } = await this.spExecutor.callProcedure<
      CompanyListRow[]
    >('SP_COMPANY_LIST', [
      query.status ?? null,
      query.page_size,
      offset,
      requesterUserId,
    ]);

    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result !== 0) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const rows = data ?? [];
    const totalCount = rows[0]?.total_count ?? 0;
    // 요청한 page가 실제 데이터 범위를 벗어나면 SP가 total_count만 채운 채 company_id가
    // NULL인 행을 반환한다(SP_COMPANY_LIST 주석 참고) — 그 행은 데이터가 아니므로 제외한다.
    const items: CompanyRow[] = rows
      .filter(
        (row): row is CompanyListRow & { company_id: number } =>
          row.company_id !== null,
      )
      .map((row) => ({
        company_id: row.company_id,
        company_code: row.company_code,
        company_name: row.company_name,
        description: row.description,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }));

    return buildPaginatedResult(query, totalCount, items);
  }

  async getById(
    companyId: number,
    requesterUserId: number,
  ): Promise<CompanyRow> {
    const { result, data } = await this.spExecutor.callProcedure<CompanyRow[]>(
      'SP_COMPANY_GET_BY_ID',
      [companyId, requesterUserId],
    );

    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.COMPANY_NOT_FOUND);
    }

    return data[0];
  }

  async update(
    companyId: number,
    dto: UpdateCompanyDto,
    requesterUserId: number,
  ): Promise<CompanyRow> {
    const { result, data } = await this.spExecutor.callProcedure<CompanyRow[]>(
      'SP_COMPANY_UPDATE',
      [
        companyId,
        dto.company_code ?? null,
        dto.company_name ?? null,
        dto.description ?? null,
        dto.status ?? null,
        requesterUserId,
      ],
    );

    switch (result) {
      case 0:
        break;
      case 20001:
        throw new BusinessException(ResultCode.PERMISSION_DENIED);
      case 31001:
        throw new BusinessException(ResultCode.COMPANY_NOT_FOUND);
      case 32001:
        throw new BusinessException(ResultCode.DUPLICATE_DATA);
      default:
        throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    if (!data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    return data[0];
  }

  async lookup(companyCode: string): Promise<CompanyLookupRow> {
    const { result, data } = await this.spExecutor.callProcedure<
      CompanyLookupRow[]
    >('SP_COMPANY_GET_BY_CODE', [companyCode]);

    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.COMPANY_NOT_FOUND);
    }

    return data[0];
  }

  /**
   * 10_COMPANY_API.md 3.1 — 로그인 직후 헤더 콤보박스가 1회 로드하는 활성 회사·프로젝트 목록.
   * user/roleCode/companyId는 JwtAuthGuard가 검증한 JWT 페이로드 값을 그대로 신뢰하고 DB를
   * 재조회하지 않는다(jwt-auth.guard.ts와 같은 원칙).
   */
  async getActiveHeaderData(
    userId: number,
    roleCode: number,
    companyId: number,
  ): Promise<ActiveHeaderData> {
    const { result, data } = await this.spExecutor.callProcedure<
      HeaderDataRow[]
    >('SP_COMPANY_GET_ACTIVE_HEADER_DATA', [userId, roleCode, companyId]);

    if (result !== 0) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const rows = data ?? [];
    return {
      companies: rows
        .filter((row) => row.row_type === 'COMPANY')
        .map((row) => ({ company_id: row.id, company_name: row.name })),
      projects: rows
        .filter((row) => row.row_type === 'PROJECT')
        .map((row) => ({
          project_id: row.id,
          company_id: row.company_id,
          project_name: row.name,
        })),
    };
  }
}
