-- Adds a type to payments — Pay In (funding added to the trading account) vs
-- Payout (profit-sharing paid out), so the same ledger covers both
-- directions of cash movement instead of only payouts. Existing rows all
-- default to 'payout', matching what they already were before this column
-- existed. Pay In rows reuse payout_amount to hold the deposited amount
-- (initial_fund/profit are forced to 0 and hidden in the UI for that type)
-- rather than adding a separate amount column for one extra numeric field.

alter table payments add column type text not null default 'payout' check (type in ('payin', 'payout'));
