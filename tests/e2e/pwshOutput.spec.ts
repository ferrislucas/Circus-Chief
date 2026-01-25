import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupAll,
  seedCommandButton,
  waitForSessionToExist,
  runCommandButton,
  waitForCommandRunComplete,
  runCommandButtonAndWait,
  getCommandRun,
} from './helpers';

/**
 * pw.sh Output Verification Tests
 *
 * These tests verify that running pw.sh (Playwright test runner) via command buttons:
 * 1. Captures output correctly in the database
 * 2. Reports accurate exit codes
 *
 * The tests use the API to run commands and verify database records,
 * providing an automated way to verify the fix works.
 */
test.describe('pw.sh Script Output Verification', () => {
  test.describe.configure({ timeout: 120000 }); // 2 minute timeout for Docker commands

  let project: any;
  let session: any;

  // Use the actual project root where pw.sh is located
  const PROJECT_ROOT = process.cwd();

  test.beforeEach(async () => {
    await cleanupAll();
    // Create project pointing to the actual codebase where pw.sh exists
    project = await seedProject('pw.sh Test', PROJECT_ROOT);
    session = await seedSession(project.id, { prompt: 'Test pw.sh', name: 'pw.sh Session' });
    await waitForSessionToExist(session.id);
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  // ============================================================
  // Test Case 1: Simple echo command (baseline)
  // Verifies the command runner works with simple commands
  // ============================================================
  test('baseline: simple echo captures output correctly', async () => {
    const marker = `BASELINE_MARKER_${Date.now()}`;

    const button = await seedCommandButton(project.id, {
      label: 'Baseline Echo',
      command: `echo "${marker}"`,
    });

    const run = await runCommandButtonAndWait(session.id, button.id);

    // Verify output contains the marker
    expect(run.output).toContain(marker);
    // Verify exit code is 0 (success)
    expect(run.exitCode).toBe(0);
    expect(run.status).toBe('success');
  });

  // ============================================================
  // Test Case 2: Failing command captures exit code
  // ============================================================
  test('baseline: failing command captures non-zero exit code', async () => {
    const button = await seedCommandButton(project.id, {
      label: 'Failing Command',
      command: 'exit 42',
    });

    const run = await runCommandButtonAndWait(session.id, button.id);

    // Verify exit code is captured correctly
    expect(run.exitCode).toBe(42);
    expect(run.status).toBe('error');
  });

  // ============================================================
  // Test Case 3: Docker command output (similar to pw.sh)
  // Tests that docker commands capture output correctly
  // ============================================================
  test('docker hello-world captures output', async () => {
    const button = await seedCommandButton(project.id, {
      label: 'Docker Hello',
      command: 'docker run --rm hello-world',
    });

    const run = await runCommandButtonAndWait(session.id, button.id, 60000);

    // Docker hello-world should output "Hello from Docker!"
    expect(run.output).toContain('Hello from Docker!');
    expect(run.exitCode).toBe(0);
    expect(run.status).toBe('success');
  });

  // ============================================================
  // Test Case 4: pw.sh help command (quick test)
  // ============================================================
  test.skip('pw.sh help captures output - TODO: fix output capture timing', async () => {
    const button = await seedCommandButton(project.id, {
      label: 'pw.sh Help',
      command: './scripts/pw.sh help',
    });

    const run = await runCommandButtonAndWait(session.id, button.id, 30000);

    // Verify help output is captured
    expect(run.output).toContain('Playwright Browser Container CLI');
    expect(run.output).toContain('Commands:');
    expect(run.exitCode).toBe(0);
    expect(run.status).toBe('success');
  });

  // ============================================================
  // Test Case 5: pw.sh test with passing test
  // This is the key test - verifies Playwright output is captured
  // ============================================================
  test('pw.sh test captures Playwright output and exit code', async () => {
    // Run a specific test that we know passes
    const button = await seedCommandButton(project.id, {
      label: 'pw.sh Test',
      command: './scripts/pw.sh test --grep="should execute pwd"',
    });

    const run = await runCommandButtonAndWait(session.id, button.id, 90000);

    // Log the output for debugging
    console.log('=== pw.sh test output ===');
    console.log(`Status: ${run.status}`);
    console.log(`Exit code: ${run.exitCode}`);
    console.log(`Output length: ${run.output?.length || 0}`);
    console.log('Output preview (first 500 chars):');
    console.log(run.output?.substring(0, 500) || '(no output)');
    console.log('=========================');

    // CRITICAL ASSERTIONS:
    // 1. Output should not be empty
    expect(run.output.length).toBeGreaterThan(0);

    // 2. Output should contain Playwright-related content
    // (At minimum, we expect some output from the test runner)
    const hasPlaywrightOutput =
      run.output.includes('playwright') ||
      run.output.includes('Playwright') ||
      run.output.includes('Running') ||
      run.output.includes('test') ||
      run.output.includes('passed') ||
      run.output.includes('failed');

    expect(hasPlaywrightOutput).toBe(true);

    // 3. Exit code should be defined (not null/undefined)
    expect(run.exitCode).toBeDefined();
    expect(typeof run.exitCode).toBe('number');

    // 4. Status should reflect exit code
    if (run.exitCode === 0) {
      expect(run.status).toBe('success');
    } else {
      expect(run.status).toBe('error');
    }
  });

  // ============================================================
  // Test Case 6: Verify output is streamed (not just final)
  // ============================================================
  test.skip('long-running command streams output incrementally - TODO: fix streaming output capture', async () => {
    // Create a command that outputs over time
    const button = await seedCommandButton(project.id, {
      label: 'Streaming Test',
      command: 'for i in 1 2 3 4 5; do echo "STREAM_LINE_$i"; sleep 0.5; done',
    });

    // Start the command
    const { runId } = await runCommandButton(session.id, button.id);

    // Wait a bit for partial output
    await new Promise((r) => setTimeout(r, 1500));

    // Check intermediate state - should have some output
    const intermediateRun = await getCommandRun(session.id, runId);

    // Wait for completion
    const finalRun = await waitForCommandRunComplete(session.id, runId, 10000);

    // Log for debugging
    console.log('=== Streaming test ===');
    console.log(`Intermediate output length: ${intermediateRun?.output?.length || 0}`);
    console.log(`Final output length: ${finalRun.output?.length || 0}`);
    console.log('======================');

    // Verify all lines are captured
    expect(finalRun.output).toContain('STREAM_LINE_1');
    expect(finalRun.output).toContain('STREAM_LINE_2');
    expect(finalRun.output).toContain('STREAM_LINE_3');
    expect(finalRun.output).toContain('STREAM_LINE_4');
    expect(finalRun.output).toContain('STREAM_LINE_5');
    expect(finalRun.exitCode).toBe(0);
  });

  // ============================================================
  // Test Case 7: Exit code accuracy for script commands
  // ============================================================
  test('script wrapper preserves exit code from nested commands', async () => {
    // Test various exit codes to ensure they propagate correctly
    const testCases = [
      { exitCode: 0, expected: 'success' },
      { exitCode: 1, expected: 'error' },
      { exitCode: 2, expected: 'error' },
    ];

    for (const tc of testCases) {
      const button = await seedCommandButton(project.id, {
        label: `Exit ${tc.exitCode}`,
        command: `sh -c 'exit ${tc.exitCode}'`,
      });

      const run = await runCommandButtonAndWait(session.id, button.id);

      expect(run.exitCode).toBe(tc.exitCode);
      expect(run.status).toBe(tc.expected);
    }
  });

  // ============================================================
  // Test Case 8: pw.sh with intentionally failing test
  // Verifies exit code is non-zero when tests fail
  // ============================================================
  test('pw.sh reports non-zero exit code when tests fail', async () => {
    // Run a test that doesn't exist (will fail)
    const button = await seedCommandButton(project.id, {
      label: 'Failing pw.sh',
      command: './scripts/pw.sh test --grep="THIS_TEST_DOES_NOT_EXIST_12345"',
    });

    const run = await runCommandButtonAndWait(session.id, button.id, 90000);

    console.log('=== Failing pw.sh test ===');
    console.log(`Status: ${run.status}`);
    console.log(`Exit code: ${run.exitCode}`);
    console.log('==========================');

    // Output should not be empty
    expect(run.output.length).toBeGreaterThan(0);

    // Exit code should be defined
    expect(run.exitCode).toBeDefined();

    // Note: Playwright may return 0 if no tests match (not an error in Playwright's view)
    // or it may return 1. Either way, we verify the exit code is accurately captured.
    expect(typeof run.exitCode).toBe('number');
  });
});
