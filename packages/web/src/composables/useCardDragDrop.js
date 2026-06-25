import { ref } from 'vue';

/**
 * Composable for card drag-and-drop in the kanban board.
 * Manages drag state, drop indicators, and reorder/move operations.
 *
 * @param {import('vue').Ref<object>} board - Reactive reference to the kanban board
 * @param {Function} reorderCardsFn - Function to call for card reordering: (projectId, laneId, cardOrder) => Promise
 * @param {Function} moveCardFn - Function to call for cross-lane card moves: (projectId, cardId, targetLaneId, opts) => Promise
 * @param {import('vue').Ref<string>} projectId - Reactive reference to the project ID
 */
export function useCardDragDrop(board, reorderCardsFn, moveCardFn, projectId) {
  // Drag state
  const dragType = ref(null);
  const draggedCard = ref(null);
  const draggedCardLaneId = ref(null);
  const draggedCardIndex = ref(-1);
  const dropCardLaneId = ref(null);
  const dropCardIndex = ref(-1);

  const handleCardDragStart = (event, card, laneId, cardIndex) => {
    dragType.value = 'card';
    draggedCard.value = card;
    draggedCardLaneId.value = laneId;
    draggedCardIndex.value = cardIndex;
    const dt = event.dataTransfer;
    dt.effectAllowed = 'move';
    dt.setData('text/plain', card.id);
  };

  const handleCardDragOver = (event, laneId, cardIndex) => {
    if (dragType.value !== 'card') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const index = event.clientY < midY ? cardIndex : cardIndex + 1;

    if (laneId === draggedCardLaneId.value &&
        (index === draggedCardIndex.value || index === draggedCardIndex.value + 1)) {
      dropCardLaneId.value = null;
      dropCardIndex.value = -1;
    } else {
      dropCardLaneId.value = laneId;
      dropCardIndex.value = index;
    }
  };

  const handleDragEnd = () => {
    dragType.value = null;
    draggedCard.value = null;
    draggedCardLaneId.value = null;
    draggedCardIndex.value = -1;
    dropCardLaneId.value = null;
    dropCardIndex.value = -1;
  };

  const reorderCardsInLane = async (laneId, sourceIndex, dropIndex) => {
    const lane = board.value?.lanes?.find((l) => l.id === laneId);
    if (!lane?.cards) return;

    let targetIndex = dropIndex >= 0 ? dropIndex : lane.cards.length;
    if (targetIndex > sourceIndex) targetIndex--;
    if (targetIndex === sourceIndex) return;

    const newOrder = lane.cards.map((c) => c.id);
    const [movedId] = newOrder.splice(sourceIndex, 1);
    newOrder.splice(targetIndex, 0, movedId);

    try {
      await reorderCardsFn(projectId.value, laneId, newOrder);
    } catch (err) {
      console.error('Failed to reorder cards:', err);
    }
  };

  const moveCardToLane = async (cardId, targetLaneId) => {
    try {
      await moveCardFn(projectId.value, cardId, targetLaneId, {
        runOnEnterTemplate: true,
      });
    } catch (err) {
      console.error('Failed to move card:', err);
    }
  };

  const handleDrop = async (event, targetLaneId) => {
    event.preventDefault();

    if (dragType.value !== 'card' || !draggedCard.value) {
      handleDragEnd();
      return;
    }

    const cardId = event.dataTransfer.getData('text/plain');
    if (!cardId) {
      handleDragEnd();
      return;
    }

    const sourceLaneId = draggedCardLaneId.value;

    if (sourceLaneId === targetLaneId) {
      await reorderCardsInLane(targetLaneId, draggedCardIndex.value, dropCardIndex.value);
    } else {
      await moveCardToLane(cardId, targetLaneId);
    }

    handleDragEnd();
  };

  const moveCardInLane = async (laneId, fromIndex, toIndex) => {
    const lane = board.value?.lanes?.find((l) => l.id === laneId);
    if (!lane?.cards) return;
    const newOrder = lane.cards.map((c) => c.id);
    const [movedId] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, movedId);
    try {
      await reorderCardsFn(projectId.value, laneId, newOrder);
    } catch (err) {
      console.error('Failed to reorder cards:', err);
    }
  };

  return {
    dragType,
    draggedCard,
    dropCardLaneId,
    dropCardIndex,
    handleCardDragStart,
    handleCardDragOver,
    handleDragEnd,
    handleDrop,
    moveCardInLane,
  };
}
