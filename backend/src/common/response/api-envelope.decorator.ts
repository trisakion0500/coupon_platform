import { applyDecorators, Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiResponse,
  ApiResponseOptions,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  ApiResponseEnvelopeDto,
  PaginatedEnvelopeMetaDto,
} from './api-envelope.dto';

/**
 * `ResponseInterceptor`가 모든 성공 응답을 `{result:0, data}`로 감싸는 것(08_API_COMMON.md 1.4)을
 * Swagger 스키마에도 그대로 반영하는 헬퍼 데코레이터 3종. 컨트롤러 메서드가 실제로 반환하는
 * `data` 페이로드 타입 하나만 넘기면, 봉투 구조(`result`)까지 합쳐진 최종 응답 스키마를
 * `allOf` 조합으로 만들어준다 — nest-cli 플러그인의 자동 추론은 인터페이스 반환 타입에서는
 * `Object`로만 떨어지므로(런타임 타입 정보가 없어서), 매 엔드포인트마다 이 데코레이터를 명시적으로
 * 붙여야 실제 필드 스키마가 노출된다.
 *
 * @author trisakion
 */
export function ApiEnvelopedResponse<TModel extends Type<unknown>>(
  model: TModel,
  options: ApiResponseOptions = {},
) {
  return applyDecorators(
    ApiExtraModels(ApiResponseEnvelopeDto, model),
    ApiResponse({
      status: options.status ?? 200,
      description: options.description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiResponseEnvelopeDto) },
          { properties: { data: { $ref: getSchemaPath(model) } } },
        ],
      },
    }),
  );
}

/** 08_API_COMMON.md 2.4 페이지네이션 응답 셰이프(`page`/`page_size`/`total_count`/`items`)까지
 * 봉투 안에 함께 조합한다. */
export function ApiEnvelopedPaginatedResponse<TModel extends Type<unknown>>(
  model: TModel,
  options: ApiResponseOptions = {},
) {
  return applyDecorators(
    ApiExtraModels(ApiResponseEnvelopeDto, PaginatedEnvelopeMetaDto, model),
    ApiResponse({
      status: options.status ?? 200,
      description: options.description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiResponseEnvelopeDto) },
          {
            properties: {
              data: {
                allOf: [
                  { $ref: getSchemaPath(PaginatedEnvelopeMetaDto) },
                  {
                    properties: {
                      items: {
                        type: 'array',
                        items: { $ref: getSchemaPath(model) },
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    }),
  );
}

/** 컨트롤러가 값을 반환하지 않는 엔드포인트(logout/changePassword 등) — `data`가 빈 객체로
 * 직렬화된다(`undefined` 필드는 JSON.stringify가 생략). */
export function ApiEnvelopedEmptyResponse(options: ApiResponseOptions = {}) {
  return applyDecorators(
    ApiExtraModels(ApiResponseEnvelopeDto),
    ApiResponse({
      status: options.status ?? 200,
      description: options.description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiResponseEnvelopeDto) },
          { properties: { data: { type: 'object', example: {} } } },
        ],
      },
    }),
  );
}
