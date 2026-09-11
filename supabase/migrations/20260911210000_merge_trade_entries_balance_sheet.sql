-- Merge the Balance Sheet into Trade Entries: a trade's own computed P&L
-- IS that day's debit/credit, so keeping a separate manually-entered ledger
-- meant recording the same number twice. balance_sheet_entries is dropped;
-- balance_sheet_settings (the starting fund) stays — the merged view still
-- needs it for Fund/% Return.

alter table trade_entries add column remarks text;

drop table if exists balance_sheet_entries;
