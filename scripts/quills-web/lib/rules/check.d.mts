export interface ConformanceFinding {
  rule: `C${number}`;
  file: string;
  line: number;
  message: string;
}

export function checkConformance(
  root: string,
  onlyRule?: string,
): Promise<ConformanceFinding[]>;
