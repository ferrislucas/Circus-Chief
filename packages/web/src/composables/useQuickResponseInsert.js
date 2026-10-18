/** Keep quick-response draft behavior out of ConversationTab's orchestration. */
export function createQuickResponseInsert({
  getInput, setInput, cancelDraft, nextTick, inputFormRef, canSendMessage, savePendingPrompt, submit,
}) {
  return function handleQuickResponseInsert({ content, autoSubmit }) {
    const currentValue = getInput().trim();
    const newValue = currentValue ? `${currentValue  }\n\n${  content}` : content;
    setInput(newValue);

    if (autoSubmit) {
      cancelDraft();
      nextTick(() => submit({ renderLiquid: true }));
      return;
    }

    nextTick(() => {
      inputFormRef.value?.textareaRef?.blur();
      if (canSendMessage.value && newValue.trim()) savePendingPrompt(newValue);
    });
  };
}
