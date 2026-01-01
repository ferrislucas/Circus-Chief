import { describe, it, expect, vi } from "vitest";
import { useSubmitShortcut } from "./useSubmitShortcut.js";

describe("useSubmitShortcut", () => {
  it("calls callback on Command+Enter (metaKey=true)", () => {
    const callback = vi.fn();
    const handler = useSubmitShortcut(callback);
    const event = { key: "Enter", metaKey: true, ctrlKey: false, preventDefault: vi.fn() };
    handler(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledOnce();
  });

  it("calls callback on Ctrl+Enter (ctrlKey=true)", () => {
    const callback = vi.fn();
    const handler = useSubmitShortcut(callback);
    const event = { key: "Enter", metaKey: false, ctrlKey: true, preventDefault: vi.fn() };
    handler(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledOnce();
  });

  it("calls callback when both metaKey and ctrlKey are true", () => {
    const callback = vi.fn();
    const handler = useSubmitShortcut(callback);
    const event = { key: "Enter", metaKey: true, ctrlKey: true, preventDefault: vi.fn() };
    handler(event);
    expect(callback).toHaveBeenCalledOnce();
  });

  it("does NOT call callback on plain Enter", () => {
    const callback = vi.fn();
    const handler = useSubmitShortcut(callback);
    const event = { key: "Enter", metaKey: false, ctrlKey: false, preventDefault: vi.fn() };
    handler(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });

  it("does NOT call callback on Shift+Enter", () => {
    const callback = vi.fn();
    const handler = useSubmitShortcut(callback);
    const event = { key: "Enter", metaKey: false, ctrlKey: false, shiftKey: true, preventDefault: vi.fn() };
    handler(event);
    expect(callback).not.toHaveBeenCalled();
  });

  it("does NOT call callback on Ctrl+Space", () => {
    const callback = vi.fn();
    const handler = useSubmitShortcut(callback);
    const event = { key: " ", metaKey: false, ctrlKey: true, preventDefault: vi.fn() };
    handler(event);
    expect(callback).not.toHaveBeenCalled();
  });

  it("returns a function", () => {
    const handler = useSubmitShortcut(vi.fn());
    expect(typeof handler).toBe("function");
  });
});
