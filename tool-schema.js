/**
 * Dependency-free re-implementation of the DSH `defineTool` contract.
 *
 * A third-party plugin loaded from a local path cannot import
 * `@deepseek-ai/dsh-tools`: that package ships inside the DSH application
 * bundle (app.asar/node_modules), not in the profile's node_modules, so a bare
 * import from a plugin directory fails with ERR_MODULE_NOT_FOUND.
 *
 * `ctx.tools.register()` only requires `{ name, description, parameters,
 * output: { schema, render }, execute }`, where `parameters` is plain JSON
 * Schema. This module compiles the same author-facing property DSL used by the
 * official `defineTool` (property map with per-property `required`) into that
 * JSON Schema, and adds the same strict argument check before `execute`.
 */

const VALUE_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null', 'array', 'object'])

const ANNOTATIONS = ['description', 'title']

function authorError(message) {
  throw new TypeError('tool schema: ' + message)
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function copyAnnotations(input, node) {
  for (const key of ANNOTATIONS) {
    if (Object.hasOwn(input, key)) {
      if (typeof input[key] !== 'string') authorError('"' + key + '" must be a string')
      node[key] = input[key]
    }
  }
}

function compileValue(input, path) {
  if (!isPlainObject(input)) authorError(path + ' must be an object')
  const type = input.type
  if (!VALUE_TYPES.has(type)) {
    authorError(path + '.type must be one of string/number/integer/boolean/null/array/object')
  }

  let node
  if (type === 'array') {
    node = { type: 'array' }
    if (Object.hasOwn(input, 'items')) {
      node.items = compileValue(input.items, path + '.items')
    }
  } else if (type === 'object') {
    node = { type: 'object' }
    if (Object.hasOwn(input, 'properties')) {
      const compiled = compilePropertyMap(input.properties, path + '.properties')
      node.properties = compiled.properties
      if (compiled.required !== undefined) node.required = compiled.required
    }
  } else {
    node = { type }
  }

  for (const key of Object.keys(input)) {
    if (key === 'type' || key === 'items' || key === 'properties' || key === 'required') continue
    if (!ANNOTATIONS.includes(key)) authorError(path + '.' + key + ' is not supported')
  }
  copyAnnotations(input, node)
  return node
}

/** Compile one implicit property map, collecting per-property requiredness. */
function compilePropertyMap(input, path) {
  if (!isPlainObject(input)) authorError(path + ' must be an object')
  const properties = {}
  const required = []
  for (const [name, spec] of Object.entries(input)) {
    if (!isPlainObject(spec)) authorError(path + '.' + name + ' must be an object')
    const valueSpec = { ...spec }
    const isRequired = valueSpec.required === true
    delete valueSpec.required
    properties[name] = compileValue(valueSpec, path + '.' + name)
    if (isRequired) required.push(name)
  }
  return { properties, required: required.length > 0 ? required : undefined }
}

/** Compile the author-facing parameter DSL into raw JSON Schema. */
export function parametersToJsonSchema(spec) {
  const compiled = compilePropertyMap(spec || {}, 'parameters')
  return {
    type: 'object',
    properties: compiled.properties,
    ...(compiled.required === undefined ? {} : { required: compiled.required }),
  }
}

/** Shallow argument check: required keys present, primitive kinds match. */
function validateArgs(schema, args) {
  const violations = []
  if (!isPlainObject(args)) return ['arguments must be an object']

  for (const name of schema.required || []) {
    if (!Object.hasOwn(args, name)) violations.push('missing required parameter "' + name + '"')
  }

  for (const [name, spec] of Object.entries(schema.properties || {})) {
    if (!Object.hasOwn(args, name)) continue
    const value = args[name]
    const path = '"' + name + '"'
    switch (spec.type) {
      case 'string':
        if (typeof value !== 'string') violations.push(path + ' must be a string')
        break
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) violations.push(path + ' must be a finite number')
        break
      case 'integer':
        if (!Number.isInteger(value)) violations.push(path + ' must be an integer')
        break
      case 'boolean':
        if (typeof value !== 'boolean') violations.push(path + ' must be a boolean')
        break
      case 'array': {
        if (!Array.isArray(value)) {
          violations.push(path + ' must be an array')
          break
        }
        const items = spec.items
        if (items && items.type) {
          value.forEach((entry, index) => {
            if (typeof entry !== items.type && !(items.type === 'null' && entry === null)) {
              violations.push(path + '[' + index + '] must be a ' + items.type)
            }
          })
        }
        break
      }
      default:
        break
    }
  }
  return violations
}

/**
 * Build a registry-ready tool definition from an author-facing spec.
 * Mirrors the official `defineTool`: parameter DSL in, JSON Schema out,
 * strict argument validation before `execute`.
 */
export function defineTool(options) {
  const parameters = parametersToJsonSchema(options.parameters || {})
  const output = options.output || {}
  const render = output.render || ((_args, value) => [{ type: 'text', text: String(value == null ? '' : value) }])
  const schema = output.schema || { type: 'string' }

  return {
    name: options.name,
    description: options.description,
    parameters,
    output: { schema, render: (args, value) => render(args, value) },
    async execute(args, exec) {
      const violations = validateArgs(parameters, args)
      if (violations.length > 0) throw new Error('invalid arguments: ' + violations.join('; '))
      return options.execute(args, exec)
    },
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  }
}
