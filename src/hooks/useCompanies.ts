import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Company } from '../types/lease';
import { currentOrgId } from '../utils/currentOrg';
import { toUserMessage } from '../utils/errors';

interface UseCompaniesResult {
  companies: Company[];
  selectedCompanyId: string | null;
  setSelectedCompanyId: React.Dispatch<React.SetStateAction<string | null>>;
  loading: boolean;
  loaded: boolean;
  /** User-facing message when the company list could not be loaded. */
  error: string | null;
  /**
   * Inserts a new company. Performs ONLY the insert; the caller is responsible
   * for refreshing the company list afterwards (e.g. via `loadCompanies` or an
   * `onCompaniesUpdated` prop), preserving the existing App ↔ MenuBar flow.
   * Returns true on success.
   */
  handleAddCompany: (name: string, code: string) => Promise<boolean>;
  /**
   * Loads active companies for the current user and restores the persisted
   * selection from localStorage. Intended to be called explicitly on auth
   * state changes (App) rather than on every mount.
   */
  loadCompanies: () => Promise<void>;
  /**
   * Updates the selected company and persists (or clears) the choice in
   * localStorage, mirroring the behavior previously inlined in App.tsx.
   */
  handleCompanyChange: (companyId: string | null) => void;
  /** Clears company state and the persisted selection (sign-out path). */
  reset: () => void;
}

/**
 * Extracts company CRUD + selection logic that previously lived split between
 * App.tsx and MenuBar.tsx:
 *  - supabase.auth.getUser() + supabase.from('companies').select(...) (load)
 *  - supabase.from('companies').insert(...) (add, from MenuBar)
 *  - localStorage persistence of the selected company (from App)
 *
 * The hook does NOT auto-load on mount: App drives loads from its
 * onAuthStateChange handler exactly as before, so there is a single source of
 * truth for company state. `handleAddCompany` performs only the insert so the
 * caller controls when the list refreshes.
 */
export function useCompanies(): UseCompaniesResult {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCompanies = useCallback(async () => {
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const orgId = await currentOrgId();

      const { data, error: loadError } = await supabase
        .from('companies')
        .select('*')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('company_name');
      if (loadError) throw loadError;

      if (data && data.length > 0) {
        setCompanies(data);
        const saved = localStorage.getItem('selectedCompanyId');
        setSelectedCompanyId(
          saved && data.some((c) => c.id === saved) ? saved : data[0].id,
        );
      }
    } catch (err) {
      setError(toUserMessage(err, 'Failed to load your companies.'));
    } finally {
      setLoaded(true);
      setLoading(false);
    }
  }, []);

  const handleAddCompany = useCallback(
    async (name: string, code: string): Promise<boolean> => {
      if (!name.trim()) return false;
      const { error } = await supabase.from('companies').insert({
        company_name: name.trim(),
        company_code: code.trim() || null,
      });
      return !error;
    },
    [],
  );

  const handleCompanyChange = useCallback((companyId: string | null) => {
    setSelectedCompanyId(companyId);
    if (companyId) {
      localStorage.setItem('selectedCompanyId', companyId);
    } else {
      localStorage.removeItem('selectedCompanyId');
    }
  }, []);

  const reset = useCallback(() => {
    setCompanies([]);
    setSelectedCompanyId(null);
    setLoaded(false);
    setLoading(true);
    localStorage.removeItem('selectedCompanyId');
  }, []);

  return {
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    loading,
    loaded,
    error,
    handleAddCompany,
    loadCompanies,
    handleCompanyChange,
    reset,
  };
}
