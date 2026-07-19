import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/** 08_API_COMMON.md 1.4의 성공 응답 셰이프. */
interface SuccessBody<T> {
  result: 0;
  data: T;
}

/**
 * 08_API_COMMON.md 1.4: 성공 응답은 {result:0, data} 형태로 통일한다.
 * 컨트롤러는 data가 될 값만 반환하면 되고, 래핑은 여기서 일괄 처리한다.
 *
 * @author trisakion
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  SuccessBody<T>
> {
  /** 컨트롤러가 반환한 값을 {result:0, data} 형태로 감싼다. */
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<SuccessBody<T>> {
    return next.handle().pipe(map((data) => ({ result: 0 as const, data })));
  }
}
