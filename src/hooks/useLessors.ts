import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { toUserMessage } from '../utils/errors';
import { currentOrgId } from '../utils/currentOrg';

export interface Lessor {
  id: string;
  lessor_name: string;
  lessor_type: string;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LessorFormData {
  lessor_name: string;
  lessor_type: string;
  contact_email: string;
  contact_phone: string;
  address: string;
  is_active: boolean;
  notes: string;
}

const EMPTY_FORM: LessorFormData = {
  lessor_name: '',
  lessor_type: 'corporate',
  contact_email: '',
  contact_phone: '',
  address: '',
  is_active: true,
  notes: '',
};

export function useLessors() {
  const [lessors, setLessors] = useState<Lessor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadLessors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const orgId = await currentOrgId();
      const { data, error: e } = await supabase
        .from('lessors')
        .select('*')
        .eq('organization_id', orgId)
        .order('lessor_name', { ascending: true });
      if (e) throw e;
      setLessors((data ?? []) as Lessor[]);
    } catch (err) {
      setError(toUserMessage(err, 'Failed to load lessors'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadLessors(); }, [loadLessors]);

  const saveLessor = useCallback(async (form: LessorFormData, existingId?: string): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        lessor_name: form.lessor_name.trim(),
        lessor_type: form.lessor_type,
        contact_email: form.contact_email.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        address: form.address.trim() || null,
        is_active: form.is_active,
        notes: form.notes.trim() || null,
      };
      if (existingId) {
        const { error: e } = await supabase.from('lessors').update(payload).eq('id', existingId);
        if (e) throw e;
      } else {
        const { error: e } = await supabase.from('lessors').insert(payload);
        if (e) throw e;
      }
      await loadLessors();
      return true;
    } catch (err) {
      setError(toUserMessage(err, 'Failed to save lessor'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [loadLessors]);

  const toggleActive = useCallback(async (id: string, isActive: boolean): Promise<boolean> => {
    try {
      const { error: e } = await supabase.from('lessors').update({ is_active: isActive }).eq('id', id);
      if (e) throw e;
      setLessors((prev) => prev.map((l) => l.id === id ? { ...l, is_active: isActive } : l));
      return true;
    } catch (err) {
      setError(toUserMessage(err, 'Failed to update lessor'));
      return false;
    }
  }, []);

  const deleteLessor = useCallback(async (id: string): Promise<boolean> => {
    try {
      const { error: e } = await supabase.from('lessors').delete().eq('id', id);
      if (e) throw e;
      setLessors((prev) => prev.filter((l) => l.id !== id));
      return true;
    } catch (err) {
      setError(toUserMessage(err, 'Failed to delete lessor'));
      return false;
    }
  }, []);

  return {
    lessors,
    loading,
    error,
    saving,
    loadLessors,
    saveLessor,
    toggleActive,
    deleteLessor,
    EMPTY_FORM,
  };
}
