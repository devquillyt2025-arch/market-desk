export const INSTRUMENTS = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;
export type Instrument = (typeof INSTRUMENTS)[number];

export const INSTRUMENT_LABELS: Record<Instrument, string> = {
  NIFTY: "Nifty",
  BANKNIFTY: "Bank Nifty",
  SENSEX: "Sensex",
};

/**
 * Starting point only — NSE/BSE revise lot sizes periodically, so every trade
 * stores its own `lot_size` rather than trusting this at read time.
 */
export const DEFAULT_LOT_SIZES: Record<Instrument, number> = {
  NIFTY: 65,
  BANKNIFTY: 30,
  SENSEX: 20,
};

export const NOTE_COLORS = [
  "default",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

/** App-facing shape — camelCase, predates the Supabase-backed table. */
export type Note = {
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  pinned: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

/** `notes` row shape — snake_case, matching every other table in this schema. */
export type NoteRow = {
  id: string;
  user_id: string | null;
  title: string;
  content: string;
  color: NoteColor;
  pinned: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export const TRADE_ENTRY_STATUSES = ["squared_off", "hold"] as const;
export type TradeEntryStatus = (typeof TRADE_ENTRY_STATUSES)[number];

export const TRADE_ENTRY_SIDES = ["buy", "sell"] as const;
export type TradeEntrySide = (typeof TRADE_ENTRY_SIDES)[number];

export const TRADE_ENTRY_OPTION_TYPES = ["CE", "PE"] as const;
export type TradeEntryOptionType = (typeof TRADE_ENTRY_OPTION_TYPES)[number];

/**
 * Daily trading journal — one row per day, independent of `trades`.
 * `strike_price`/`option_type` are nullable — older entries and any
 * non-options entries don't carry them.
 */
export type TradeEntry = {
  id: string;
  user_id: string | null;
  entry_date: string;
  instrument: Instrument;
  strike_price: number | null;
  option_type: TradeEntryOptionType | null;
  /** Nullable — only entries with strike_price + option_type + expiry_date all set are tracked by Live Portfolio. */
  expiry_date: string | null;
  lots: number;
  side: TradeEntrySide;
  buy_price: number;
  sell_price: number;
  pnl: number;
  status: TradeEntryStatus;
  remarks: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Paper Trade's row shape — identical fields to TradeEntry (same trade
 * details, same hold/squared_off lifecycle), just persisted to its own
 * table so a sandbox position never touches real P&L, Reports, or Payment.
 */
export type PaperTradeEntry = TradeEntry;

/** `links` row shape — snake_case; app-facing `LinkItem` (in linksStore.ts) maps `group_name` to `group`. */
export type LinkRow = {
  id: string;
  user_id: string | null;
  label: string;
  url: string;
  description: string | null;
  group_name: string;
  created_at: string;
};

/** `activity_log` row shape — backs the Logs tab. */
export type ActivityLogRow = {
  id: string;
  user_id: string | null;
  message: string;
  created_at: string;
};

/** `upstox_config` row shape — a single settings row (id is always 1) holding the daily Upstox access token. */
export type UpstoxConfigRow = {
  id: number;
  access_token: string | null;
  updated_at: string;
};

export const PAYMENT_STATUSES = ["pending", "partial", "paid"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Pay In = funding added to the trading account. Payout = profit-sharing paid out. */
export const PAYMENT_TYPES = ["payin", "payout"] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

/**
 * Fund ledger — backs the Payment tab. Each row is a standalone record (no
 * running balance across rows, unlike the old balance-sheet columns Trade
 * Entries used to have). `type` decides which fields are meaningful: a
 * payout row uses its own initial fund, profit, and payout amount; a payin
 * row only uses payout_amount (as the deposited amount) and leaves
 * initial_fund/profit at 0. `status` tracks whether the money has actually
 * moved yet, for either direction.
 */
export type Payment = {
  id: string;
  user_id: string | null;
  entry_date: string;
  details: string;
  type: PaymentType;
  initial_fund: number;
  profit: number;
  payout_amount: number;
  status: PaymentStatus;
  created_at: string;
  updated_at: string;
};

/**
 * Columns the database fills in for you are optional on insert. The outer
 * mapped type is load-bearing: postgrest-js requires each table's types to
 * satisfy `Record<string, unknown>`, and a bare `A & Partial<B>` intersection
 * doesn't get an implicit index signature. Flattening it does.
 */
type Insert<T, Optional extends keyof T> = {
  [K in keyof (Omit<T, Optional> & Partial<Pick<T, Optional>>)]: (Omit<T, Optional> &
    Partial<Pick<T, Optional>>)[K];
};

/**
 * Hand-written rather than generated, so it stays readable and lives next to
 * the app-level types above. `Relationships: []` is required by postgrest-js
 * for the schema to typecheck — it only affects embedded-select (foreign
 * table join) inference, which this app doesn't use.
 */
export type Database = {
  public: {
    Tables: {
      payments: {
        Row: Payment;
        Insert: Insert<Payment, "id" | "user_id" | "entry_date" | "created_at" | "updated_at">;
        Update: Partial<Payment>;
        Relationships: [];
      };
      notes: {
        Row: NoteRow;
        Insert: Insert<NoteRow, "id" | "user_id" | "created_at" | "updated_at">;
        Update: Partial<NoteRow>;
        Relationships: [];
      };
      trade_entries: {
        Row: TradeEntry;
        Insert: Insert<
          TradeEntry,
          | "id"
          | "user_id"
          | "entry_date"
          | "strike_price"
          | "option_type"
          | "expiry_date"
          | "remarks"
          | "created_at"
          | "updated_at"
        >;
        Update: Partial<TradeEntry>;
        Relationships: [];
      };
      // Same row shape as trade_entries (see PaperTradeEntry) — a separate
      // table so sandbox positions never mix into real P&L/Reports/Payment.
      paper_trade_entries: {
        Row: PaperTradeEntry;
        Insert: Insert<
          PaperTradeEntry,
          | "id"
          | "user_id"
          | "entry_date"
          | "strike_price"
          | "option_type"
          | "expiry_date"
          | "remarks"
          | "created_at"
          | "updated_at"
        >;
        Update: Partial<PaperTradeEntry>;
        Relationships: [];
      };
      upstox_config: {
        Row: UpstoxConfigRow;
        Insert: Insert<UpstoxConfigRow, "id" | "updated_at">;
        Update: Partial<UpstoxConfigRow>;
        Relationships: [];
      };
      links: {
        Row: LinkRow;
        Insert: Insert<LinkRow, "id" | "user_id" | "created_at">;
        Update: Partial<LinkRow>;
        Relationships: [];
      };
      activity_log: {
        Row: ActivityLogRow;
        Insert: Insert<ActivityLogRow, "id" | "user_id" | "created_at">;
        Update: Partial<ActivityLogRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
