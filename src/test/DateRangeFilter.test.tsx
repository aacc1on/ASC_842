import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DateRangeFilter } from '../components/DateRangeFilter';

function renderFilter(from = '', to = '') {
  const onApply = vi.fn();
  render(<DateRangeFilter from={from} to={to} onApply={onApply} />);
  return onApply;
}

function clickDay(date: string) {
  const button = document.querySelector(`[data-day="${date}"] button`);
  if (!(button instanceof HTMLElement)) throw new Error(`Day ${date} was not rendered`);
  fireEvent.click(button);
}

describe('DateRangeFilter', () => {
  it('does not commit when navigating to another month', () => {
    const onApply = renderFilter('2026-06-10', '2026-06-20');

    fireEvent.click(screen.getByRole('button', { name: 'Open from calendar' }));
    fireEvent.click(screen.getByRole('button', { name: /next month/i }));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByLabelText('From')).toHaveValue('06/10/2026');
    expect(screen.getByLabelText('To')).toHaveValue('06/20/2026');
  });

  it('commits the selected range when Apply is clicked', () => {
    const onApply = renderFilter('2026-06-10', '2026-06-20');

    fireEvent.click(screen.getByRole('button', { name: 'Open from calendar' }));
    clickDay('2026-06-10');
    clickDay('2026-06-20');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith('2026-06-10', '2026-06-20');
  });

  it('clears both dates', () => {
    const onApply = renderFilter('2026-06-10', '2026-06-20');

    fireEvent.click(screen.getByRole('button', { name: 'Open from calendar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onApply).toHaveBeenCalledWith('', '');
    expect(screen.getByLabelText('From')).toHaveValue('');
    expect(screen.getByLabelText('To')).toHaveValue('');
  });

  it('commits a typed date on Enter', () => {
    const onApply = renderFilter();
    const from = screen.getByLabelText('From');

    fireEvent.change(from, { target: { value: '06/10/2026' } });
    fireEvent.keyDown(from, { key: 'Enter' });

    expect(onApply).toHaveBeenCalledWith('2026-06-10', '');
  });

  it('shows an inline error when the range is reversed', () => {
    const onApply = renderFilter();

    fireEvent.click(screen.getByRole('button', { name: 'Open from calendar' }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '06/20/2026' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '06/10/2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getByRole('alert')).toHaveTextContent('From date must be on or before the to date.');
    expect(onApply).not.toHaveBeenCalled();
  });
});
