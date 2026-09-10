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
