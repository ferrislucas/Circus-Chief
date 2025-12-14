import { test, expect } from '@playwright/test';
import { seedProject, seedSession, seedNote, cleanupAll, getNotes } from './helpers';

test.describe('Notes Management', () => {
  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Test Project', '/tmp/test');
    session = await seedSession(project.id, { prompt: 'Test', name: 'Notes Test Session' });
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('displays empty state when no notes exist', async ({ page }) => {
    await page.goto(`/sessions/${session.id}/notes`);

    // Verify empty state message
    await expect(page.locator('.empty-state')).toBeVisible();
    await expect(page.getByText('No notes yet')).toBeVisible();

    // Verify add note form is still visible even when empty
    await expect(page.locator('.add-note-form')).toBeVisible();
    await expect(page.locator('.add-note-form textarea')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Note' })).toBeVisible();

    // Verify via API that no notes exist
    const notes = await getNotes(session.id);
    expect(notes.length).toBe(0);
  });

  test('can add a new note', async ({ page }) => {
    await page.goto(`/sessions/${session.id}/notes`);

    const noteContent = 'This is my first test note';

    // Fill in the note content
    await page.fill('.add-note-form textarea', noteContent);

    // Verify Add Note button is enabled
    const addButton = page.getByRole('button', { name: 'Add Note' });
    await expect(addButton).toBeEnabled();

    // Submit the note
    await addButton.click();

    // Verify note appears in the list
    await expect(page.locator('.note .note-content')).toBeVisible();
    await expect(page.locator('.note .note-content')).toHaveText(noteContent);

    // Verify textarea is cleared after submission
    await expect(page.locator('.add-note-form textarea')).toHaveValue('');

    // Verify empty state is no longer visible
    await expect(page.locator('.empty-state')).not.toBeVisible();

    // Verify toast notification appears
    await expect(page.locator('.toast-success')).toBeVisible();
    await expect(page.getByText('Note added')).toBeVisible();

    // Verify via API that note was persisted
    const notes = await getNotes(session.id);
    expect(notes.length).toBe(1);
    expect(notes[0].content).toBe(noteContent);
  });

  test('Add Note button is disabled when textarea is empty', async ({ page }) => {
    await page.goto(`/sessions/${session.id}/notes`);

    // Verify button is disabled initially
    const addButton = page.getByRole('button', { name: 'Add Note' });
    await expect(addButton).toBeDisabled();

    // Type something
    await page.fill('.add-note-form textarea', 'Some content');
    await expect(addButton).toBeEnabled();

    // Clear it
    await page.fill('.add-note-form textarea', '');
    await expect(addButton).toBeDisabled();

    // Type only whitespace
    await page.fill('.add-note-form textarea', '   ');
    await expect(addButton).toBeDisabled();
  });

  test('displays multiple notes in reverse chronological order', async ({ page }) => {
    // Seed notes with slight delay to ensure different timestamps
    const note1 = await seedNote(session.id, 'First note');
    const note2 = await seedNote(session.id, 'Second note');
    const note3 = await seedNote(session.id, 'Third note');

    await page.goto(`/sessions/${session.id}/notes`);

    // Verify all notes are visible
    const noteElements = page.locator('.note');
    await expect(noteElements).toHaveCount(3);

    // Verify notes appear in reverse chronological order (newest first)
    const noteContents = page.locator('.note .note-content');
    await expect(noteContents.nth(0)).toHaveText('Third note');
    await expect(noteContents.nth(1)).toHaveText('Second note');
    await expect(noteContents.nth(2)).toHaveText('First note');

    // Verify each note has date displayed
    const noteDates = page.locator('.note .note-date');
    await expect(noteDates).toHaveCount(3);

    // Verify via API
    const notes = await getNotes(session.id);
    expect(notes.length).toBe(3);
  });

  test('can edit an existing note', async ({ page }) => {
    const note = await seedNote(session.id, 'Original content');

    await page.goto(`/sessions/${session.id}/notes`);

    // Verify original content is visible
    await expect(page.locator('.note .note-content')).toHaveText('Original content');

    // Click Edit button
    await page.click('.note .btn-link:has-text("Edit")');

    // Verify edit mode is active (textarea appears)
    await expect(page.locator('.note-edit')).toBeVisible();
    await expect(page.locator('.note-edit textarea')).toBeVisible();
    await expect(page.locator('.note-edit textarea')).toHaveValue('Original content');

    // Verify Save and Cancel buttons are visible
    await expect(page.locator('.note-edit-actions button:has-text("Save")')).toBeVisible();
    await expect(page.locator('.note-edit-actions button:has-text("Cancel")')).toBeVisible();

    // Edit the content
    await page.fill('.note-edit textarea', 'Updated content');

    // Save the changes
    await page.click('.note-edit-actions button:has-text("Save")');

    // Verify edit mode is closed
    await expect(page.locator('.note-edit')).not.toBeVisible();

    // Verify updated content is displayed
    await expect(page.locator('.note .note-content')).toHaveText('Updated content');

    // Verify toast notification
    await expect(page.locator('.toast-success')).toBeVisible();
    await expect(page.getByText('Note updated')).toBeVisible();

    // Verify via API that change was persisted
    const notes = await getNotes(session.id);
    expect(notes.length).toBe(1);
    expect(notes[0].content).toBe('Updated content');
  });

  test('can cancel editing a note', async ({ page }) => {
    await seedNote(session.id, 'Original content');

    await page.goto(`/sessions/${session.id}/notes`);

    // Click Edit
    await page.click('.note .btn-link:has-text("Edit")');

    // Modify content
    await page.fill('.note-edit textarea', 'Modified but not saved');

    // Click Cancel
    await page.click('.note-edit-actions button:has-text("Cancel")');

    // Verify edit mode is closed
    await expect(page.locator('.note-edit')).not.toBeVisible();

    // Verify original content is still displayed
    await expect(page.locator('.note .note-content')).toHaveText('Original content');

    // Verify via API that content was not changed
    const notes = await getNotes(session.id);
    expect(notes[0].content).toBe('Original content');
  });

  test('can delete a note', async ({ page }) => {
    const note = await seedNote(session.id, 'Note to delete');

    // Verify note exists via API
    let notes = await getNotes(session.id);
    expect(notes.length).toBe(1);

    await page.goto(`/sessions/${session.id}/notes`);

    // Verify note is visible
    await expect(page.getByText('Note to delete')).toBeVisible();

    // Handle confirmation dialog
    page.on('dialog', (dialog) => dialog.accept());

    // Click Delete button
    await page.click('.note .btn-link-danger:has-text("Delete")');

    // Verify note is no longer visible
    await expect(page.getByText('Note to delete')).not.toBeVisible();

    // Verify empty state is shown
    await expect(page.locator('.empty-state')).toBeVisible();

    // Verify toast notification
    await expect(page.locator('.toast-success')).toBeVisible();
    await expect(page.getByText('Note deleted')).toBeVisible();

    // Verify via API that note was deleted
    notes = await getNotes(session.id);
    expect(notes.length).toBe(0);
  });

  test('can cancel note deletion', async ({ page }) => {
    await seedNote(session.id, 'Note to keep');

    await page.goto(`/sessions/${session.id}/notes`);

    // Handle confirmation dialog - reject
    page.on('dialog', (dialog) => dialog.dismiss());

    // Click Delete button
    await page.click('.note .btn-link-danger:has-text("Delete")');

    // Verify note is still visible
    await expect(page.getByText('Note to keep')).toBeVisible();

    // Verify empty state is NOT shown
    await expect(page.locator('.empty-state')).not.toBeVisible();

    // Verify via API that note still exists
    const notes = await getNotes(session.id);
    expect(notes.length).toBe(1);
  });

  test('displays loading state while fetching notes', async ({ page }) => {
    // Navigate to notes tab
    await page.goto(`/sessions/${session.id}/notes`);

    // Loading state should disappear quickly and show empty state
    await expect(page.locator('.loading-state')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.empty-state')).toBeVisible();
  });

  test('note actions (Edit/Delete) are visible for each note', async ({ page }) => {
    await seedNote(session.id, 'Note with actions');

    await page.goto(`/sessions/${session.id}/notes`);

    // Verify note card has both action buttons
    const note = page.locator('.note');
    await expect(note.locator('.note-actions')).toBeVisible();
    await expect(note.locator('.btn-link:has-text("Edit")')).toBeVisible();
    await expect(note.locator('.btn-link-danger:has-text("Delete")')).toBeVisible();
  });

  test('newly added note appears at the top of the list', async ({ page }) => {
    // Seed an existing note
    await seedNote(session.id, 'Existing note');

    await page.goto(`/sessions/${session.id}/notes`);

    // Add a new note via UI
    await page.fill('.add-note-form textarea', 'New note added via UI');
    await page.click('button:has-text("Add Note")');

    // Wait for note to appear
    await expect(page.locator('.note')).toHaveCount(2);

    // Verify new note is at the top
    const noteContents = page.locator('.note .note-content');
    await expect(noteContents.nth(0)).toHaveText('New note added via UI');
    await expect(noteContents.nth(1)).toHaveText('Existing note');
  });
});
