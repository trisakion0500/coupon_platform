import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TokenExpiredError } from 'jsonwebtoken';
import type { Request } from 'express';
import { SpExecutorService } from '../database/sp-executor.service';
import { BusinessException } from '../response/business.exception';
import { ResultCode } from '../response/result-code.enum';
import { JwtPayload } from './jwt-payload.interface';

/** JWT 인증 통과 후 컨트롤러가 사용할 수 있도록 부착되는 요청자 정보. */
export interface AuthenticatedUser {
  userId: number;
  companyId: number;
  roleCode: number;
  /** 현재 Access Token의 JTI — 로그아웃 시 어떤 세션을 종료할지 식별하는 키 */
  jti: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

/**
 * 관리 콘솔 사용자 인증 가드. docs/09_AUTH_SECURITY.md 1.5의 4단계 검증 순서를 그대로 구현한다:
 * 헤더 존재 → 서명/만료 → 세션 상태(user_session) → 사용자 상태(user.status). role_code는
 * DB를 다시 조회하지 않고 JWT 페이로드에 실린 값을 그대로 신뢰한다 — 로그인/재발급 시점에만
 * 재계산되고(11_AUTH_API.md 7장), 그 사이에는 서명으로 위변조가 보장되기 때문이다.
 * SP 시스템 오류(RESULT=50001)는 `SpExecutorService.callProcedure`가 이미
 * `BusinessException(DATABASE_ERROR)`로 던지므로 여기서 따로 확인하지 않는다.
 *
 * @author trisakion
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly spExecutor: SpExecutorService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // 1. Authorization 헤더 존재 확인
    const token = this.extractToken(request);

    // 2. Access Token 유효성 검증 (서명/만료)
    const payload = await this.verifyToken(token);

    // 3~4. Session/User 상태 확인
    const { userId, companyId } = await this.validateSession(payload.jti);

    request.user = {
      userId,
      companyId,
      roleCode: payload.role_code,
      jti: payload.jti,
    };
    return true;
  }

  /** @throws {BusinessException} 10004 — Authorization 헤더가 없거나 `Bearer ` 형식이 아닐 때 */
  private extractToken(request: Request): string {
    const header = request.header('Authorization');
    if (!header?.startsWith('Bearer ')) {
      throw new BusinessException(ResultCode.LOGIN_REQUIRED);
    }
    return header.slice('Bearer '.length);
  }

  /**
   * @throws {BusinessException} 10003 — 만료된 토큰
   * @throws {BusinessException} 10004 — 서명 불일치 등 그 외 검증 실패
   */
  private async verifyToken(token: string): Promise<JwtPayload> {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        throw new BusinessException(ResultCode.ACCESS_TOKEN_EXPIRED);
      }
      throw new BusinessException(ResultCode.LOGIN_REQUIRED);
    }
  }

  /**
   * @throws {BusinessException} 10009 — 세션이 없거나 로그아웃된 경우
   * @throws {BusinessException} 10005/10006/10007 — 가입승인대기/가입반려/사용중지
   */
  private async validateSession(
    jti: string,
  ): Promise<{ userId: number; companyId: number }> {
    const { result, data } = await this.spExecutor.callProcedure<
      Array<{ user_id: number; company_id: number; user_status: number }>
    >('SP_USER_SESSION_VALIDATE_BY_JTI', [jti]);

    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INVALID_SESSION);
    }

    const row = data[0];
    switch (row.user_status) {
      case 1:
        return { userId: row.user_id, companyId: row.company_id };
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
}
