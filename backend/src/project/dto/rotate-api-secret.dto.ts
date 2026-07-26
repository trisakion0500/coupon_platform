import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

/**
 * POST /projects/{project_id}/api-secret/rotate 요청 바디. 11_PROJECT_API.md 2.5.
 *
 * `edit_count`는 필수다 — 낙관적 동시성 제어 토큰(update-project.dto.ts와 동일한 이유). 더블클릭이나
 * 타임아웃 재시도로 거의 동시에 두 번 재발급되는 걸 막기 위해 도입됐다(project.sql 헤더 주석,
 * SP_PROJECT_API_SECRET_ROTATE.sql 수정1 참고) — 재발급 자체는 멱등하지 않으므로(호출할 때마다
 * api_secret_prev가 갱신됨) 호출자가 최신 상태를 보고 요청한 게 맞는지 반드시 확인해야 한다.
 *
 * @author trisakion
 */
export class RotateApiSecretDto {
  @ApiProperty({
    description:
      '낙관적 동시성 제어 토큰 — GET /projects/{id}에서 받은 값을 그대로 전달',
    example: 0,
  })
  @IsInt()
  @Min(0)
  edit_count!: number;
}
