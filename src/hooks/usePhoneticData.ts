/**
 * TanStack Query hooks for Phonetic Inspector data
 * 
 * Provides:
 * - Automatic caching (no redundant fetches)
 * - Optimistic updates (UI updates immediately)
 * - Background refetching
 * - Request deduplication
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchPhoneticG2PRules,
  fetchPhoneticG2PEvidence,
  savePhoneticG2PRulesBatch,
  savePhoneticG2PRule,
  updatePhoneticG2PRuleEvidence,
  savePhoneticG2PEvidenceBatch,
  fetchWordsTh,
} from '../supabase';

// Query keys for consistent cache invalidation
export const phoneticQueryKeys = {
  all: ['phonetic'] as const,
  rules: () => [...phoneticQueryKeys.all, 'rules'] as const,
  evidence: () => [...phoneticQueryKeys.all, 'evidence'] as const,
  evidenceByWord: (wordId: string) => [...phoneticQueryKeys.evidence(), wordId] as const,
  words: () => [...phoneticQueryKeys.all, 'words'] as const,
  wordsWithG2P: () => [...phoneticQueryKeys.words(), 'with-g2p'] as const,
};

/**
 * Hook to fetch all phonetic G2P rules
 * Cached for 30 seconds, refetches in background if stale
 */
export function usePhoneticG2PRules() {
  return useQuery({
    queryKey: phoneticQueryKeys.rules(),
    queryFn: async () => {
      const result = await fetchPhoneticG2PRules();
      return result;
    },
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch all words from words_th table
 * Cached for 1 minute (words don't change frequently)
 */
export function useWordsTh() {
  return useQuery({
    queryKey: phoneticQueryKeys.words(),
    queryFn: async () => {
      const { data, error } = await fetchWordsTh();
      if (error) {
        throw error;
      }
      const result = data || [];
      return result;
    },
    staleTime: 60 * 1000, // 1 minute
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Hook to fetch words with G2P data
 * Cached for 1 minute
 */
export function useWordsThWithG2P() {
  return useQuery({
    queryKey: phoneticQueryKeys.wordsWithG2P(),
    queryFn: async () => {
      const { data, error } = await fetchWordsTh();
      if (error) throw error;
      return (data || []).filter(word => word.g2p && word.g2p.trim() !== '');
    },
    staleTime: 60 * 1000, // 1 minute
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Hook to fetch phonetic G2P evidence
 * Cached for 30 seconds
 */
export function usePhoneticG2PEvidence() {
  return useQuery({
    queryKey: phoneticQueryKeys.evidence(),
    queryFn: async () => {
      const result = await fetchPhoneticG2PEvidence();
      return result;
    },
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Mutation to save phonetic G2P rules batch
 * Optimistically updates cache, then refetches on success
 */
export function useSavePhoneticG2PRulesBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: savePhoneticG2PRulesBatch,
    onMutate: async (newRules) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: phoneticQueryKeys.rules() });

      // Snapshot previous value
      const previousRules = queryClient.getQueryData(phoneticQueryKeys.rules());

      // Optimistically update cache
      queryClient.setQueryData(phoneticQueryKeys.rules(), (old: any) => {
        if (!old) return newRules.map(r => ({ ...r, id: Date.now() }));
        // Merge new rules with existing ones
        const existing = new Map(old.map((r: any) => [r.g2p_code, r]));
        newRules.forEach((rule: any) => {
          existing.set(rule.g2p_code, { ...existing.get(rule.g2p_code), ...rule });
        });
        return Array.from(existing.values());
      });

      return { previousRules };
    },
    onError: (_err, _newRules, context) => {
      // Rollback on error
      if (context?.previousRules) {
        queryClient.setQueryData(phoneticQueryKeys.rules(), context.previousRules);
      }
    },
    onSuccess: () => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: phoneticQueryKeys.rules() });
    },
  });
}

/**
 * Mutation to save a single phonetic G2P rule
 * Optimistically updates cache
 */
export function useSavePhoneticG2PRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: savePhoneticG2PRule,
    onMutate: async (newRule) => {
      await queryClient.cancelQueries({ queryKey: phoneticQueryKeys.rules() });
      const previousRules = queryClient.getQueryData(phoneticQueryKeys.rules());

      queryClient.setQueryData(phoneticQueryKeys.rules(), (old: any) => {
        if (!old) return [newRule];
        const existing = new Map(old.map((r: any) => [r.g2p_code, r]));
        existing.set(newRule.g2p_code, newRule);
        return Array.from(existing.values());
      });

      return { previousRules };
    },
    onError: (_err, _newRule, context) => {
      if (context?.previousRules) {
        queryClient.setQueryData(phoneticQueryKeys.rules(), context.previousRules);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: phoneticQueryKeys.rules() });
    },
  });
}

/**
 * Mutation to update phonetic G2P rule evidence
 * Optimistically updates cache
 */
export function useUpdatePhoneticG2PRuleEvidence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ g2p_code, evidence }: { g2p_code: string; evidence: string }) =>
      updatePhoneticG2PRuleEvidence(g2p_code, evidence),
    onMutate: async ({ g2p_code, evidence }) => {
      await queryClient.cancelQueries({ queryKey: phoneticQueryKeys.rules() });
      const previousRules = queryClient.getQueryData(phoneticQueryKeys.rules());

      queryClient.setQueryData(phoneticQueryKeys.rules(), (old: any) => {
        if (!old) return old;
        return old.map((rule: any) =>
          rule.g2p_code === g2p_code ? { ...rule, evidence } : rule
        );
      });

      return { previousRules };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousRules) {
        queryClient.setQueryData(phoneticQueryKeys.rules(), context.previousRules);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: phoneticQueryKeys.rules() });
    },
  });
}

/**
 * Mutation to save phonetic G2P evidence batch
 * Invalidates evidence cache on success
 */
export function useSavePhoneticG2PEvidenceBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (evidence: any[]) => {
      const result = await savePhoneticG2PEvidenceBatch(evidence);
      return result;
    },
    onSuccess: () => {
      // Invalidate evidence cache to refetch
      queryClient.invalidateQueries({ queryKey: phoneticQueryKeys.evidence() });
    },
  });
}
