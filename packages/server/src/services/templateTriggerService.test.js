import { describe, it, expect } from 'vitest';
import { renderTemplatePrompt } from './templateTriggerService.js';

describe('templateTriggerService', () => {
  describe('renderTemplatePrompt', () => {
    it('renders template with parentSession.summary', async () => {
      const templatePrompt = 'Review the work: {{parentSession.summary}}';
      const parentSession = {
        id: 'session-123',
        name: 'Test Session',
        status: 'completed',
      };
      const summary = {
        fullSummary: 'Built a new feature for user authentication.',
        shortSummary: 'Built auth feature',
      };

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, summary);

      expect(rendered).toBe('Review the work: Built a new feature for user authentication.');
    });

    it('renders template with parentSession.id', async () => {
      const templatePrompt = 'Parent session ID: {{parentSession.id}}';
      const parentSession = {
        id: 'abc-123-def',
        name: 'Test',
        status: 'completed',
      };

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, null);

      expect(rendered).toBe('Parent session ID: abc-123-def');
    });

    it('renders template with parentSession.name', async () => {
      const templatePrompt = 'Following up on: {{parentSession.name}}';
      const parentSession = {
        id: 'session-123',
        name: 'Build login page',
        status: 'completed',
      };

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, null);

      expect(rendered).toBe('Following up on: Build login page');
    });

    it('renders template with parentSession.status', async () => {
      const templatePrompt = 'Session ended with status: {{parentSession.status}}';
      const parentSession = {
        id: 'session-123',
        name: 'Test',
        status: 'error',
      };

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, null);

      expect(rendered).toBe('Session ended with status: error');
    });

    it('uses shortSummary when fullSummary is not available', async () => {
      const templatePrompt = 'Summary: {{parentSession.summary}}';
      const parentSession = {
        id: 'session-123',
        name: 'Test',
        status: 'completed',
      };
      const summary = {
        shortSummary: 'Short summary only',
        fullSummary: null,
      };

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, summary);

      expect(rendered).toBe('Summary: Short summary only');
    });

    it('uses fallback when no summary is available', async () => {
      const templatePrompt = 'Summary: {{parentSession.summary}}';
      const parentSession = {
        id: 'session-123',
        name: 'Test',
        status: 'completed',
      };

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, null);

      expect(rendered).toBe('Summary: No summary available');
    });

    it('renders template with keyActions array', async () => {
      const templatePrompt = '{% for action in parentSession.keyActions %}{{action}}, {% endfor %}';
      const parentSession = {
        id: 'session-123',
        name: 'Test',
        status: 'completed',
      };
      const summary = {
        keyActions: ['Added login form', 'Updated API', 'Fixed bug'],
      };

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, summary);

      expect(rendered).toBe('Added login form, Updated API, Fixed bug, ');
    });

    it('renders template with filesModified array', async () => {
      const templatePrompt = 'Modified: {% for file in parentSession.filesModified %}{{file}}{% unless forloop.last %}, {% endunless %}{% endfor %}';
      const parentSession = {
        id: 'session-123',
        name: 'Test',
        status: 'completed',
      };
      const summary = {
        filesModified: ['src/login.js', 'src/api.js'],
      };

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, summary);

      expect(rendered).toBe('Modified: src/login.js, src/api.js');
    });

    it('renders template with outcome', async () => {
      const templatePrompt = 'Outcome: {{parentSession.outcome}}';
      const parentSession = {
        id: 'session-123',
        name: 'Test',
        status: 'completed',
      };
      const summary = {
        outcome: 'partial',
      };

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, summary);

      expect(rendered).toBe('Outcome: partial');
    });

    it('uses session status as fallback outcome', async () => {
      const templatePrompt = 'Outcome: {{parentSession.outcome}}';
      const parentSession = {
        id: 'session-123',
        name: 'Test',
        status: 'error',
      };

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, null);

      expect(rendered).toBe('Outcome: error');
    });

    it('renders complex template with multiple variables', async () => {
      const templatePrompt = `
## Review Session: {{parentSession.name}}

Status: {{parentSession.status}}
Summary: {{parentSession.summary}}

Please review the above work.
      `.trim();

      const parentSession = {
        id: 'session-123',
        name: 'Build feature X',
        status: 'completed',
      };
      const summary = {
        fullSummary: 'Implemented feature X with tests.',
      };

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, summary);

      expect(rendered).toContain('Review Session: Build feature X');
      expect(rendered).toContain('Status: completed');
      expect(rendered).toContain('Summary: Implemented feature X with tests.');
    });

    it('handles template with no variables', async () => {
      const templatePrompt = 'This is a static prompt with no variables.';
      const parentSession = {
        id: 'session-123',
        name: 'Test',
        status: 'completed',
      };

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, null);

      expect(rendered).toBe('This is a static prompt with no variables.');
    });
  });
});
