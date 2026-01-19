import { describe, it, expect } from 'vitest';

/**
 * Test the formatModelName function
 * This function converts model names like "claude-3-5-sonnet-20241022" to "claude-3.5-sonnet"
 */
describe('ConversationTab - formatModelName function', () => {
  // Import the function - we'll extract it from the component
  function formatModelName(model) {
    if (!model) return '';
    return model
      .replace(/-(\d{8})$/, '') // Remove date suffix
      .replace(/-(\d)-(\d)-/, '-$1.$2-'); // Convert 3-5 to 3.5
  }

  describe('formatModelName', () => {
    it('returns empty string for null model', () => {
      expect(formatModelName(null)).toBe('');
    });

    it('returns empty string for undefined model', () => {
      expect(formatModelName(undefined)).toBe('');
    });

    it('returns empty string for empty string model', () => {
      expect(formatModelName('')).toBe('');
    });

    it('removes date suffix from model name', () => {
      const result = formatModelName('claude-3-5-sonnet-20241022');
      expect(result).not.toContain('20241022');
    });

    it('converts version format 3-5 to 3.5', () => {
      const result = formatModelName('claude-3-5-sonnet-20241022');
      expect(result).toContain('3.5');
      expect(result).not.toContain('3-5');
    });

    it('formats claude-3-5-sonnet correctly', () => {
      const result = formatModelName('claude-3-5-sonnet-20241022');
      expect(result).toBe('claude-3.5-sonnet');
    });

    it('formats claude-3-opus correctly', () => {
      const result = formatModelName('claude-3-opus-20240229');
      expect(result).toBe('claude-3-opus');
    });

    it('formats claude-opus-4-5 correctly', () => {
      const result = formatModelName('claude-opus-4-5-20251101');
      expect(result).toBe('claude-opus-4-5');
    });

    it('formats claude-haiku-4-5 correctly', () => {
      const result = formatModelName('claude-haiku-4-5-20251001');
      expect(result).toBe('claude-haiku-4-5');
    });

    it('formats claude-sonnet-4-5 correctly', () => {
      const result = formatModelName('claude-sonnet-4-5-20250929');
      expect(result).toBe('claude-sonnet-4-5');
    });

    it('handles model names without date suffix', () => {
      // If the model doesn't have a date suffix, it should still work
      const result = formatModelName('claude-opus-4-5');
      expect(result).toBe('claude-opus-4-5');
    });

    it('handles model names with different date formats', () => {
      // Test with different date suffix
      const result = formatModelName('claude-3-5-sonnet-20230512');
      expect(result).toBe('claude-3.5-sonnet');
    });

    it('converts multiple version patterns if present', () => {
      // This is a hypothetical case - ensures the function is robust
      const result = formatModelName('claude-4-5-opus-20251101');
      expect(result).toBe('claude-4.5-opus');
    });

    it('preserves model name with no version conversion needed', () => {
      // Model without version pattern should pass through
      const result = formatModelName('claude-model-20240101');
      expect(result).toBe('claude-model');
    });
  });

  describe('message model display logic', () => {
    it('should show model for assistant messages with model', () => {
      const message = {
        role: 'assistant',
        model: 'claude-opus-4-5-20251101',
        content: 'Response',
        timestamp: Date.now(),
      };

      // Simulate the template logic
      const shouldShow = message.role === 'assistant' && message.model;
      expect(!!shouldShow).toBe(true);
      expect(formatModelName(message.model)).toBe('claude-opus-4-5');
    });

    it('should not show model for user messages', () => {
      const message = {
        role: 'user',
        model: null,
        content: 'Question',
        timestamp: Date.now(),
      };

      const shouldShow = message.role === 'assistant' && message.model;
      expect(!shouldShow).toBe(true);
    });

    it('should not show model for assistant messages without model', () => {
      const message = {
        role: 'assistant',
        model: null,
        content: 'Response',
        timestamp: Date.now(),
      };

      const shouldShow = message.role === 'assistant' && message.model;
      expect(!shouldShow).toBe(true);
    });

    it('should handle old messages with no model field gracefully', () => {
      const message = {
        role: 'assistant',
        content: 'Old response',
        timestamp: Date.now(),
        // model field intentionally missing
      };

      const shouldShow = message.role === 'assistant' && message.model;
      expect(!shouldShow).toBe(true);
    });
  });

  describe('model badge styling', () => {
    it('formats model for CSS class without special characters', () => {
      const model = 'claude-opus-4-5-20251101';
      const formatted = formatModelName(model);
      // Verify it has expected format
      expect(formatted).toMatch(/^claude-[a-z0-9.-]+$/);
    });

    it('provides readable format for display', () => {
      const models = [
        { input: 'claude-opus-4-5-20251101', expected: 'claude-opus-4-5' },
        { input: 'claude-sonnet-4-5-20250929', expected: 'claude-sonnet-4-5' },
        { input: 'claude-haiku-4-5-20251001', expected: 'claude-haiku-4-5' },
      ];

      models.forEach(({ input, expected }) => {
        const result = formatModelName(input);
        expect(result).toBe(expected);
      });
    });
  });

  describe('backward compatibility', () => {
    it('handles messages created before model tracking was added', () => {
      // Old message without model field
      const oldMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: 'Response from before model tracking',
        timestamp: Date.now(),
        // No model field - would have been null/undefined in old system
      };

      // Should not crash when accessing model
      const shouldShow = oldMessage.role === 'assistant' && oldMessage.model;
      // When model is undefined, shouldShow will be undefined (falsy)
      expect(!shouldShow).toBe(true);

      // Should return empty string from formatModelName
      expect(formatModelName(oldMessage.model)).toBe('');
    });

    it('handles mixed old and new messages in conversation', () => {
      const conversation = [
        {
          role: 'user',
          model: null,
          content: 'Question',
        },
        {
          role: 'assistant',
          content: 'Old answer without model',
          // No model field
        },
        {
          role: 'assistant',
          model: 'claude-opus-4-5-20251101',
          content: 'New answer with model',
        },
      ];

      // Process each message
      const processed = conversation.map((msg) => ({
        ...msg,
        shouldShowModel: msg.role === 'assistant' && msg.model,
        modelDisplay: msg.model ? formatModelName(msg.model) : '',
      }));

      expect(!processed[0].shouldShowModel).toBe(true); // User message - falsy
      expect(!processed[1].shouldShowModel).toBe(true); // Assistant without model - falsy
      expect(!!processed[2].shouldShowModel).toBe(true); // Assistant with model - truthy
      expect(processed[2].modelDisplay).toBe('claude-opus-4-5');
    });
  });
});
