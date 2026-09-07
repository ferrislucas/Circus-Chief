/**
 * Selects complete allowance items that fit in a container. When any items are
 * hidden, space for the overflow control is reserved before selecting items.
 */
export function selectVisibleItems(itemWidths, availableWidth, overflowWidth, gap = 0) {
  const totalWidth = itemWidths.reduce((total, width) => total + width, 0)
    + Math.max(0, itemWidths.length - 1) * gap;
  if (totalWidth <= availableWidth) return itemWidths.length;

  let visibleCount = 0;
  let usedWidth = overflowWidth;
  for (const width of itemWidths) {
    // The overflow trigger remains visible, so each selected item needs a
    // flex gap between itself and the trigger (or the prior selected item).
    if (usedWidth + gap + width > availableWidth) break;
    usedWidth += gap + width;
    visibleCount += 1;
  }
  return visibleCount;
}
