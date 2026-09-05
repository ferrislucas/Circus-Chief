/**
 * Selects complete allowance items that fit in a container. When any items are
 * hidden, space for the overflow control is reserved before selecting items.
 */
export function selectVisibleItems(itemWidths, availableWidth, overflowWidth) {
  const totalWidth = itemWidths.reduce((total, width) => total + width, 0);
  if (totalWidth <= availableWidth) return itemWidths.length;

  let visibleCount = 0;
  let usedWidth = overflowWidth;
  for (const width of itemWidths) {
    if (usedWidth + width > availableWidth) break;
    usedWidth += width;
    visibleCount += 1;
  }
  return visibleCount;
}
