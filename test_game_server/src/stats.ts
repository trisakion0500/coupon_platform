import { appLogger } from './logger';
import { ScenarioName, ScenarioRunResult } from './scenarios/types';

interface ScenarioCounter {
  success: number;
  errors: Map<number, number>;
}

const counters = new Map<ScenarioName, ScenarioCounter>();
let unconfirmedBacklog: number | null = null;
let tickCount = 0;

const SUMMARY_EVERY_N_TICKS = 10;

function getCounter(scenario: ScenarioName): ScenarioCounter {
  let counter = counters.get(scenario);
  if (!counter) {
    counter = { success: 0, errors: new Map() };
    counters.set(scenario, counter);
  }
  return counter;
}

/** 시나리오 실행 결과를 누적한다(7장 — 시나리오별/결과코드별 카운터). */
export function record(results: ScenarioRunResult[]): void {
  for (const result of results) {
    const counter = getCounter(result.scenario);
    if (result.resultCode === 0) {
      counter.success += 1;
    } else {
      counter.errors.set(result.resultCode, (counter.errors.get(result.resultCode) ?? 0) + 1);
    }
  }
}

/** 6.6 리컨실리에이션이 매 tick 관측한 미컨슘 총 건수를 기록한다(7장). */
export function recordUnconfirmedBacklog(count: number): void {
  unconfirmedBacklog = count;
}

/** 매 tick 종료 시 호출 — 기본 10 tick마다 누적 요약을 로그로 출력한다. */
export function onTickComplete(): void {
  tickCount += 1;
  if (tickCount % SUMMARY_EVERY_N_TICKS !== 0) return;
  printSummary();
}

function printSummary(): void {
  const lines: string[] = [`==== 요약 (tick #${tickCount}) ====`];
  for (const [scenario, counter] of counters) {
    const errorSummary = [...counter.errors.entries()]
      .map(([code, count]) => `${code}:${count}`)
      .join(', ');
    lines.push(
      `  ${scenario}: 성공=${counter.success}${errorSummary ? `, 에러=[${errorSummary}]` : ''}`,
    );
  }
  if (unconfirmedBacklog !== null) {
    lines.push(`  미컨슘 잔존 건수(최근 관측): ${unconfirmedBacklog}`);
  }
  appLogger.info(lines.join('\n'));
}
