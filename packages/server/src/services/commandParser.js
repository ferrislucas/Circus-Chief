import YAML from 'yaml';

/**
 * Parse YAML frontmatter from a markdown command file
 * Supports our extended schema with typed arguments
 *
 * @param {string} content - The file content
 * @returns {{ description: string, arguments: Array, body: string }}
 */
export function parseCommandFile(content) {
  // Check for frontmatter
  if (!content.startsWith('---')) {
    // No frontmatter, treat entire content as body
    return {
      description: '',
      arguments: [],
      body: content.trim(),
    };
  }

  // Find end of frontmatter
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    // Malformed frontmatter, treat as body
    return {
      description: '',
      arguments: [],
      body: content.trim(),
    };
  }

  const frontmatterStr = content.slice(3, endIndex).trim();
  const body = content.slice(endIndex + 3).trim();

  try {
    const frontmatter = YAML.parse(frontmatterStr);

    // Validate and normalize arguments schema
    const args = Array.isArray(frontmatter.arguments)
      ? frontmatter.arguments.map(normalizeArgument)
      : [];

    return {
      description: frontmatter.description || '',
      arguments: args,
      body,
    };
  } catch (err) {
    console.warn('Failed to parse command frontmatter:', err.message);
    return {
      description: '',
      arguments: [],
      body: content.trim(),
    };
  }
}

/**
 * Normalize an argument definition to ensure it has all required fields
 * @param {Object} arg - Argument from frontmatter
 * @returns {Object} Normalized argument
 */
export function normalizeArgument(arg) {
  if (!arg || typeof arg !== 'object') {
    return null;
  }

  const normalized = {
    name: arg.name || 'unnamed',
    type: ['select', 'text', 'multiline'].includes(arg.type) ? arg.type : 'text',
    label: arg.label || arg.name || 'Unnamed',
    required: arg.required === true,
    placeholder: arg.placeholder || '',
  };

  // Add options for select type
  if (normalized.type === 'select' && Array.isArray(arg.options)) {
    normalized.options = arg.options.map(opt => {
      if (typeof opt === 'string') {
        return { value: opt, label: opt };
      }
      return {
        value: opt.value || opt.label || '',
        label: opt.label || opt.value || '',
      };
    });
  }

  // Add default value if specified
  if (arg.default !== undefined) {
    normalized.default = arg.default;
  }

  return normalized;
}

/**
 * Parse a SKILL.md file with its extended frontmatter
 * @param {string} content - File content
 * @param {string} directoryName - The skill directory name (used as fallback name)
 * @returns {Object} Parsed skill object with name, description, argumentHint, userInvocable, disableModelInvocation, body
 */
export function parseSkillFile(content, directoryName) {
  // Check for frontmatter
  if (!content.startsWith('---')) {
    return {
      name: directoryName,
      description: '',
      argumentHint: null,
      userInvocable: true,
      disableModelInvocation: false,
      body: content.trim(),
    };
  }

  // Find end of frontmatter
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return {
      name: directoryName,
      description: '',
      argumentHint: null,
      userInvocable: true,
      disableModelInvocation: false,
      body: content.trim(),
    };
  }

  const frontmatterStr = content.slice(3, endIndex).trim();
  const body = content.slice(endIndex + 3).trim();

  try {
    const frontmatter = YAML.parse(frontmatterStr);

    return {
      name: frontmatter.name || directoryName,
      description: frontmatter.description || '',
      argumentHint: frontmatter['argument-hint'] || null,
      userInvocable: frontmatter['user-invocable'] !== false,
      disableModelInvocation: frontmatter['disable-model-invocation'] === true,
      body,
    };
  } catch (err) {
    console.warn('Failed to parse skill frontmatter:', err.message);
    return {
      name: directoryName,
      description: '',
      argumentHint: null,
      userInvocable: true,
      disableModelInvocation: false,
      body: content.trim(),
    };
  }
}
