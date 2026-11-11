import {
  DRAWINGS_NOT_SET_UP,
  DRAWINGS_UNAVAILABLE,
  type DrawingsAdminView,
} from '@/lib/drawings/admin-read-model';

/**
 * Read-only drawing records. No form, no button, and no write.
 */
export function DrawingsAdmin({ view }: { view: DrawingsAdminView }) {
  if (!view.ok) {
    return (
      <p className="text-sm text-muted-foreground">
        {view.reason === 'not_set_up' ? DRAWINGS_NOT_SET_UP : DRAWINGS_UNAVAILABLE}
      </p>
    );
  }
  if (view.campaigns.length === 0) {
    return <p className="text-sm text-muted-foreground">No drawing campaigns are stored.</p>;
  }
  return (
    <ul className="space-y-6">
      {view.campaigns.map((campaign) => (
        <li key={campaign.id} className="space-y-4 rounded-xl border p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">{campaign.quarterKey}</h2>
            <p className="text-sm text-muted-foreground">
              {campaign.modeLabel} · {campaign.statusLabel}
            </p>
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Activated</dt>
              <dd>{campaign.activatedOn ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Closed</dt>
              <dd>{campaign.closedOn ?? '—'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Budget</dt>
              <dd>{campaign.budgetLabel}</dd>
            </div>
          </dl>
          <div>
            <h3 className="text-sm font-medium">Prizes</h3>
            {campaign.prizes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No prizes are stored.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-sm">
                {campaign.prizes.map((prize, index) => (
                  <li key={`${campaign.id}:prize:${index}`}>
                    <span>{prize.label}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      · {prize.quantity} × {prize.unitValue} each
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-1 text-sm">
            <h3 className="font-medium">Simulated selection</h3>
            {campaign.selection ? (
              <>
                <p>Ran {campaign.selection.ranOn ?? '—'}</p>
                <p>Run by {campaign.selection.runBy}</p>
                <p>Eligible entries {campaign.selection.eligibleEntryCount}</p>
                <p>Unfilled prize units {campaign.selection.unfilledUnitCount}</p>
                <p>Seed {campaign.selection.seedPreview}</p>
              </>
            ) : (
              <p className="text-muted-foreground">No simulated selection is stored.</p>
            )}
          </div>
          {campaign.winners.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <caption className="sr-only">Winners in rank order</caption>
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Rank
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Prize
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Member
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Fulfillment
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {campaign.winners.map((winner, index) => (
                    <tr key={`${campaign.id}:winner:${winner.rank}:${index}`} className="border-b last:border-b-0">
                      <td className="py-2 pr-3">{winner.rank}</td>
                      <td className="py-2 pr-3">{winner.prizeLabel}</td>
                      <td className="py-2 pr-3">{winner.memberLabel}</td>
                      <td className="py-2">{winner.fulfillmentLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="space-y-1 text-sm">
            <h3 className="font-medium">Fulfillment</h3>
            <p>{campaign.countsLabel}</p>
            <p>{campaign.costLabel}</p>
            {campaign.note ? <p role="note">{campaign.note}</p> : null}
            {campaign.events.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {campaign.events.map((event, index) => (
                  <li key={`${campaign.id}:event:${index}`}>
                    {event.on ?? '—'} · {event.label}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
