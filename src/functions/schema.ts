import { getAllSchemas, generateMarkdownDocs } from '@google/jules-sdk';
import type { SchemaResult, SchemaFormat, SchemaDomain } from './types.js';

export function getSchema(
  domain: SchemaDomain = 'all',
  format: SchemaFormat = 'json',
): SchemaResult {
  if (format === 'markdown') {
    return {
      content: generateMarkdownDocs(),
      format: 'markdown',
    };
  }

  const schemas = getAllSchemas();
  let content: object;

  if (domain === 'sessions') {
    content = {
      sessions: schemas.sessions,
      filterOps: schemas.filterOps,
      projection: schemas.projection,
    };
  } else if (domain === 'activities') {
    content = {
      activities: schemas.activities,
      filterOps: schemas.filterOps,
      projection: schemas.projection,
    };
  } else {
    content = schemas;
  }

  return {
    content,
    format: 'json',
  };
}
