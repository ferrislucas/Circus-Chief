import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  _resetE2EOpenAIAllowanceFixtureForTests,
  createE2EOpenAIAllowanceClientFactory,
} from './e2eOpenAIAllowanceFixture.js';

const PROVIDER_ID = 'openai-default';
const COMPLETE = {
  complete: {
    'x-ratelimit-limit-requests': '100',
    'x-ratelimit-remaining-requests': '75',
    'x-ratelimit-reset-requests': '12s',
  },
};

const savedEnv = {
  VCR_MODE: process.env.VCR_MODE,
  FIXTURE: process.env.E2E_OPENAI_ALLOWANCE_FIXTURE,
};

function enableFixture(fixturePath) {
  process.env.VCR_MODE = 'replay';
  process.env.E2E_OPENAI_ALLOWANCE_FIXTURE = fixturePath;
}

function writeTempFixture(content) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-fixture-')), 'allowance-headers.json');
  fs.writeFileSync(file, content);
  return file;
}

afterEach(() => {
  if (savedEnv.VCR_MODE === undefined) delete process.env.VCR_MODE;
  else process.env.VCR_MODE = savedEnv.VCR_MODE;
  if (savedEnv.FIXTURE === undefined) delete process.env.E2E_OPENAI_ALLOWANCE_FIXTURE;
  else process.env.E2E_OPENAI_ALLOWANCE_FIXTURE = savedEnv.FIXTURE;
  _resetE2EOpenAIAllowanceFixtureForTests();
});

describe('createE2EOpenAIAllowanceClientFactory fixture boundary', () => {
  it('fails fast with a descriptive error when the fixture file is missing', () => {
    const missing = path.join(os.tmpdir(), 'e2e-fixture-missing', 'allowance-headers.json');
    enableFixture(missing);

    expect(() => createE2EOpenAIAllowanceClientFactory(PROVIDER_ID)).toThrowError(
      new RegExp(`E2E OpenAI allowance fixture not found.*${missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*E2E_OPENAI_ALLOWANCE_FIXTURE`),
    );
  });

  it('fails fast with a descriptive error when the fixture is not parseable JSON', () => {
    const file = writeTempFixture('not json{{{');
    enableFixture(file);

    expect(() => createE2EOpenAIAllowanceClientFactory(PROVIDER_ID)).toThrowError(
      /E2E OpenAI allowance fixture.*not valid JSON/,
    );
  });

  it('fails fast with a descriptive error when the fixture lacks a complete header object', () => {
    const file = writeTempFixture(JSON.stringify({ partial: { 'x-ratelimit-limit-requests': '100' } }));
    enableFixture(file);

    expect(() => createE2EOpenAIAllowanceClientFactory(PROVIDER_ID)).toThrowError(
      /E2E OpenAI allowance fixture requires a complete header object/,
    );
  });

  it('reads and parses the fixture once, then reuses it for later sessions', () => {
    const file = writeTempFixture(JSON.stringify(COMPLETE));
    enableFixture(file);

    const first = createE2EOpenAIAllowanceClientFactory(PROVIDER_ID);
    expect(typeof first).toBe('function');

    // The fixture file disappears after first use: later sessions still get
    // the validated headers instead of crashing per-session in
    // buildAgentConfig.
    fs.rmSync(file);
    const second = createE2EOpenAIAllowanceClientFactory(PROVIDER_ID);
    expect(typeof second).toBe('function');
  });

  it('stays inert for non-target providers and outside VCR mode', () => {
    const file = writeTempFixture(JSON.stringify(COMPLETE));
    enableFixture(file);

    expect(createE2EOpenAIAllowanceClientFactory('some-other-provider')).toBeNull();

    delete process.env.VCR_MODE;
    expect(createE2EOpenAIAllowanceClientFactory(PROVIDER_ID)).toBeNull();
  });
});
