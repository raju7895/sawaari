/* A crash in one screen must not leave a blank page.
 *
 * It shows what went wrong (the message and the stack), because "something
 * broke" is useless to whoever has to fix it — and it keeps the error on
 * `window.__sawaariError` so it can be read from the console.
 */
import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // keep it reachable for the console
    if (typeof window !== 'undefined') window.__sawaariError = { error, info };
    console.error('[sawaari] the screen crashed:', error, info);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const message = error?.message || error?.toString?.() || 'Unknown error';
    const stack = (info?.componentStack || '').trim().split('\n').slice(0, 4).join('\n');

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
        <div className="card w-full max-w-lg p-6">
          <h1 className="text-lg font-bold">This screen ran into a problem</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Nothing was lost — reload the page to try again.
          </p>

          <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-red-50 p-3 text-xs text-red-800 dark:bg-red-900/30 dark:text-red-200">
            {message}
            {stack ? `\n${stack}` : ''}
          </pre>

          <div className="mt-5 flex justify-center gap-2">
            <button type="button" className="btn-ghost" onClick={() => this.setState({ error: null, info: null })}>
              Try again
            </button>
            <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
