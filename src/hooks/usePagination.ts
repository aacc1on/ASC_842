import { useState } from 'react';

export function usePagination<T>(items: T[], initialPageSize = 25) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  // Clamp so shrinking the list (filters, deletes) never leaves an empty page.
  const currentPage = Math.min(page, totalPages);
  const pageItems = items.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return {
    pageItems,
    paginationProps: {
      currentPage,
      totalPages,
      totalItems: items.length,
      pageSize,
      onPageChange: setPage,
      onPageSizeChange: setPageSize,
    },
  };
}
