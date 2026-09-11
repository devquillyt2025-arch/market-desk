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

export type TradeLeg = {
  id: string;
  trade_id: string;
  sell_price: number;
  buy_price: number;
  net: number;
  leg_order: number;
  created_at: string;
};

export type Trade = {
  id: string;
  user_id: string | null;
  instrument: Instrument;
  trade_date: string;
  lots: number;
  lot_size: number;
  qty: number;
  total_net: number;
  total_pnl: number;
  created_at: string;
};

export type TradeWithLegs = Trade & { legs: TradeLeg[] };

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

/** Daily trading journal — one row per day, independent of `trades`. */
export type TradeEntry = {
  id: string;
  user_id: string | null;
  entry_date: string;
  instrument: Instrument;
  lots: number;
  side: TradeEntrySide;
  buy_price: number;
  sell_price: number;
  pnl: number;
  status: TradeEntryStatus;
  created_at: string;
  updated_at: string;
};

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

/** jsonb payload shape the `save_trade` RPC expects per leg. */
export type SaveTradeLegInput = {
  sell_price: number;
  buy_price: number;
  net: number;
  leg_order: number;
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
 * table join) inference, which this app doesn't use: history reads trades
 * and trade_legs as two separate queries and merges them in application code.
 */
export type Database = {
  public: {
    Tables: {
      trades: {
        Row: Trade;
        Insert: Insert<Trade, "id" | "user_id" | "trade_date" | "created_at">;
        Update: Partial<Trade>;
        Relationships: [];
      };
      trade_legs: {
        Row: TradeLeg;
        Insert: Insert<TradeLeg, "id" | "created_at">;
        Update: Partial<TradeLeg>;
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
        Insert: Insert<TradeEntry, "id" | "user_id" | "entry_date" | "created_at" | "updated_at">;
        Update: Partial<TradeEntry>;
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
    Functions: {
      save_trade: {
        Args: {
          p_instrument: string;
          p_lots: number;
          p_lot_size: number;
          p_qty: number;
          p_total_net: number;
          p_total_pnl: number;
          p_legs: SaveTradeLegInput[];
          p_user_id?: string | null;
        };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
