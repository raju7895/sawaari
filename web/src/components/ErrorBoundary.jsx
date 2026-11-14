/* A crash in one screen must not leave a blank page. */
import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[sawaari] the screen crashed:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
        <div className="card w-full max-w-md p-6 text-center">
          <h1 className="text-lg font-bold">This screen ran into a problem</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Nothing was lost — reload the page to try again.
          </p>
          {this.state.error?.message ? (
            <p className="mt-3 break-words rounded-lg bg-slate-100 p-2 text-xs text-slate-500 dark:bg-slate-800">
              {this.state.error.message}
            </p>
          ) : null}
          <div className="mt-5 flex justify-center gap-2">
            <button type="button" className="btn-ghost" onClick={() => this.setState({ error: null })}>
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
