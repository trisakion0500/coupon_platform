import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

describe('ResponseInterceptor', () => {
  it('wraps the controller return value into {result:0, data}', (done) => {
    const interceptor = new ResponseInterceptor<{ status: string }>();
    const context = {} as ExecutionContext;
    const handler: CallHandler<{ status: string }> = {
      handle: () => of({ status: 'ok' }),
    };

    interceptor.intercept(context, handler).subscribe((wrapped) => {
      expect(wrapped).toEqual({ result: 0, data: { status: 'ok' } });
      done();
    });
  });
});
