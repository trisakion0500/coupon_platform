import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import ms from 'ms';
import type { StringValue } from 'ms';
import { AuditAction } from '../common/audit-log/audit-action.enum';
import { AuditLogService } from '../common/audit-log/audit-log.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { SpExecutorService } from '../common/database/sp-executor.service';
import type { JwtPayload } from '../common/jwt-auth/jwt-payload.interface';
import { BusinessException } from '../common/response/business.exception';
import { ResultCode } from '../common/response/result-code.enum';
import { formatDateTime } from '../common/util/format-datetime.util';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { SignupDto } from './dto/signup.dto';

const BCRYPT_ROUNDS = 12;

interface UserRow {
  user_id: number;
  company_id: number;
  requested_project_id: number | null;
  login_id: string;
  password_hash: string;
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

interface UserWithRoleRow extends UserRow {
  role_code: number;
}

interface SessionByRefreshRow {
  session_id: number;
  user_id: number;
  user_status: number;
  company_id: number;
  role_code: number;
}

/** SP_USER_PASSWORD_CHANGE 결과 result set — 감사로그(log_audit)용 필드만 담는다. */
interface PasswordChangeAuditRow {
  before_json: Record<string, unknown>;
  after_json: Record<string, unknown>;
  requester_name: string | null;
}

/**
 * 09_AUTH_API.md 6개 엔드포인트(회원가입/로그인/로그아웃/재발급/내정보/비번변경)의 비즈니스 로직.
 * SP가 시스템 오류(RESULT=50001)를 반환하면 `SpExecutorService.callProcedure` 자체가 이미
 * `BusinessException(DATABASE_ERROR)`을 던지므로(`sp-result.util.ts` 참고), 아래 각 메서드는
 * "SP가 정상적으로 반환한 특정 비즈니스 코드"만 신경 쓰면 된다 — 시스템 오류를 특정 비즈니스
 * 실패로 착각해 잘못 분류할 걱정 없이 단순하게 작성할 수 있다.
 *
 * @author trisakion
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly spExecutor: SpExecutorService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly crypto: CryptoService,
    private readonly auditLog: AuditLogService,
  ) {}

  async signup(dto: SignupDto) {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const phoneNumberEnc = this.crypto.encrypt(dto.phone_number);

    const { result, data } = await this.spExecutor.callProcedure<UserRow[]>(
      'SP_USER_SIGNUP',
      [
        dto.company_id,
        dto.requested_project_id,
        dto.login_id,
        passwordHash,
        dto.user_name,
        dto.email,
        phoneNumberEnc,
        dto.department ?? null,
        dto.position ?? null,
      ],
    );

    switch (result) {
      case 0:
        break;
      case 31001:
        throw new BusinessException(ResultCode.COMPANY_NOT_FOUND);
      case 31002:
        throw new BusinessException(ResultCode.PROJECT_NOT_FOUND);
      case 32001:
        throw new BusinessException(ResultCode.DUPLICATE_DATA);
      default:
        throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    if (!data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    return this.toUserResponse(data[0]);
  }

  async login(dto: LoginDto) {
    const { result, data } = await this.spExecutor.callProcedure<
      UserWithRoleRow[]
    >('SP_USER_GET_BY_LOGIN_ID', [dto.login_id]);

    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.LOGIN_FAILED);
    }

    const user = data[0];
    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.password_hash,
    );
    if (!passwordMatches) {
      throw new BusinessException(ResultCode.PASSWORD_MISMATCH);
    }

    this.assertLoginableStatus(user.status);

    return this.issueSession(user.user_id, user.company_id, user.role_code);
  }

  async logout(accessTokenJti: string): Promise<void> {
    await this.spExecutor.callProcedure('SP_USER_SESSION_LOGOUT', [
      accessTokenJti,
    ]);
  }

  async refresh(dto: RefreshDto) {
    const refreshTokenHash = this.crypto.sha256Hex(dto.refresh_token);

    const { result, data } = await this.spExecutor.callProcedure<
      SessionByRefreshRow[]
    >('SP_USER_SESSION_GET_BY_REFRESH_HASH', [refreshTokenHash]);

    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.REFRESH_TOKEN_EXPIRED);
    }

    const session = data[0];
    this.assertLoginableStatus(session.user_status);

    const jti = randomUUID();
    const { accessToken, expiredAt } = await this.issueAccessToken({
      jti,
      user_id: session.user_id,
      company_id: session.company_id,
      role_code: session.role_code,
    });

    await this.spExecutor.callProcedure('SP_USER_SESSION_UPDATE_JTI', [
      session.session_id,
      jti,
    ]);

    return {
      access_token: accessToken,
      expired_at: expiredAt,
      role_code: session.role_code,
    };
  }

  async getMe(userId: number) {
    const user = await this.fetchUserById(userId);
    return this.toUserResponse(user);
  }

  async changePassword(userId: number, dto: ChangePasswordDto): Promise<void> {
    const user = await this.fetchUserById(userId);

    const passwordMatches = await bcrypt.compare(
      dto.current_password,
      user.password_hash,
    );
    if (!passwordMatches) {
      throw new BusinessException(ResultCode.PASSWORD_MISMATCH);
    }

    const newPasswordHash = await bcrypt.hash(dto.new_password, BCRYPT_ROUNDS);
    const { data } = await this.spExecutor.callProcedure<
      PasswordChangeAuditRow[]
    >('SP_USER_PASSWORD_CHANGE', [userId, newPasswordHash]);

    // 13_LOG_AUDIT_API.md 2.4 — 본인 비밀번호 변경도 user UPDATE 감사 로그 대상.
    const row = data?.[0];
    if (row) {
      void this.auditLog.record({
        action: AuditAction.UPDATE,
        companyId: user.company_id,
        projectId: null,
        tableName: 'user',
        targetId: String(userId),
        targetName: user.user_name,
        beforeJson: row.before_json,
        afterJson: row.after_json,
        createdBy: userId,
        createdByName: row.requester_name,
      });
    }
  }

  /** 로그인 성공 시 Access/Refresh Token을 발급하고 세션을 생성한다(09_AUTH_API.md 5장). */
  private async issueSession(
    userId: number,
    companyId: number,
    roleCode: number,
  ) {
    const jti = randomUUID();
    const refreshToken = randomUUID();
    const refreshTokenHash = this.crypto.sha256Hex(refreshToken);
    const sessionExpiredAt = this.sessionExpiryDate();

    const { accessToken, expiredAt } = await this.issueAccessToken({
      jti,
      user_id: userId,
      company_id: companyId,
      role_code: roleCode,
    });

    await this.spExecutor.callProcedure('SP_USER_SESSION_CREATE', [
      userId,
      jti,
      refreshTokenHash,
      sessionExpiredAt,
    ]);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expired_at: expiredAt,
      role_code: roleCode,
    };
  }

  /**
   * Access Token을 서명하고, 그 토큰에 실제로 실린 `exp` 클레임을 디코드해 `expired_at` 문자열을
   * 만든다 — 별도로 `Date.now() + ms(...)`를 다시 계산하면 서명 시점과 몇 ms 어긋날 수 있어(드물게
   * 초 경계에서 1초 차이), 토큰 자신의 만료시각을 그대로 신뢰하는 쪽이 항상 정확하다.
   */
  private async issueAccessToken(
    payload: JwtPayload,
  ): Promise<{ accessToken: string; expiredAt: string }> {
    const accessToken = await this.jwtService.signAsync(payload);
    const decoded = this.jwtService.decode<JwtPayload & { exp: number }>(
      accessToken,
    );
    return {
      accessToken,
      expiredAt: formatDateTime(new Date(decoded.exp * 1000)),
    };
  }

  /**
   * 자기 자신을 조회하는 용도라 requester_user_id에 userId 자기 자신을 그대로 전달한다 —
   * FN_CHECK_COMPANY_ACCESS가 "자기 자신의 company_id"와 비교하게 되어 항상 통과한다
   * (SP_USER_GET_BY_ID.sql 참고).
   */
  private async fetchUserById(userId: number): Promise<UserRow> {
    const { result, data } = await this.spExecutor.callProcedure<UserRow[]>(
      'SP_USER_GET_BY_ID',
      [userId, userId],
    );
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.USER_NOT_FOUND);
    }
    return data[0];
  }

  /** @throws {BusinessException} 10005/10006/10007 — 가입승인대기/가입반려/사용중지 */
  private assertLoginableStatus(status: number): void {
    switch (status) {
      case 1:
        return;
      case 0:
        throw new BusinessException(ResultCode.SIGNUP_PENDING_APPROVAL);
      case 2:
        throw new BusinessException(ResultCode.SIGNUP_REJECTED);
      case 3:
        throw new BusinessException(ResultCode.ACCOUNT_SUSPENDED);
      default:
        throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }
  }

  /** password_hash를 제외하고, phone_number는 복호화해서 반환한다. */
  private toUserResponse(user: UserRow) {
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

  private sessionExpiryDate(): Date {
    const refreshExpiresIn = this.configService.getOrThrow<string>(
      'JWT_REFRESH_EXPIRES_IN',
    );
    return new Date(Date.now() + ms(refreshExpiresIn as StringValue));
  }
}
