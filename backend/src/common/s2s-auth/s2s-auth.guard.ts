import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { CryptoService } from '../crypto/crypto.service';
import { SpExecutorService } from '../database/sp-executor.service';
import { BusinessException } from '../response/business.exception';
import { ResultCode } from '../response/result-code.enum';

/** 07_AUTH_SECURITY.md 2.2의 4개 필수 S2S 인증 헤더. */
interface S2sHeaders {
  apiKey: string;
  timestamp: string;
  nonce: string;
  signature: string;
}

/**
 * `SP_PROJECT_GET_BY_API_KEY`가 반환하는 project 행(서명 검증에 필요한 컬럼 + company_code/
 * project_code — 이 SP가 매 요청마다 이미 호출되므로 S2S 실패 운영 로그(coupon-usage.service.ts의
 * S2sFailureLogger)가 별도 조회 없이 이 값을 재사용한다, 2026-07-27).
 */
interface ProjectRow {
  project_id: number;
  status: number;
  api_secret: string;
  api_secret_prev: string | null;
  secret_rotated_at: string | null;
  project_code: string;
  company_code: string;
}

/**
 * S2S 요청의 Express Request 확장.
 * - `rawBody`: main.ts의 `rawBody: true` 옵션으로 채워지는 원문 바디(서명 대상)
 * - `s2sProject`: 가드 통과 후 컨트롤러가 사용할 수 있도록 부착하는 인증된 project 정보
 */
export interface S2sRequest extends Request {
  rawBody?: Buffer;
  s2sProject?: { projectId: number; companyCode: string; projectCode: string };
}

/**
 * 게임서버 -> 쿠폰서버 S2S 인증 가드. docs/07_AUTH_SECURITY.md 2.4의 7단계를 그대로 구현한다.
 * 검증 순서를 바꾸면 안 된다 — 예를 들어 서명 검증(5) 전에 nonce를 등록(6)하면 서명이 틀린
 * 요청도 nonce 테이블에 흔적을 남기게 된다(2.4 마지막 문단 참고).
 *
 * @author trisakion
 */
@Injectable()
export class S2sAuthGuard implements CanActivate {
  constructor(
    private readonly spExecutor: SpExecutorService,
    private readonly crypto: CryptoService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 07_AUTH_SECURITY.md 2.4의 검증 순서를 그대로 수행하고, 통과하면 `request.s2sProject`를
   * 채운 뒤 true를 반환한다. 실패 시 각 단계에 대응하는 result 코드로 {@link BusinessException}을 던진다.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<S2sRequest>();

    // 1. 헤더 존재/형식 확인
    const headers = this.extractHeaders(request);

    // 2. Timestamp 허용범위 확인 (DB 조회 없는 값싼 검사를 먼저 수행)
    this.checkTimestampTolerance(headers.timestamp);

    // 3~4. API Key로 project 조회 + 상태 확인
    const project = await this.lookupProject(headers.apiKey);
    if (project.status === 0) {
      throw new BusinessException(ResultCode.S2S_PROJECT_SUSPENDED);
    }

    // 5. 서명 재계산 및 비교 (현재/유예기간 Secret 둘 다 시도)
    const stringToSign = this.buildStringToSign(request, headers);
    this.verifySignature(project, headers.signature, stringToSign);

    // 6. Nonce 등록 (원자적 UNIQUE 제약으로 재전송 차단)
    await this.consumeNonce(project.project_id, headers.nonce);

    // 7. 통과 — 이후 처리에서 사용할 project 식별 정보를 request에 부착
    request.s2sProject = {
      projectId: project.project_id,
      companyCode: project.company_code,
      projectCode: project.project_code,
    };
    return true;
  }

