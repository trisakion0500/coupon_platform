import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import {
  Observable,
  TimeoutError,
  catchError,
  throwError,
  timeout,
} from 'rxjs';
import { BusinessException } from './business.exception';
import { ResultCode } from './result-code.enum';

/**
 * `API_EXECUTION_TIMEOUT_MS`(02_DEV_CONVENTIONS.md 1.2) 안에 컨트롤러 핸들러가 응답을
 * 만들지 못하면 408로 끊는다. RxJS timeout()은 구독만 취소할 뿐 이미 던져진 SP 호출(mysql2
 * 쿼리) 자체를 취소하지 못한다 — 타임아웃 이후에도 DB 쪽 작업은 계속 진행돼 커밋될 수 있다는
 * 뜻이라, reserve처럼 상태를 바꾸는 API는 기존 멱등성(use_limit_per_user 체크 등)에 기대어
 * 안전을 확보한다. RANDOM 코드 대량생성처럼 컨트롤러 응답과 분리된 fire-and-forget 백그라운드
 * 루프는 이 인터셉터가 감싸는 Observable 범위 밖이라 영향받지 않는다.
 *
 * @author trisakion
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(private readonly timeoutMs: number) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      timeout(this.timeoutMs),
      catchError((err: unknown) => {
        if (err instanceof TimeoutError) {
          return throwError(
            () => new BusinessException(ResultCode.API_EXECUTION_TIMEOUT),
          );
        }
        return throwError(() => err);
      }),
    );
  }
}
