import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from '../components/ErrorBoundary';

function ThrowOnRender(): React.ReactNode {
  throw new Error('Test explosion');
}

function OkComponent() {
  return <div data-testid="ok-render">Rendered OK</div>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows the "Something went wrong" card when a child throws', async () => {
    render(
      <ErrorBoundary sectionName="TestSection">
        <ThrowOnRender />
      </ErrorBoundary>
    );

    await waitFor(() => {
      expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
      expect(screen.getByText(/in TestSection/)).toBeInTheDocument();
    });
  });

  it('renders children normally when no error', () => {
    render(
      <ErrorBoundary>
        <OkComponent />
      </ErrorBoundary>
    );
    expect(screen.getByTestId('ok-render')).toBeInTheDocument();
  });

  it('Try again button resets the boundary', async () => {
    let shouldThrow = true;
    function MaybeThrow() {
      if (shouldThrow) throw new Error('boom');
      return <div data-testid="recovered">Recovered</div>;
    }

    const user = userEvent.setup();
    render(
      <ErrorBoundary>
        <MaybeThrow />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(screen.getByTestId('recovered')).toBeInTheDocument();
  });
});
