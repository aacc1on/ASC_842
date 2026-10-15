export type SortOption =
  | 'created_desc'
  | 'created_asc'
  | 'name_asc'
  | 'name_desc'
  | 'amount_desc'
  | 'amount_asc'
  | 'start_desc'
  | 'start_asc'
  | 'term_desc'
  | 'term_asc';

export type ViewMode = 'table' | 'kanban' | 'cards';

export const DEFAULT_PAGE_SIZE = 10;

export const SORT_CONFIG: Record<SortOption, { column: string; ascending: boolean }> = {
  created_desc: { column: 'created_at', ascending: false },
  created_asc: { column: 'created_at', ascending: true },
  name_asc: { column: 'lease_name', ascending: true },
  name_desc: { column: 'lease_name', ascending: false },
  amount_desc: { column: 'payment_amount', ascending: false },
  amount_asc: { column: 'payment_amount', ascending: true },
  start_desc: { column: 'lease_start_date', ascending: false },
  start_asc: { column: 'lease_start_date', ascending: true },
  term_desc: { column: 'lease_term_months', ascending: false },
  term_asc: { column: 'lease_term_months', ascending: true },
};
