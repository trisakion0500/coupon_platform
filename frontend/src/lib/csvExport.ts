/**
 * 순수 CSV(UTF-8 BOM) 다운로드 유틸 — 엑셀에서 한글 깨짐 없이 바로 열리도록 BOM을 붙인다.
 * 별도 엑셀 라이브러리(xlsx/exceljs)는 알려진 미해결 보안취약점/취약한 전이의존성이 있어 채택하지 않았다.
 */
function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function downloadCsv(filename: string, headers: string[], rows: string[][]): void {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvField).join(','));
  const csvContent = '﻿' + lines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
