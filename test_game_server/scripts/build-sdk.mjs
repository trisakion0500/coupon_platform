// CouponS2sClient.ts를 컴파일해 같은 폴더에 .js/.d.ts로 함께 배포한다(하위호환 목적,
// TypeScript 툴체인이 없는 입점사도 .js를 바로 가져다 쓸 수 있게). 소스가 바뀔 때마다 이
// 스크립트로 재생성해야 두 산출물이 어긋나지 않는다.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

execSync('npx tsc -p tsconfig.sdk.json', { stdio: 'inherit', cwd: root });

const banner =
  '// 자동 생성 파일 — 직접 수정하지 말 것.\n' +
  '// 소스: src/sdk/CouponS2sClient.ts. 수정 후 `npm run build:sdk`로 재생성한다.\n\n';

for (const file of ['src/sdk/CouponS2sClient.js', 'src/sdk/CouponS2sClient.d.ts']) {
  const filePath = path.join(root, file);
  const content = readFileSync(filePath, 'utf8');
  if (!content.startsWith(banner)) {
    writeFileSync(filePath, banner + content);
  }
}

console.log('CouponS2sClient.js / .d.ts 재생성 완료');
