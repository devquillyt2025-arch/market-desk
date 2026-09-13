-- The starting-fund concept is removed from Trade Entries — Fund/Overall %
-- Ret (which depended on it) are already gone from the UI, and this was the
-- only remaining reader of this table.

drop table if exists balance_sheet_settings;
