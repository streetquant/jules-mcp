import {
  validateQuery as coreValidateQuery,
  formatValidationResult,
} from '@google/jules-sdk';
import type { ValidationResult } from './types.js';

export function validateQuery(query: unknown): ValidationResult {
  if (!query) {
    throw new Error('query is required');
  }

  const result = coreValidateQuery(query);

  return {
    valid: result.valid,
    errors: result.errors.map((e) => e.message),
    warnings: result.warnings.map((w) => w.message),
    message: formatValidationResult(result),
  };
}
