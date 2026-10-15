export const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

export const formatDate = (dateString: string) => {
  const isoDate = String(dateString).split('T')[0];
  return new Date(isoDate + 'T00:00:00').toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

export const getTransactionTypeColor = (type: string) => {
  const colors: Record<string, string> = {
    payment: 'bg-blue-100 text-blue-700',
    interest: 'bg-orange-100 text-orange-700',
    amortization: 'bg-green-100 text-green-700',
    initial_recognition: 'bg-teal-100 text-teal-700',
    lease_modification: 'bg-amber-100 text-amber-700',
    modification: 'bg-amber-100 text-amber-700',
    impairment: 'bg-red-100 text-red-700',
    derecognition: 'bg-slate-100 text-slate-700',
    reversal: 'bg-pink-100 text-pink-700',
  };
  return colors[type] || 'bg-slate-100 text-slate-700';
};
