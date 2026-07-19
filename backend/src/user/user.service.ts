import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { CryptoService } from '../common/crypto/crypto.service';
import { SpExecutorService } from '../common/database/sp-executor.service';
import { BusinessException } from '../common/response/business.exception';
import {
  buildPaginatedResult,
  PaginatedResult,
} from '../common/response/pagination';
import { ResultCode } from '../common/response/result-code.enum';
import { RoleCode } from '../common/roles/role-code.enum';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserListQueryDto } from './dto/user-list-query.dto';

const BCRYPT_ROUNDS = 12;

interface UserRow {
  user_id: number;
  company_id: number;
  requested_project_id: number | null;
  login_id: string;
  user_name: string;
  email: string;
  phone_number: string;
  department: string | null;
  position: string | null;
  status: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

interface UserListRow extends UserRow {
  total_count: number;
}

export interface UserResponse extends Omit<UserRow, 'phone_number'> {
  /** SP는 암호문을 그대로 반환하고, 서비스가 이 시점에 복호화해서 응답에 얹는다. */
  phone_number: string;
}

/** 요청자 컨텍스트 — JwtAuthGuard가 검증한 JWT 페이로드 값(DB 재조회 없이 신뢰). */
export interface UserRequester {
  userId: number;
  roleCode: RoleCode;
  companyId: number;
}

/**
 * 12_USER_API.md 1장(User) 7개 엔드포인트의 비즈니스 로직.
 *
 * @author trisakion
 */
@Injectable()
export class UserService {
  constructor(
    private readonly spExecutor: SpExecutorService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * DEVELOPER는 company_id를 자기 소속 회사로 강제 고정한다(12_USER_API.md 1.1 Permission) —
   * project.list()와 동일한 스코핑 원칙.
   */
  async list(
    query: UserListQueryDto,
    requester: UserRequester,
  ): Promise<PaginatedResult<UserResponse>> {
    const companyId =
      requester.roleCode === RoleCode.SUPER_ADMIN
        ? (query.company_id ?? null)
        : requester.companyId;

    const offset = (query.page - 1) * query.page_size;
    const { result, data } = await this.spExecutor.callProcedure<UserListRow[]>(
      'SP_USER_LIST',
      [
        companyId,
        query.status ?? null,
        query.page_size,
        offset,
        requester.userId,
      ],
    );

    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result !== 0) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const rows = data ?? [];
    const totalCount = rows[0]?.total_count ?? 0;
    const items = rows.map((row) => this.toUserResponse(row));

    return buildPaginatedResult(query, totalCount, items);
  }

  /**
   * DEVELOPER가 타 회사 사용자를 조회하면 존재하지 않는 것처럼 404가 아니라 실존 리소스에
   * 대한 인가 실패로 보아 PERMISSION_DENIED를 반환한다(project.getById()와 동일한 판단).
   */
  async getById(
    userId: number,
    requester: UserRequester,
  ): Promise<UserResponse> {
    const { result, data } = await this.spExecutor.callProcedure<UserRow[]>(
      'SP_USER_GET_BY_ID',
      [userId, requester.userId],
    );

    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.USER_NOT_FOUND);
    }

    const user = data[0];
    // SP가 이미 회사 접근을 재검증하지만(FN_CHECK_COMPANY_ACCESS), 앱 레이어에서도 동일한
    // 판단을 한 번 더 확인한다 — 방어적 이중 체크(02_DEV_CONVENTIONS.md 3.2).
    if (
      requester.roleCode !== RoleCode.SUPER_ADMIN &&
      user.company_id !== requester.companyId
    ) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }

    return this.toUserResponse(user);
  }

  async approve(
    userId: number,
    requesterUserId: number,
  ): Promise<UserResponse> {
    return this.runStatusTransition('SP_USER_APPROVE', userId, requesterUserId);
  }

  async reject(userId: number, requesterUserId: number): Promise<UserResponse> {
    return this.runStatusTransition('SP_USER_REJECT', userId, requesterUserId);
  }

  async update(
    userId: number,
    dto: UpdateUserDto,
    requesterUserId: number,
  ): Promise<UserResponse> {
    const phoneNumberEnc = dto.phone_number
      ? this.crypto.encrypt(dto.phone_number)
      : null;

    const { result, data } = await this.spExecutor.callProcedure<UserRow[]>(
      'SP_USER_UPDATE',
      [
        userId,
        dto.user_name ?? null,
        dto.email ?? null,
        phoneNumberEnc,
        dto.department ?? null,
        dto.position ?? null,
        dto.status ?? null,
        requesterUserId,
      ],
    );

    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result === 31003) {
      throw new BusinessException(ResultCode.USER_NOT_FOUND);
    }
    if (result === 32001) {
      throw new BusinessException(ResultCode.DUPLICATE_DATA);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    return this.toUserResponse(data[0]);
  }

  /**
   * 12_USER_API.md 1.7 — 현재 비밀번호 검증 없이 즉시 초기화, 전체 활성 세션 종료는
   * SP_USER_PASSWORD_RESET 내부 트랜잭션이 처리한다.
   */
  async resetPassword(
    userId: number,
    dto: ResetPasswordDto,
    requesterUserId: number,
  ): Promise<UserResponse> {
    const newPasswordHash = await bcrypt.hash(dto.new_password, BCRYPT_ROUNDS);

    const { result, data } = await this.spExecutor.callProcedure<UserRow[]>(
      'SP_USER_PASSWORD_RESET',
      [userId, newPasswordHash, requesterUserId],
    );

    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result === 31003) {
      throw new BusinessException(ResultCode.USER_NOT_FOUND);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    return this.toUserResponse(data[0]);
  }

  /** SP_USER_APPROVE/SP_USER_REJECT 공용 — 둘 다 31003/30004로 동일하게 실패를 구분한다. */
  private async runStatusTransition(
    spName: 'SP_USER_APPROVE' | 'SP_USER_REJECT',
    userId: number,
    requesterUserId: number,
  ): Promise<UserResponse> {
    const { result, data } = await this.spExecutor.callProcedure<UserRow[]>(
      spName,
      [userId, requesterUserId],
    );

    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result === 31003) {
      throw new BusinessException(ResultCode.USER_NOT_FOUND);
    }
    if (result === 30004) {
      throw new BusinessException(ResultCode.INVALID_STATE_TRANSITION);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    return this.toUserResponse(data[0]);
  }

  /** password_hash는 SP 응답에 없으므로 별도 제외 처리가 필요 없고, phone_number만 복호화한다. */
  private toUserResponse(user: UserRow): UserResponse {
    return {
      user_id: user.user_id,
      company_id: user.company_id,
      requested_project_id: user.requested_project_id,
      login_id: user.login_id,
      user_name: user.user_name,
      email: user.email,
      phone_number: this.crypto.decrypt(user.phone_number),
      department: user.department,
      position: user.position,
      status: user.status,
      last_login_at: user.last_login_at,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };
  }
}