  /**
   * 4개 헤더가 모두 존재하고 X-API-Timestamp가 정수 형식인지 확인한다.
   * @throws {BusinessException} 10012 — 누락되었거나 timestamp가 정수가 아닐 때
   */
  private extractHeaders(request: Request): S2sHeaders {
    const apiKey = request.header('X-API-Key');
    const timestamp = request.header('X-API-Timestamp');
    const nonce = request.header('X-API-Nonce');
    const signature = request.header('X-API-Signature');

    if (!apiKey || !timestamp || !nonce || !signature) {
      throw new BusinessException(ResultCode.S2S_MISSING_AUTH_HEADER);
    }
    if (!/^\d+$/.test(timestamp)) {
      throw new BusinessException(ResultCode.S2S_MISSING_AUTH_HEADER);
    }

    return { apiKey, timestamp, nonce, signature };
  }

  /**
   * 서버 시각 기준 `S2S_TIMESTAMP_TOLERANCE_SEC` 범위를 벗어나면 거부한다(과거/미래 양방향).
   * @throws {BusinessException} 10013
   */
  private checkTimestampTolerance(timestamp: string): void {
    const toleranceSec = this.configService.getOrThrow<number>(
      'S2S_TIMESTAMP_TOLERANCE_SEC',
    );
    const nowSec = Math.floor(Date.now() / 1000);
    const requestSec = parseInt(timestamp, 10);

    if (Math.abs(nowSec - requestSec) > toleranceSec) {
      throw new BusinessException(ResultCode.S2S_TIMESTAMP_OUT_OF_RANGE);
    }
  }

  /**
   * `SP_PROJECT_GET_BY_API_KEY`로 project를 조회한다.
   * @throws {BusinessException} 10010 — API Key에 해당하는 project가 없을 때
   */
  private async lookupProject(apiKey: string): Promise<ProjectRow> {
    const { result, data } = await this.spExecutor.callProcedure<ProjectRow[]>(
      'SP_PROJECT_GET_BY_API_KEY',
      [apiKey],
    );

    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.S2S_INVALID_API_KEY);
    }

    return data[0];
  }

  /** 07_AUTH_SECURITY.md 2.3의 stringToSign 구성. RAW_BODY는 재직렬화하지 않고 원문 그대로 사용한다. */
  private buildStringToSign(request: S2sRequest, headers: S2sHeaders): string {
    const rawBody = request.rawBody?.toString('utf8') ?? '';
    const queryIndex = request.url.indexOf('?');
    const rawQuery = queryIndex >= 0 ? request.url.slice(queryIndex + 1) : '';

    return [
      request.method,
      request.path,
      rawQuery,
      headers.timestamp,
      headers.nonce,
      rawBody,
    ].join('\n');
  }

  /**
   * 현재 Secret과 유예기간 중인 이전 Secret(둘 다 존재하면 둘 다) 각각으로 서명을 재계산해 비교한다.
   * @throws {BusinessException} 10011 — 어느 쪽과도 일치하지 않을 때
   */
  private verifySignature(
    project: ProjectRow,
    signature: string,
    stringToSign: string,
  ): void {
    const encryptedCandidates = [
      project.api_secret,
      project.api_secret_prev,
    ].filter((value): value is string => !!value);

    const matched = encryptedCandidates.some((encryptedSecret) => {
      const secret = this.crypto.decrypt(encryptedSecret);
      const expectedSignature = this.crypto.hmacSha256Hex(secret, stringToSign);
      return this.crypto.timingSafeEqualHex(expectedSignature, signature);
    });

    if (!matched) {
      throw new BusinessException(ResultCode.S2S_SIGNATURE_MISMATCH);
    }
  }

  /**
   * `SP_NONCE_INSERT`로 nonce를 원자적으로 등록한다. SP 시스템 오류(50001)는
   * `callProcedure`가 이미 `BusinessException(DATABASE_ERROR)`로 던지므로 여기서는
   * 재전송 감지(10015)만 확인하면 된다.
   * @throws {BusinessException} 10015 — 이미 사용된 nonce(재전송 의심)일 때
   */
  private async consumeNonce(projectId: number, nonce: string): Promise<void> {
    const { result } = await this.spExecutor.callProcedure('SP_NONCE_INSERT', [
      projectId,
      nonce,
    ]);

    if (result === 10015 /* ResultCode.S2S_NONCE_REUSED */) {
      throw new BusinessException(ResultCode.S2S_NONCE_REUSED);
    }
  }
}
