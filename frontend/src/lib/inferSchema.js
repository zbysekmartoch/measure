// src/lib/inferSchema.js
export function inferSchemaFromData(data, title = 'Config') {
    return {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title,
      ...infer(data)
    };
  }
  
  function infer(value) {
    if (value === null) return { type: 'null' };
    const t = Array.isArray(value) ? 'array' : typeof value;
  
    switch (t) {
      case 'string':
        return { type: 'string' };
      case 'number':
        return { type: 'number' };
      case 'boolean':
        return { type: 'boolean' };
      case 'array': {
        // Find the first non-empty element and infer item schema, otherwise any
        const first = value.find(v => v !== undefined);
        return { type: 'array', items: first !== undefined ? infer(first) : {} };
      }
      case 'object': {
        const props = {};
        const required = [];
        for (const [k, v] of Object.entries(value)) {
          props[k] = infer(v);
          if (v !== undefined) required.push(k);
        }
        return { type: 'object', properties: props, required };
      }
      default:
        return {}; // unknown → any
    }
  }
  