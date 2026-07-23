import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Observable, of, throwError } from 'rxjs';
import { delay } from 'rxjs/operators';
import { BusinessException } from './business.exception';
import { ResultCode } from './result-code.enum';
import { TimeoutInterceptor } from './timeout.interceptor';

function buildHandler(observable: Observable<unknown>): CallHandler {
  return { handle: () => observable };
}

describe('TimeoutInterceptor', () => {
  const context = {} as ExecutionContext;

  it('처리 시간이 제한 이내면 결과를 그대로 통과시킨다', (done) => {
    const interceptor = new TimeoutInterceptor(50);

    interceptor
      .intercept(context, buildHandler(of('ok')))
      .subscribe((value) => {
        expect(value).toBe('ok');
        done();
      });
  });

  it('제한 시간을 넘기면 API_EXECUTION_TIMEOUT BusinessException(408)으로 변환한다', (done) => {
    const interceptor = new TimeoutInterceptor(10);

    interceptor
      .intercept(context, buildHandler(of('too-late').pipe(delay(50))))
      .subscribe({
        error: (err: unknown) => {
          expect(err).toBeInstanceOf(BusinessException);
          const exception = err as BusinessException;
          expect(exception.resultCode).toBe(ResultCode.API_EXECUTION_TIMEOUT);
          expect(exception.getStatus()).toBe(408);
          done();
        },
      });
  });

  it('타임아웃이 아닌 다른 오류는 그대로 전파한다', (done) => {
    const interceptor = new TimeoutInterceptor(50);
    const originalError = new Error('원본 오류');

    interceptor
      .intercept(context, buildHandler(throwError(() => originalError)))
      .subscribe({
        error: (err: unknown) => {
          expect(err).toBe(originalError);
          done();
        },
      });
  });
});
