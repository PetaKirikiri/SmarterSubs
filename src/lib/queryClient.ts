import { QueryClient } from '@tanstack/react-query';

/**
 * TanStack Query Client Configuration
 * 
 * Configured for Supabase database queries with:
 * - Stale time: 30 seconds (data considered fresh for 30s)
 * - Cache time: 5 minutes (cached data kept for 5min after last use)
 * - Retry: 1 attempt on failure
 * - Refetch on window focus: disabled (to avoid unnecessary requests)
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000, // 30 seconds
      gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)
      retry: 1,
      refetchOnWindowFocus: false, // Disable auto-refetch on window focus
    },
    mutations: {
      retry: 1,
    },
  },
});
