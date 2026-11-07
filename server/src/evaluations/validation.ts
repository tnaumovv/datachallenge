import { z } from 'zod';
import type { EvaluationValidationIssue } from '../../../shared/contracts.js';
import { HttpError } from '../errors.js';

/** Retains the existing HTTP contract for manual scoring and appeals. */
export class OutputValidationError extends HttpError {
  readonly issues: EvaluationValidationIssue[];
  constructor(code: string, path: (string | number)[], message: string) {
    super(400, 'INVALID_ANSWERS', message);
    this.issues = [{ code, path, message }];
  }
}

function schemaMessage(issue: z.core.$ZodIssue): string {
  if (issue.code !== 'invalid_union') return issue.message;
  return `${issue.message}: ${issue.errors
    .map((branch) => branch.map(schemaMessage).join('; '))
    .join(' OR ')}`;
}

/** Persist validator diagnostics, never arbitrary SDK exceptions or response excerpts. */
export function validationIssues(error: unknown): EvaluationValidationIssue[] {
  if (error instanceof OutputValidationError) return error.issues;
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => ({
      code: issue.code,
      path: issue.path.map((part) => (typeof part === 'number' ? part : String(part))),
      message: schemaMessage(issue),
    }));
  }
  if (error instanceof SyntaxError) {
    // V8 sometimes embeds part of the response in "... is not valid JSON".
    // Other parser messages retain the grammar error and position/line/column.
    const message = error.message.includes(' is not valid JSON')
      ? `${error.message.startsWith('Unexpected token') ? 'Unexpected token in JSON' : 'Invalid JSON'}${
          error.message.match(/ at position \d+(?: \(line \d+ column \d+\))?/)?.[0] ?? ''
        }`
      : error.message;
    return [{ code: 'INVALID_JSON', path: [], message }];
  }
  return [{ code: 'VALIDATION_FAILED', path: [], message: 'Unexpected validation failure' }];
}
