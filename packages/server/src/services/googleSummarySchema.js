// Convert the shared JSON Schema to the OpenAPI subset accepted by Google.
export function googleSummarySchema(schema) {
  const { additionalProperties: _additionalProperties, ...adapted } = schema;
  if (Array.isArray(schema.type) && schema.type.length === 2 && schema.type.includes('string') && schema.type.includes('null')) {
    adapted.type = 'string';
    adapted.nullable = true;
  }
  if (schema.properties) {
    adapted.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([name, property]) => [name, googleSummarySchema(property)])
    );
  }
  if (schema.items) adapted.items = googleSummarySchema(schema.items);
  return adapted;
}
