import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * 두 문자열 필드를 사전식(lexicographic) 비교로 "이후"인지 검증한다 — `campaign_start`/
 * `campaign_end`처럼 `YYYY-MM-DD HH:mm:ss` 고정폭 포맷(08_API_COMMON.md 4.1)은 문자열 비교가
 * 곧 시간 순서 비교와 같아 별도 Date 파싱이 필요 없다. 비교 대상 필드 중 하나라도 값이 없으면
 * (update처럼 부분 수정이라 한쪽만 온 경우) 검증을 통과시킨다 — 이 경우 DB의 기존 값과 조합한
 * 최종 비교는 SP가 담당한다(예: SP_CAMPAIGN_UPDATE).
 *
 * @author trisakion
 */
export function IsAfter(
  property: string,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isAfter',
      target: object.constructor,
      propertyName,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [relatedPropertyName] = args.constraints as [string];
          const relatedValue = (args.object as Record<string, unknown>)[
            relatedPropertyName
          ];
          if (typeof value !== 'string' || typeof relatedValue !== 'string') {
            return true;
          }
          return value > relatedValue;
        },
        defaultMessage(args: ValidationArguments) {
          const [relatedPropertyName] = args.constraints as [string];
          return `${args.property} must be after ${relatedPropertyName}`;
        },
      },
    });
  };
}
