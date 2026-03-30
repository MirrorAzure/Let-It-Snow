/**
 * Возвращает текущий индекс в циклической последовательности и следующий курсор.
 */
export function nextCircularIndex(cursor, count) {
  if (!count) {
    return { index: 0, nextCursor: 0 };
  }

  const safeCursor = Number.isFinite(cursor) ? cursor : 0;
  const index = ((safeCursor % count) + count) % count;
  const nextCursor = (index + 1) % count;

  return { index, nextCursor };
}