export type CurrentLayoutItem = {
  slot_number: number;
  status: string;
  restaurant_id: string;
};

/** Complete monthly layout: one current item per slot, two distinct restaurants. */
export function isCompleteCurrentLayout(items: CurrentLayoutItem[]): boolean {
  const current = items.filter(
    (item) => item.status === 'assigned' || item.status === 'redeemed'
  );
  const slot1 = current.filter((item) => item.slot_number === 1);
  const slot2 = current.filter((item) => item.slot_number === 2);
  if (slot1.length !== 1 || slot2.length !== 1) return false;
  return slot1[0].restaurant_id !== slot2[0].restaurant_id;
}
