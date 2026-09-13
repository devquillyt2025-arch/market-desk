-- Strike price + CE/PE, so an entry can be identified the way Indian
-- options are actually quoted (e.g. "NIFTY 23500 CE"). Nullable: existing
-- entries and any future non-options entries don't have to carry them.

alter table trade_entries
  add column strike_price numeric(10, 2),
  add column option_type text check (option_type in ('CE', 'PE'));
