/**
 * Ownership gate for carried assignment. Pending and already-linked credits
 * both continue to SQL so a second click can observe `existing`.
 */
export function shouldInvokeAssignRpc(
  credit: { status: string; issuePeriod: string },
  chicagoMonth: string,
): boolean {
  if (credit.issuePeriod >= chicagoMonth) return false;
  return credit.status === 'pending' || credit.status === 'linked';
}

export function assignCarriedUserMessage(outcome: string | null | undefined): string | null {
  if (outcome === 'linked' || outcome === 'existing') return null;
  if (outcome === 'below_floor') return 'This restaurant is below the $20 savings floor.';
  if (outcome === 'capacity_full') return 'This restaurant is at capacity.';
  if (outcome === 'duplicate_restaurant') {
    return 'That restaurant is already on this credit month.';
  }
  if (outcome === 'carried_due') return 'This carried credit is past its deadline.';
  if (outcome === 'not_carried') return 'This credit is not available to assign.';
  if (outcome === 'invalid_restaurant') return 'That restaurant is not available.';
  if (outcome === 'inactive_subscription') {
    return 'An active Wanderbite subscription is required.';
  }
  if (outcome === 'legacy_workflow') {
    return 'Carried assignment is not available for this account.';
  }
  if (outcome === 'slot_taken') return 'This credit slot is already filled.';
  if (outcome === 'legacy_cycle_present') {
    return 'This credit month cannot take a carried assignment.';
  }
  return 'Could not assign this restaurant.';
}
