import { Controller, Get } from '@nestjs/common';

/**
 * 08_API_COMMON.md 6장: 인증 불필요, 서버 기동/로드밸런서 헬스체크용.
 *
 * @author trisakion
 */
@Controller('health')
export class HealthController {
  /** @returns 응답 인터셉터가 `{result:0, data:{status:'ok'}}`로 감싼다. */
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}
