import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary.js';

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test exploded');
  }
  return <div>Healthy component content</div>;
}

describe('ErrorBoundary', () => {
  it('ERR-01: renders children when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Healthy component content')).toBeDefined();
  });

  it('ERR-02: catches render error and displays recovery panel without crashing', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Panel error')).toBeDefined();
    expect(screen.getByText(/The trading engine is unaffected/i)).toBeDefined();

    consoleErrorSpy.mockRestore();
  });
});
