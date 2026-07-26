import { Controller, Get } from '@nestjs/common';
import { ApiEnvelopedResponse } from '../common/response/api-envelope.decorator';
import { HealthResponseDto } from './dto/health-response.dto';

/**
 * 08_API_COMMON.md 6장: 인증 불필요, 서버 기동/로드밸런서 헬스체크용.
 *
 * @author trisakion
 */
@Controller('health')
export class HealthController {
  /**
   * `server_time`(UTC epoch ms, 2026-07-25 추가)은 헬스체크 부가 정보이자 프론트 헤더의
   * 실시간 시계 기능이 클라이언트-서버 시계 오프셋을 계산하는 데 쓰인다(16_LAYOUT.md 2.1) —
   * 캠페인 활성화가 `campaign_end > NOW()`(서버/DB 기준)로 판정되므로, 화면에도 브라우저
   * 기기 시각이 아니라 실제 판정 기준인 서버 시각을 보여주는 게 정확하다.
   * @returns 응답 인터셉터가 `{result:0, data:{...}}`로 감싼다.
   */
  @Get()
  @ApiEnvelopedResponse(HealthResponseDto)
  check(): { status: string; server_time: number } {
    return { status: 'ok', server_time: Date.now() };
  }
}
